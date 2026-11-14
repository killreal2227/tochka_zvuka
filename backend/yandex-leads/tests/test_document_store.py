"""Crash, concurrency and transport-contract tests; no cloud/network credentials."""
import copy
import io
import json
import unittest
import urllib.error
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from document_model import AtomicDocumentModel
from document_store import DocumentStore
from document_api import DocumentAPI,decode
from storage_errors import RequestConflict,StorageUnavailable,ConditionalFailed,DeliveryFailure
from test_service import payload,event,ENV,NOW
from service import receive,deliver_due
import index
import private_document_test

TABLE='tz_site_test_document_documents'
ENDPOINT='https://docapi.serverless.yandexcloud.net/ru-central1/b1gs93r1fhsuparnmrba/etntmjbnguvsu5l8bv3s'

class DocumentStoreTests(unittest.TestCase):
    def setUp(self):
        self.api=AtomicDocumentModel();self.store=DocumentStore(self.api,TABLE,sleep=lambda _:None)
        self.data=payload();self.data.pop('captchaToken')
    def save(self):return self.store.save(self.data,'hash',NOW)
    def row(self):return self.api.rows['lead:'+self.data['requestId']]

    def test_single_atomic_item_contains_application_and_notification(self):
        self.save();row=self.row()
        self.assertEqual(json.loads(row['payload_json']),self.data)
        self.assertEqual(row['notify_state'],'pending');self.assertFalse(row['telegram_sent'])
        self.assertEqual(len([x for x in self.api.calls if x[0]=='PutItem']),1)

    def test_concurrent_duplicate_has_one_receipt_and_never_replaces_payload(self):
        with ThreadPoolExecutor(max_workers=12) as pool:ids=list(pool.map(lambda _:self.save(),range(24)))
        self.assertEqual(len(set(ids)),1);self.assertEqual(len(self.api.rows),1)
        changed=dict(self.data,name='Different')
        with self.assertRaises(RequestConflict):self.store.save(changed,'different',NOW)
        self.assertEqual(json.loads(self.row()['payload_json']),self.data)

    def test_lost_save_reply_is_resolved_by_strong_read(self):
        self.api.fail('PutItem','after');receipt=self.save()
        self.assertEqual(receipt,self.row()['lead_id'])
        self.assertEqual(len(self.api.rows),1)

    def test_no_write_confirmation_means_no_success(self):
        self.api.fail('PutItem','before')
        with self.assertRaises(StorageUnavailable):self.save()
        self.assertEqual(self.api.rows,{})

    def test_commit_then_lost_read_returns_503_then_same_id_on_retry(self):
        p=payload();self.api.fail('PutItem','after');self.api.fail('GetItem','before')
        verify=lambda *_:{'status':'ok','host':'tzvuka.ru'}
        a=receive(event(p),ENV,self.store,verify,NOW)
        self.assertEqual(a['statusCode'],503)
        p['captchaToken']='fresh-proof'
        b=receive(event(p),ENV,self.store,verify,NOW)
        self.assertEqual(b['statusCode'],200)
        self.assertEqual(len([r for r in self.api.rows.values() if r['kind']=='lead']),1)

    def test_crash_after_save_does_not_lose_notification(self):
        self.save();restarted=DocumentStore(self.api,TABLE,sleep=lambda _:None)
        sent=[];result=deliver_due(restarted,lambda r:sent.append(r['request_id']) or 42,NOW)
        self.assertEqual(result['sent'],1);self.assertEqual(sent,[self.data['requestId']])
        self.assertTrue(self.row()['telegram_sent'])

    def test_only_one_concurrent_lease_and_duplicate_save_preserves_it(self):
        receipt=self.save()
        with ThreadPoolExecutor(max_workers=12) as pool:
            claims=list(pool.map(lambda _:self.store.claim(self.data['requestId'],NOW),range(24)))
        self.assertEqual(sum(x is not None for x in claims),1)
        before=copy.deepcopy(self.row());self.assertEqual(self.save(),receipt)
        self.assertEqual(self.row(),before)

    def test_stale_version_cannot_overwrite_newer_delivery_state(self):
        self.save();before=self.store._get('lead:'+self.data['requestId'])
        self.store.claim(self.data['requestId'],NOW)
        stale=dict(before,notify_state='sent',telegram_sent=True)
        self.assertFalse(self.store._cas(before,stale))
        self.assertFalse(self.row()['telegram_sent'])
        self.assertTrue(self.row()['lease_token'])

    def test_lost_claim_reply_never_causes_send_without_confirmed_lease(self):
        self.save();self.api.fail('PutItem','after')
        with self.assertRaises(StorageUnavailable):self.store.claim(self.data['requestId'],NOW)
        self.assertIsNone(self.store.claim(self.data['requestId'],NOW+1))
        self.assertIsNotNone(self.store.claim(self.data['requestId'],NOW+90001))

    def test_expired_lease_recovery_fences_old_sender(self):
        self.save();a=self.store.claim(self.data['requestId'],NOW)
        b=self.store.claim(self.data['requestId'],NOW+90001)
        self.assertFalse(self.store.finish(self.data['requestId'],a['token'],NOW+90002,1,42))
        self.assertTrue(self.store.finish(self.data['requestId'],b['token'],NOW+90002,2,43))
        self.assertEqual(self.row()['telegram_message_id'],'43')

    def test_lost_finish_reply_preserves_sent_state_and_no_repeat(self):
        self.save();claim=self.store.claim(self.data['requestId'],NOW)
        self.api.fail('PutItem','after')
        with self.assertRaises(StorageUnavailable):self.store.finish(self.data['requestId'],claim['token'],NOW,1,42)
        self.assertTrue(self.row()['telegram_sent']);self.save()
        self.assertEqual(self.store.due(NOW+100000),[])

    def test_failure_before_finish_retains_event_for_retry(self):
        self.save();claim=self.store.claim(self.data['requestId'],NOW);self.api.fail('PutItem','before')
        with self.assertRaises(StorageUnavailable):self.store.finish(self.data['requestId'],claim['token'],NOW,1,42)
        self.assertFalse(self.row()['telegram_sent'])
        self.assertIsNotNone(self.store.claim(self.data['requestId'],NOW+90001))

    def test_retry_after_and_permanent_failure_preserve_application(self):
        self.save();c=self.store.claim(self.data['requestId'],NOW)
        self.store.finish(self.data['requestId'],c['token'],NOW,1,failure=DeliveryFailure('telegram_429',120))
        self.assertGreaterEqual(self.row()['next_attempt_ms'],NOW+120000)
        self.assertIsNone(self.store.claim(self.data['requestId'],NOW+119999))
        c=self.store.claim(self.data['requestId'],NOW+120000)
        self.store.finish(self.data['requestId'],c['token'],NOW+120000,2,failure=DeliveryFailure('telegram_403',permanent=True))
        self.assertEqual(self.row()['notify_state'],'attention')
        self.assertEqual(json.loads(self.row()['payload_json']),self.data)

    def test_attempt_limit_retains_attention_item(self):
        self.save();now=NOW
        for _ in range(12):
            c=self.store.claim(self.data['requestId'],now)
            self.store.finish(self.data['requestId'],c['token'],now,c['attempts'])
            now=self.row()['next_attempt_ms']
        self.assertEqual(self.row()['notify_state'],'attention');self.assertEqual(self.row()['attempts'],12)

    def test_pagination_empty_filtered_pages_and_restart_cursor(self):
        self.api.page_size=1;self.save()
        lead=self.api.rows.pop('lead:'+self.data['requestId']);lead['pk']='lead:zzzz';lead['request_id']='zzzz'
        for i in range(20):self.api.rows['lead:a'+str(i).zfill(3)]=dict(lead,pk='lead:a'+str(i).zfill(3),notify_state='sent')
        self.api.rows[lead['pk']]=lead
        found=[]
        for _ in range(4):
            restarted=DocumentStore(self.api,TABLE,sleep=lambda _:None)
            found.extend(restarted.due(NOW))
        self.assertIn('zzzz',found)

    def test_cursor_advance_before_crash_does_not_delete_pending_work(self):
        self.save();self.assertIn(self.data['requestId'],self.store.due(NOW))
        self.assertIn(self.data['requestId'],DocumentStore(self.api,TABLE).due(NOW))
        self.assertEqual(self.row()['notify_state'],'pending')

    def test_concurrent_rate_counter_cannot_exceed_global_or_ip_limit(self):
        with ThreadPoolExecutor(max_workers=12) as pool:
            results=list(pool.map(lambda _:self.store.rate_limit('hash',NOW,limit=2),range(12)))
        self.assertEqual(sum(results),2)
        self.assertTrue(self.store.rate_limit('different-hash',NOW,global_limit=3))
        self.assertFalse(self.store.rate_limit('third-hash',NOW,global_limit=3))

    def test_no_success_for_corrupted_receipt_without_intent(self):
        self.save();del self.row()['notify_state']
        with self.assertRaises(StorageUnavailable):self.save()

    def test_all_writes_are_conditional_and_all_reads_strong(self):
        self.save();self.store.rate_limit('key',NOW);self.store.due(NOW)
        c=self.store.claim(self.data['requestId'],NOW);self.store.finish(self.data['requestId'],c['token'],NOW,1,42)
        self.assertTrue(all('ConditionExpression' in r for op,r in self.api.calls if op=='PutItem'))
        self.assertTrue(all(r['ConsistentRead'] for op,r in self.api.calls if op in ('GetItem','Scan')))

class DocumentTransportTests(unittest.TestCase):
    def test_private_harness_disabled_by_default(self):
        with patch.dict(index.os.environ,{},clear=True),patch.object(index,'get_store') as store:
            self.assertEqual(private_document_test.handler({},None)['statusCode'],503)
            store.assert_not_called()

    def test_private_harness_fixed_data_and_real_host_check(self):
        p=payload();request={k:p[k] for k in ('requestId','createdAt','branch','captchaToken')}
        api=AtomicDocumentModel();store=DocumentStore(api,TABLE)
        env={'PRIVATE_SYNTHETIC_TEST_MODE':'true','PUBLIC_LEADS_ENABLED':'false','DELIVERY_ENABLED':'false',
             'YDB_DOCUMENT_TABLE':'tz_site_test_20261114_documents','SMARTCAPTCHA_SERVER_KEY':'fixture'}
        with patch.dict(index.os.environ,env,clear=True),patch.object(index,'get_store',return_value=store),\
             patch.object(index,'post',return_value={'status':'ok','host':'localhost:8767'}),\
             patch.object(private_document_test.time,'time',return_value=NOW/1000):
            a=private_document_test.handler(request,None)
            self.assertEqual(a['statusCode'],200)
            request['captchaToken']='fresh'
            b=private_document_test.handler(request,None)
            self.assertEqual(json.loads(a['body'])['leadId'],json.loads(b['body'])['leadId'])
            request['name']='Real person'
            self.assertEqual(private_document_test.handler(request,None)['statusCode'],400)
        row=next(r for r in api.rows.values() if r['kind']=='lead')
        self.assertEqual(json.loads(row['payload_json'])['name'],'Synthetic')
        self.assertFalse(row['telegram_sent'])

    def test_private_harness_rejects_empty_or_production_captcha_host(self):
        p=payload();request={k:p[k] for k in ('requestId','createdAt','branch','captchaToken')}
        env={'PRIVATE_SYNTHETIC_TEST_MODE':'true','PUBLIC_LEADS_ENABLED':'false','DELIVERY_ENABLED':'false',
             'YDB_DOCUMENT_TABLE':'tz_site_test_20261114_documents','SMARTCAPTCHA_SERVER_KEY':'fixture'}
        for host in ('','tzvuka.ru'):
            with patch.dict(index.os.environ,env,clear=True),patch.object(index,'get_store') as store,\
                 patch.object(index,'post',return_value={'status':'ok','host':host}),\
                 patch.object(private_document_test.time,'time',return_value=NOW/1000):
                self.assertEqual(private_document_test.handler(request,None)['statusCode'],403)
                store.assert_not_called()

    def test_ydb_normalized_numbers_and_invalid_fractions(self):
        self.assertEqual(decode({'version':{'N':'.2e1'}}),{'version':2})
        for value in ('NaN','Infinity','1.25','not-a-number'):
            with self.assertRaises(StorageUnavailable):decode({'version':{'N':value}})

    def test_endpoint_guard_and_no_extra_operations(self):
        for endpoint in (ENDPOINT.replace('https:','http:'),ENDPOINT.replace('etntmjbnguvsu5l8bv3s','learning'),ENDPOINT+'?x=1'):
            with self.assertRaises(RuntimeError):DocumentAPI(endpoint,lambda:'fixture')
        with self.assertRaises(ValueError):DocumentAPI(ENDPOINT,lambda:'fixture').call('CreateTable',{})

    def test_bearer_auth_target_and_conditional_errors_without_leaks(self):
        class Opener:
            def open(self,request,timeout):
                self.request=request
                raise urllib.error.HTTPError(request.full_url,400,'failed',{},io.BytesIO(b'{"__type":"ConditionalCheckFailedException"}'))
        opener=Opener();api=DocumentAPI(ENDPOINT,lambda:'fixture-IAM',opener)
        with self.assertRaises(ConditionalFailed):api.call('PutItem',{})
        self.assertEqual(opener.request.get_header('Authorization'),'Bearer fixture-IAM')
        self.assertEqual(opener.request.get_header('X-amz-target'),'DynamoDB_20120810.PutItem')

    def test_telegram_429_and_403_classified_without_sending(self):
        lead={'request_id':'fixture','name':'Synthetic','surname':'Test','phone':'+79990000000','branch':'kaluga','direction':'vocal'}
        env={'TELEGRAM_CHAT_KALUGA':'fixture','TELEGRAM_BOT_TOKEN':'fixture'}
        for code in (429,403):
            error=urllib.error.HTTPError('https://example.test',code,'fixture',{},io.BytesIO(json.dumps({'parameters':{'retry_after':120}}).encode()))
            with patch.dict(index.os.environ,env),patch.object(index,'post',side_effect=error):
                with self.assertRaises(DeliveryFailure) as caught:index.telegram(lead)
            self.assertEqual(caught.exception.permanent,code==403)
            if code==429:self.assertEqual(caught.exception.retry_after,120)
