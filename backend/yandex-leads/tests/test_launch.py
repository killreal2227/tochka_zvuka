"""Critical release-contract tests. No cloud, database or Telegram connections."""
import base64
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch
from test_service import event, ENV, NOW, FakeStore
from service import receive
import index

ROOT=Path(__file__).resolve().parents[1]

class LaunchTests(unittest.TestCase):
    def test_gateway_1_base64_and_receipt(self):
        e=event();e['isBase64Encoded']=True
        e['body']=base64.b64encode(e['body'].encode()).decode()
        e['multiValueHeaders']={'Origin':['https://tzvuka.ru'],'Content-Type':['application/json']}
        result=receive(e,ENV,FakeStore(),lambda *_:{'status':'ok','host':'tzvuka.ru'},NOW)
        self.assertEqual(result['statusCode'],200)
        self.assertTrue(json.loads(result['body'])['saved'])

    def test_conflicting_headers_and_old_route_rejected(self):
        e=event();e['multiValueHeaders']={'Origin':['https://tzvuka.ru','https://evil.example']}
        self.assertEqual(receive(e,ENV,None,None,NOW)['statusCode'],400)
        e=event();e['path']='/public/lead'
        self.assertEqual(receive(e,ENV,None,None,NOW)['statusCode'],404)
        e=event();e['headers']['origin']='https://www.tzvuka.ru'
        self.assertEqual(receive(e,ENV,None,None,NOW)['statusCode'],403)

    def test_database_guard_before_driver_creation(self):
        for env in ({'YDB_DATABASE_LABEL':'tochka-learning','YDB_ENDPOINT':'grpcs://fixture'},
                    {'YDB_DATABASE_LABEL':'tochka-leads','YDB_ENDPOINT':'grpc://fixture'}):
            with patch.dict(os.environ,env,clear=True),patch.object(index,'_store',None),patch.object(index.ydb,'Driver') as driver:
                with self.assertRaises(RuntimeError): index.get_store()
                driver.assert_not_called()
        self.assertTrue(callable(index.ydb.iam.MetadataUrlCredentials))

    def test_release_contract_is_aligned_and_disabled(self):
        spec=json.loads((ROOT/'release/api-gateway.openapi.json').read_text(encoding='utf-8'))
        manifest=json.loads((ROOT/'release/manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(set(spec['paths']),{'/leads'})
        route=spec['paths']['/leads']
        self.assertEqual(route['x-yc-apigateway-cors']['origin'],'https://tzvuka.ru')
        integration=route['post']['x-yc-apigateway-integration']
        self.assertEqual(integration['payload_format_version'],'1.0')
        self.assertEqual(integration['context'],{'route':'website-leads-v1'})
        self.assertIn('service_account_id',integration)
        self.assertNotEqual(integration['tag'],'$latest')
        self.assertEqual(manifest['runtime'],'python312')
        self.assertEqual(manifest['database_name'],'tochka-leads')
        self.assertFalse(manifest['public_intake_enabled'])
        self.assertFalse(manifest['telegram_delivery_enabled'])
