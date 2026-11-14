"""SDK serialization and transactional sequencing; NOT YDB engine compatibility proof."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import ydb
from ydb import convert
from ydb_store import YdbStore,RequestConflict,shard_for
from test_service import payload,NOW

class Tx:
    def __init__(self,results): self.results=list(results);self.calls=[];self.committed=False
    def __enter__(self): return self
    def __exit__(self,*args): return False
    def execute(self,query,parameters,commit_tx=False):
        # Uses the installed official SDK codec for every parameter, not a SQLite substitute.
        convert.parameters_to_pb(query.parameters_types,parameters)
        self.calls.append((query.yql_text,parameters,commit_tx))
        if commit_tx: self.committed=True
        rows=self.results.pop(0) if self.results else []
        return [SimpleNamespace(rows=rows)]
    def commit(self): self.committed=True
    def rollback(self): self.rolled_back=True
class Pool:
    def __init__(self,results): self.tx=Tx(results);self.mode=None;self.retry_settings=None
    def transaction(self,mode): self.mode=mode;return self.tx
    def retry_operation_sync(self,callee,settings): self.retry_settings=settings;return callee(self)
class AdapterTests(unittest.TestCase):
    def test_atomic_lead_and_outbox_in_same_serializable_transaction(self):
        pool=Pool([[],[],[]]);store=YdbStore(pool);p=payload()
        lead_id=store.save(p,"fixture-hash",NOW)
        self.assertTrue(lead_id);self.assertEqual(type(pool.mode),ydb.SerializableReadWrite)
        calls=pool.tx.calls;self.assertEqual(len(calls),3)
        self.assertIn("INSERT INTO `tz_site_leads`",calls[1][0])
        self.assertIn("INSERT INTO `tz_site_outbox`",calls[2][0])
        self.assertFalse(calls[1][2]);self.assertTrue(calls[2][2])
        self.assertTrue(pool.retry_settings.idempotent)
    def test_duplicate_does_not_insert_and_conflict_does_not_commit(self):
        p=payload();pool=Pool([[SimpleNamespace(payload_hash="same",lead_id="fixture")]])
        self.assertEqual(YdbStore(pool).save(p,"same",NOW),"fixture");self.assertEqual(len(pool.tx.calls),1)
        pool=Pool([[SimpleNamespace(payload_hash="other",lead_id="fixture")]])
        with self.assertRaises(RequestConflict):YdbStore(pool).save(p,"same",NOW)
        self.assertFalse(pool.tx.committed);self.assertTrue(pool.tx.rolled_back)
    def test_rate_rechecks_both_keys_and_limits_without_write(self):
        pool=Pool([[SimpleNamespace(bucket_key="key",hits=5)]])
        self.assertFalse(YdbStore(pool).rate_limit("key",NOW));self.assertEqual(len(pool.tx.calls),1)
        pool=Pool([[],[]]);self.assertTrue(YdbStore(pool).rate_limit("key",NOW))
        self.assertIn("UPSERT",pool.tx.calls[-1][0]);self.assertTrue(pool.tx.calls[-1][2])
    def test_claim_has_lease_and_finish_is_fenced(self):
        p=payload();row=SimpleNamespace(state="pending",next_attempt_ms=0,lease_until_ms=0,attempts=0)
        pool=Pool([[row],[{"request_id":p["requestId"]}],[]])
        claim=YdbStore(pool).claim(p["requestId"],NOW)
        self.assertEqual(claim["attempts"],1);self.assertEqual(pool.tx.calls[-1][1]["$until"],NOW+90000)
        pool=Pool([[SimpleNamespace(lease_token="other")]])
        self.assertFalse(YdbStore(pool).finish(p["requestId"],"token",NOW,1,42))
        self.assertEqual(len(pool.tx.calls),1)
    def test_delivery_confirmation_and_retry_are_transactional(self):
        p=payload()
        for message in (None,42):
            pool=Pool([[SimpleNamespace(lease_token="token")],[],[]])
            self.assertTrue(YdbStore(pool).finish(p["requestId"],"token",NOW,1,message))
            self.assertTrue(pool.tx.committed)
            self.assertEqual(any("telegram_sent=true" in c[0] for c in pool.tx.calls),message is not None)
    def test_due_uses_sync_index_and_bounded_scan(self):
        pool=Pool([[],[],[],[]]);self.assertEqual(YdbStore(pool).due(NOW),[])
        self.assertEqual(len(pool.tx.calls),4)
        self.assertTrue(all("VIEW due_idx" in c[0] for c in pool.tx.calls))
    def test_prefix_rejects_injection(self):
        with self.assertRaises(ValueError):YdbStore(None,"bad`; DROP")
        self.assertIn(shard_for("fixture"),range(4))
