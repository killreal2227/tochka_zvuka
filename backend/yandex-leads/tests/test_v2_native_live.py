"""Opt-in native RPC smoke, NEVER enabled by CI or without owner approval.

Writes four clearly synthetic records in the existing leads table. No Telegram
sender and no fake delivery markers. This checks YDB, not live SmartCaptcha.
"""
import hashlib
import json
import os
import sys
from pathlib import Path
import time
import unittest
import uuid
from datetime import datetime,timezone

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import admin
from bulk_store import BulkStore
from service import NOTICE_VERSION


@unittest.skipUnless(os.environ.get('TZ_V2_NATIVE_WRITE_APPROVED')=='etntmjbnguvsu5l8bv3s:four-synthetic',
                     'Owner approval for native YDB writes required; no Telegram calls')
class NativeV2Smoke(unittest.TestCase):
    def test_v1_v2_both_branches_persistence_and_identical_retry(self):
        driver=admin.connect()
        try:
            plan=admin.schema_plan(driver.table_client.session().create())
            self.assertFalse(plan['add_nullable_columns'],'Apply the reviewed migration first')
            self.assertTrue(plan['ttl_configured'],'Confirm native TTL configuration before any smoke writes')
            store=BulkStore(driver.table_client,admin.DATABASE,admin.PREFIX,metadata_enabled=True)
            for version in (1,2):
                for branch in ('kaluga','troitsk'):
                    now=int(time.time()*1000)
                    stamp=datetime.fromtimestamp(now/1000,timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
                    data=dict(schemaVersion=version,requestId=str(uuid.uuid4()),createdAt=stamp,
                              name='SyntheticNative',surname='Fixture' if version==1 else '',
                              phone='+79990000000',branch=branch,direction='unsure',website='',pagePath='/'+branch+'/')
                    if version==1:
                        data['consent']=dict(accepted=True,acceptedAt=stamp,version='2026-11-10-v3',
                            documentUrl='https://tzvuka.ru/documents/#consent',privacyUrl='https://tzvuka.ru/documents/#privacy')
                    else:data['privacyNoticeVersion']=NOTICE_VERSION
                    digest=hashlib.sha256(json.dumps(data,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
                    receipt=store.save(data,digest,now)
                    self.assertEqual(store.save(data,digest,now+1),receipt)
                    row=store._read('leads',{'request_id':receipt},{'request_id':__import__('ydb').PrimitiveType.Utf8})
                    self.assertEqual(row['request_schema_version'],version)
                    self.assertEqual(row['branch'],branch)
                    self.assertEqual(row['received_at_ms'],now)
        finally:driver.stop()
