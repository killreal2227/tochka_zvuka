"""Offline failure/replay contracts. Never use actual CRM credentials."""
import copy
import unittest
from unittest.mock import patch
from test_bulk_mvp import BulkTests
from alfacrm import AlfaCRM, CRMError
import index


class Clock:
    def __init__(self): self.value=0
    def now(self): return self.value
    def sleep(self,seconds): self.value+=seconds


class CRMTests(unittest.TestCase):
    save=BulkTests.save
    def setUp(self):
        BulkTests.setUp(self)
        self.clock=Clock();self.calls=[];self.items=[];self.created=[];self.fail_create=False
        self.crm=AlfaCRM({'ALFACRM_EMAIL':'fixture@example.invalid','ALFACRM_API_KEY':'fixture',
            'ALFACRM_LEAD_STATUS_ID':'18'},send=self.send,clock=self.clock.now,sleep=self.clock.sleep)
    def send(self,path,payload,token):
        self.calls.append((self.clock.now(),path,copy.deepcopy(payload),token))
        if path.endswith('auth/login'): return {'token':'fixture-token'}
        if path.endswith('index'):
            items=[x for x in self.created if x['id']==payload['id']] if 'id' in payload else self.items
            return {'items':items,'total':len(items)}
        if path.endswith('create'):
            item=dict(payload,id=123+len(self.created));self.created.append(item)
            if self.fail_create:
                raise CRMError()
            return item
        raise AssertionError(path)
    def test_routes_and_confirmed_repeat(self):
        for branch,id_ in [('kaluga',7),('troitsk',53)]:
            self.data['branch']=branch;receipt=self.save()
            self.assertEqual(self.store.sync_crm(receipt,self.crm),'sent')
            self.assertEqual(self.store.sync_crm(receipt,self.crm),'sent')
            self.assertEqual(self.created[-1]['branch_ids'],[id_])
            self.assertEqual(self.created[-1]['lead_source_id'],3)
        self.assertEqual(len(self.created),2)
        self.assertEqual(sum(p.endswith('auth/login') for _,p,_,_ in self.calls),1)
        self.assertTrue(all(b[0]-a[0]>=2.2-1e-8 for a,b in zip(self.calls,self.calls[1:])))
    def test_lost_create_response_is_not_repeated(self):
        receipt=self.save();self.fail_create=True
        with self.assertRaises(CRMError):self.store.sync_crm(receipt,self.crm)
        self.assertEqual(self.store.sync_crm(receipt,self.crm),'attention')
        self.assertEqual(len(self.created),1)
    def test_lost_response_can_be_reconciled(self):
        receipt=self.save();self.fail_create=True
        with self.assertRaises(CRMError):self.store.sync_crm(receipt,self.crm)
        self.items=self.created[:]
        self.assertEqual(self.store.sync_crm(receipt,self.crm),'sent')
        self.assertEqual(self.store.crm_marker(receipt)['crm_external_id'],'123')
        self.assertEqual(len(self.created),1)
    def test_existing_customer_is_preserved_and_flagged(self):
        receipt=self.save();self.items=[{'id':99,'phone':['89990000000'],'is_study':1}]
        before=copy.deepcopy(self.items)
        self.assertEqual(self.store.sync_crm(receipt,self.crm),'existing_review')
        self.assertEqual(self.items,before);self.assertEqual(self.created,[])
    def test_failed_marker_prevents_create(self):
        receipt=self.save();self.client.fail_write=True
        with self.assertRaises(RuntimeError):self.store.sync_crm(receipt,self.crm)
        self.assertEqual(self.created,[])
    def test_lookup_failure_or_pagination_never_creates(self):
        receipt=self.save()
        with patch.object(self.crm,'_request',return_value={'items':[],'total':2}):
            self.crm.token='fixture';self.crm.expires=9999
            with self.assertRaises(CRMError):self.store.sync_crm(receipt,self.crm)
        self.assertEqual(self.created,[])
    def test_telegram_and_crm_markers_are_independent(self):
        receipt=self.save();self.store.sync_crm(receipt,self.crm)
        self.assertEqual(self.store.notify(receipt,lambda _:17),'sent')
        self.save()
        self.assertEqual(self.store.crm_marker(receipt)['crm_state'],'sent')
        self.assertEqual(self.store.sync_crm(receipt,self.crm),'sent')
        self.assertEqual(len(self.created),1)
    def test_stage_is_explicit_and_private_route_is_disabled(self):
        with self.assertRaises(CRMError):AlfaCRM({'ALFACRM_EMAIL':'x','ALFACRM_API_KEY':'y'})
        with patch.dict(index.os.environ,{},clear=True),patch.object(index,'get_delivery') as get:
            self.assertEqual(index.handler({'crmReceipt':'fixture'},None),{'ignored':True})
            get.assert_not_called()
    def test_http_cannot_select_private_queue_drain(self):
        with patch.dict(index.os.environ,{},clear=True),patch.object(index,'get_delivery') as delivery:
            result=index.handler({'crmDrain':True,'httpMethod':'GET'},None)
            self.assertEqual(result['statusCode'],403);delivery.assert_not_called()


if __name__=='__main__':unittest.main()
