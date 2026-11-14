"""Offline native-RPC contract tests; no YDB compatibility simulation claim."""
import copy
import hashlib
import json
import ssl
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from test_service import payload, event, ENV, NOW
from bulk_store import BulkStore
from service import receive
import index

class Client:
    def __init__(self): self.rows={}; self.fail_write=False; self.hide=False
    def bulk_upsert(self,path,rows,types,settings=None):
        if self.fail_write: raise RuntimeError('fixture')
        for row in rows: self.rows[(path,row['request_id'])]=copy.deepcopy(row)
    def read_rows(self,path,keys,types,settings=None):
        if path.endswith('outbox'): raise RuntimeError('ReadRows unsupported on indexed table')
        row=self.rows.get((path,keys[0]['request_id']))
        return SimpleNamespace(rows=[] if self.hide or row is None else [copy.deepcopy(row)])

class BulkTests(unittest.TestCase):
    def setUp(self):
        self.client=Client();self.store=BulkStore(self.client,'/fixture','tz_test_')
        self.data=payload();self.data.pop('captchaToken')
    def save(self,data=None):
        data=data or self.data
        digest=hashlib.sha256(json.dumps(data,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
        return self.store.save(data,digest,NOW)
    def test_retry_and_changed_content_versions(self):
        a=self.save();self.assertEqual(a,self.save());self.assertEqual(len(self.client.rows),1)
        self.data['name']='Example';self.assertNotEqual(a,self.save());self.assertEqual(len(self.client.rows),2)
    def test_no_ack_on_write_or_read_failure(self):
        for attribute in ('fail_write','hide'):
            setattr(self.client,attribute,True)
            with self.assertRaises(RuntimeError): self.save()
            setattr(self.client,attribute,False)
    def test_mismatching_persisted_content_never_acknowledged(self):
        original=self.client.read_rows
        def corrupted(*args,**kwargs):
            result=original(*args,**kwargs)
            if result.rows: result.rows[0]['phone']='+79990000001'
            return result
        with patch.object(self.client,'read_rows',side_effect=corrupted):
            with self.assertRaises(RuntimeError): self.save()
    def test_both_branches_immutable_intent_and_success_marker(self):
        for branch in ('kaluga','troitsk'):
            self.data['branch']=branch;receipt=self.save();sender=Mock(return_value=42)
            self.assertEqual(self.store.notify(receipt,sender),'sent')
            self.assertEqual(sender.call_args.args[0]['branch'],branch)
            self.save();self.store.notify(receipt,sender);self.assertEqual(sender.call_count,1)
            lead=self.client.rows[('/fixture/tz_test_leads',receipt)]
            self.assertEqual(lead['status'],'notification_pending')
            marker=self.client.rows[('/fixture/tz_test_leads','sent:'+receipt)]
            self.assertTrue(marker['telegram_sent'])
            self.assertEqual(marker['telegram_message_id'],'42')
    def test_failure_then_private_retry(self):
        receipt=self.save()
        with self.assertRaises(RuntimeError): self.store.notify(receipt,Mock(side_effect=RuntimeError('timeout')))
        self.assertEqual(len(self.client.rows),1)
        self.assertEqual(self.store.notify(receipt,lambda _:17),'sent')
    def test_lost_marker_ack_allows_duplicate_but_keeps_lead(self):
        receipt=self.save();sender=Mock(return_value=21);self.client.fail_write=True
        with self.assertRaises(RuntimeError): self.store.notify(receipt,sender)
        self.client.fail_write=False;self.store.notify(receipt,sender)
        self.assertEqual(sender.call_count,2)
        self.assertIsNotNone(self.client.rows[('/fixture/tz_test_leads',receipt)])
    def test_saved_response_on_telegram_failure_only_after_storage(self):
        proof=lambda *_:{'status':'ok','host':'tzvuka.ru'}
        sender=Mock(side_effect=RuntimeError('secret'))
        r=receive(event(),ENV,self.store,proof,NOW,sender=sender)
        self.assertEqual(r['statusCode'],200);self.assertEqual(json.loads(r['body'])['notification'],'pending')
        self.client.fail_write=True;sender.reset_mock()
        r=receive(event(),ENV,self.store,proof,NOW,sender=sender)
        self.assertEqual(r['statusCode'],503);sender.assert_not_called()
    def test_invalid_receipt_and_incorrect_message_never_mark_sent(self):
        with self.assertRaises(ValueError): self.store.notify('../other',Mock())
        receipt=self.save()
        for message in (None,True,0):
            with self.assertRaises(RuntimeError): self.store.notify(receipt,lambda _:message)
        self.assertEqual(len(self.client.rows),1)
    def test_private_retry_disabled_and_http_cannot_select_it(self):
        with patch.dict(index.os.environ,{},clear=True),patch.object(index,'get_store') as get:
            self.assertEqual(index.handler({'retryReceipt':'fixture'},None),{'ignored':True});get.assert_not_called()
        with patch.dict(index.os.environ,{'DELIVERY_ENABLED':'true'},clear=True),patch.object(index,'get_store',return_value=self.store):
            receipt=self.save()
            with patch.object(index,'telegram',return_value=42):
                self.assertEqual(index.handler({'retryReceipt':receipt},None),{'notification':'sent'})
    def test_rate_limit_is_per_instance_and_expires(self):
        self.assertTrue(all(self.store.rate_limit('fixture',NOW) for _ in range(5)))
        self.assertFalse(self.store.rate_limit('fixture',NOW))
        self.assertTrue(self.store.rate_limit('fixture',NOW+60000))

    def test_telegram_direct_address_keeps_certificate_hostname_validation(self):
        connection=index.TelegramConnection('api.telegram.org','149.154.167.220',timeout=8)
        self.assertTrue(connection._context.check_hostname)
        self.assertEqual(connection._context.verify_mode,ssl.CERT_REQUIRED)
        raw=Mock()
        with patch.object(index.socket,'create_connection',return_value=raw) as connect, \
             patch.object(connection._context,'wrap_socket',return_value=Mock()) as wrap:
            connection.connect()
        connect.assert_called_once_with(('149.154.167.220',443),8,None)
        wrap.assert_called_once_with(raw,server_hostname='api.telegram.org')
        for host,address in [('other.invalid','149.154.167.220'),('api.telegram.org','127.0.0.1')]:
            with self.assertRaises(RuntimeError):index.TelegramConnection(host,address,timeout=8)
