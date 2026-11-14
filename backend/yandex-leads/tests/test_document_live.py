"""Explicit future private smoke, never run by ordinary tests or schema creation."""
import os
import subprocess
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from document_api import DocumentAPI
from document_store import DocumentStore
from storage_errors import RequestConflict,StorageUnavailable
from test_service import payload,NOW

APPROVED=os.environ.get('YDB_DOCUMENT_SMOKE_ALLOW')=='I_APPROVE_SYNTHETIC_DOCUMENT_WRITES'
ENDPOINT='https://docapi.serverless.yandexcloud.net/ru-central1/b1gs93r1fhsuparnmrba/etntmjbnguvsu5l8bv3s'
TABLE='tz_site_test_20261114_documents'

@unittest.skipUnless(APPROVED,'Cloud writes forbidden by default; explicit approval required')
class LiveDocumentSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Existing CLI authorization only; token is held in memory and never printed.
        cli=r'C:\Users\stepk\yandex-cloud\bin\yc.exe'
        token=subprocess.run([cli,'iam','create-token'],capture_output=True,text=True,encoding='utf-8',check=True).stdout.strip()
        cls.api=DocumentAPI(ENDPOINT,lambda:token)
        cls.store=DocumentStore(cls.api,TABLE)

    def test_atomic_create_duplicates_and_lease_fencing(self):
        data=payload();data.pop('captchaToken')
        with ThreadPoolExecutor(max_workers=2) as pool:
            ids=list(pool.map(lambda _:self.store.save(data,'synthetic-smoke',NOW),range(2)))
        self.assertEqual(ids[0],ids[1])
        with self.assertRaises(RequestConflict):self.store.save(dict(data,name='Different'),'changed',NOW)
        a=self.store.claim(data['requestId'],NOW)
        self.assertIsNone(self.store.claim(data['requestId'],NOW))
        b=self.store.claim(data['requestId'],NOW+90001)
        self.assertFalse(self.store.finish(data['requestId'],a['token'],NOW+90002,1,42))
        self.assertTrue(self.store.finish(data['requestId'],b['token'],NOW+90002,2,43))
        # Numeric Telegram IDs above are synthetic persistence markers; NO Telegram API is called.
        self.assertEqual(self.store.save(data,'synthetic-smoke',NOW),ids[0])
        self.assertIsNone(self.store.claim(data['requestId'],NOW+100000))

    def test_commit_reply_loss_and_persisted_intent(self):
        data=payload();data.pop('captchaToken')
        api=self.api;lost=[False]
        class LostReply:
            def call(self,operation,request):
                result=api.call(operation,request)
                if operation=='PutItem' and not lost[0]:
                    lost[0]=True;raise StorageUnavailable('Synthetic lost acknowledgement')
                return result
        receipt=DocumentStore(LostReply(),TABLE).save(data,'synthetic-smoke',NOW)
        self.assertEqual(self.store.save(data,'synthetic-smoke',NOW),receipt)
        row=self.store._get('lead:'+data['requestId'])
        self.assertEqual(row['notify_state'],'pending')
        self.assertFalse(row['telegram_sent'])
