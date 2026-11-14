"""The cloud fixture must respect the production 5/min per-client rate limit."""
import sys
from pathlib import Path
import unittest
from unittest.mock import patch
import uuid

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from bulk_store import BulkStore
from test_bulk_mvp import Client
import private_function_smoke as fixture


class PrivateFixtureTests(unittest.TestCase):
    def test_separate_client_sessions_do_not_exhaust_one_clients_bucket(self):
        store=BulkStore(Client(),'/fixture','tz_test_',metadata_enabled=True)
        env={'PUBLIC_LEADS_ENABLED':'true','LEADS_SCHEMA_V2_ENABLED':'true',
             'DELIVERY_ENABLED':'false','RATE_HMAC_KEY':'local-fixture'}
        with patch.dict(fixture.os.environ,env,clear=True),patch.object(fixture.index,'get_store',return_value=store),patch.object(fixture.index,'verify',return_value={'status':'failed'}):
            result=fixture.handler({'testIds':[str(uuid.uuid4()) for _ in range(4)]},None)
        self.assertTrue(result['ok'],result)
        self.assertEqual(len(result['cases']),4)
        self.assertEqual(result['telegram_calls'],0)
        self.assertEqual([c['notification'] for c in result['cases']],['disabled','disabled','disabled','pending'])


if __name__=='__main__':unittest.main()
