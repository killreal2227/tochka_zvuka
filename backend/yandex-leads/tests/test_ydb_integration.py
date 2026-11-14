"""Opt-in REAL YDB tests. Never create/delete tables or contact a cloud by default."""
import concurrent.futures
import os
import sys
import unittest
import uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import ydb
from ydb_store import YdbStore,RequestConflict
from test_service import payload,NOW

ENABLED=(os.environ.get("YDB_TEST_ALLOW_WRITES")=="I_APPROVE_ISOLATED_TEST_TABLES"
         and os.environ.get("YDB_TEST_PREFIX","").startswith("tz_site_test_"))
@unittest.skipUnless(ENABLED,"Real YDB not configured/approved; unit tests are not engine validation")
class RealYdbTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.driver=ydb.Driver(endpoint=os.environ["YDB_TEST_ENDPOINT"],database=os.environ["YDB_TEST_DATABASE"],
                              credentials=ydb.credentials_from_env_variables())
        cls.driver.wait(timeout=5,fail_fast=True)
        cls.pool=ydb.SessionPool(cls.driver,size=5)
        cls.store=YdbStore(cls.pool,os.environ["YDB_TEST_PREFIX"])
    @classmethod
    def tearDownClass(cls):
        cls.pool.stop();cls.driver.stop()
    def test_concurrent_save_and_request_conflict(self):
        p=payload();digest="fixture-hash"
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            ids=list(pool.map(lambda _:self.store.save(p,digest,NOW),range(2)))
        self.assertEqual(ids[0],ids[1])
        with self.assertRaises(RequestConflict):self.store.save(p,"different",NOW)
    def test_queue_lease_recovery_and_delivery(self):
        p=payload();self.store.save(p,"fixture-hash",NOW)
        a=self.store.claim(p["requestId"],NOW);self.assertIsNotNone(a)
        self.assertIsNone(self.store.claim(p["requestId"],NOW))
        b=self.store.claim(p["requestId"],NOW+100000);self.assertIsNotNone(b)
        self.assertFalse(self.store.finish(p["requestId"],a["token"],NOW+100000,1,42))
        self.assertTrue(self.store.finish(p["requestId"],b["token"],NOW+100000,b["attempts"],42))
        self.assertIsNone(self.store.claim(p["requestId"],NOW+200000))
    def test_rate_limit_serialization(self):
        key="fixture-"+str(uuid.uuid4())
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            allowed=list(pool.map(lambda _:self.store.rate_limit(key,NOW,limit=2,global_limit=100000),range(4)))
        self.assertEqual(sum(allowed),2)
