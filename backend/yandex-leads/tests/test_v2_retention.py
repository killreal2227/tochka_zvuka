import copy
import hashlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch, mock_open

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import admin
import index
import ydb
from bulk_store import BulkStore, LEGAL_TYPES, struct
from retention import three_years_after
from service import receive, NOTICE_VERSION
from storage_errors import RequestDeleted
from test_service import payload, event, ENV, NOW
from test_bulk_mvp import Client


def v2(branch='kaluga'):
    data=payload();data.pop('consent')
    data.update(schemaVersion=2,privacyNoticeVersion=NOTICE_VERSION,surname='',branch=branch,pagePath='/'+branch+'/')
    return data


class V2Tests(unittest.TestCase):
    def setUp(self):
        self.client=Client();self.store=BulkStore(self.client,admin.DATABASE,admin.PREFIX,metadata_enabled=True)
        self.env=dict(ENV,LEADS_SCHEMA_V2_ENABLED='true')
        self.proof=lambda *_:{'status':'ok','host':'tzvuka.ru'}

    def submit(self,data,now=NOW,sender=None,proof=None):
        return receive(event(data),self.env,self.store,proof or self.proof,now,sender=sender)

    def rows(self):
        return list(self.client.rows.values())

    def test_both_branches_v1_v2_persist_before_branch_delivery(self):
        for version in (1,2):
            for branch in ('kaluga','troitsk'):
                data=v2(branch) if version==2 else payload()
                data.update(branch=branch,pagePath='/'+branch+'/')
                def sender(lead):
                    self.assertIsNotNone(self.store._read('leads',{'request_id':lead['request_id']},{'request_id':ydb.PrimitiveType.Utf8}))
                    self.assertEqual(lead['branch'],branch)
                    return 30
                result=self.submit(data,sender=sender)
                self.assertEqual(result['statusCode'],200)
                receipt=json.loads(result['body'])['leadId']
                row=self.store._read('leads',{'request_id':receipt},{'request_id':ydb.PrimitiveType.Utf8})
                self.assertEqual(row['request_schema_version'],version)
                self.assertEqual(row['received_at_ms'],NOW)
                self.assertEqual(row['legal_basis'],'152-FZ:6:1:5')
                self.assertEqual(row['consent_accepted_at'],'' if version==2 else data['consent']['acceptedAt'])

    def test_v1_receipt_unchanged_and_legacy_not_consent(self):
        data=payload();business={k:v for k,v in data.items() if k!='captchaToken'}
        old=hashlib.sha256(json.dumps(business,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
        response=json.loads(self.submit(data)['body'])
        self.assertEqual(response['leadId'],data['requestId']+':'+old)
        self.assertEqual(self.rows()[0]['legacy_consent_status'],'legacy_unverified')

    def test_retry_preserves_server_evidence_retention_and_marker(self):
        data=v2();sender=Mock(return_value=17)
        first=json.loads(self.submit(data,sender=sender)['body']);original=copy.deepcopy(self.rows())
        data['captchaToken']='new-proof'
        second=json.loads(self.submit(data,now=NOW+60000,sender=sender)['body'])
        self.assertEqual(first['leadId'],second['leadId']);self.assertEqual(self.rows(),original)
        self.assertEqual(sender.call_count,1)

    def test_telegram_failure_preserves_intent_then_retry(self):
        data=v2();failed=Mock(side_effect=RuntimeError('sensitive'))
        result=json.loads(self.submit(data,sender=failed)['body'])
        self.assertTrue(result['saved']);self.assertEqual(result['notification'],'pending')
        self.assertEqual(len(self.rows()),1)
        self.assertEqual(self.store.notify(result['leadId'],lambda _:44),'sent')

    def test_no_success_or_delivery_on_ydb_failure(self):
        self.client.fail_write=True;sender=Mock(return_value=9)
        self.assertEqual(self.submit(v2(),sender=sender)['statusCode'],503)
        sender.assert_not_called()
        self.client.fail_write=False;self.client.hide=True
        self.assertEqual(self.submit(v2(),sender=sender)['statusCode'],503)
        sender.assert_not_called()

    def test_captcha_and_strict_contract_errors(self):
        for proof in ({},{'status':'ok','host':'evil.example'},{'status':'failed','host':'tzvuka.ru'}):
            self.assertEqual(self.submit(v2(),proof=lambda *_,p=proof:p)['statusCode'],403)
        for key,value in [('consent',{'accepted':True}),('legalBasis','anything'),('privacyNoticeVersion','unknown'),('surname','X')]:
            self.store._buckets.clear()
            data=v2();data[key]=value
            self.assertEqual(self.submit(data)['statusCode'],400)
        self.assertFalse(self.rows())

    def test_v2_gate_and_maintenance_keep_v1_available(self):
        self.env.pop('LEADS_SCHEMA_V2_ENABLED')
        self.assertEqual(self.submit(v2())['statusCode'],400)
        self.assertEqual(self.submit(payload())['statusCode'],200)
        self.env['LEADS_MAINTENANCE']='true'
        self.assertEqual(self.submit(payload())['statusCode'],503)

    def test_bounded_specific_deletion_all_versions_and_copies(self):
        data=v2();first=json.loads(self.submit(data,sender=lambda _:21)['body'])['leadId']
        data['direction']='guitar';self.submit(data,sender=lambda _:22)
        plan=admin.make_plan(self.rows(),receipt=first,now_ms=NOW)
        self.assertEqual(len(plan['rows']),4)
        with self.assertRaises(ValueError):admin.erase(self.store,plan,plan['confirmation'],now_ms=NOW)
        with self.assertRaises(ValueError):admin.erase(self.store,plan,'wrong',maintenance=True,now_ms=NOW)
        result=admin.erase(self.store,plan,plan['confirmation'],maintenance=True,now_ms=NOW)
        self.assertEqual(result['status'],'purge_scheduled_not_confirmed')
        self.assertEqual(self.submit(data)['statusCode'],409)
        with self.assertRaises(RequestDeleted):self.store.notify(first,Mock())
        for row in self.rows():
            self.assertEqual(row['phone'],'');self.assertEqual(row['name'],'')
            self.assertIsNotNone(row['purge_at_ms'])

    def test_stale_plan_prevents_any_mutation(self):
        receipt=json.loads(self.submit(v2())['body'])['leadId']
        plan=admin.make_plan(self.rows(),receipt=receipt,now_ms=NOW)
        self.rows()[0]['direction']='guitar';before=copy.deepcopy(self.rows())
        with self.assertRaises(ValueError):admin.erase(self.store,plan,plan['confirmation'],maintenance=True,now_ms=NOW)
        self.assertEqual(self.rows(),before)

    def test_orphan_sent_copy_can_be_replanned_after_partial_ttl_completion(self):
        receipt=json.loads(self.submit(v2(),sender=lambda _:19)['body'])['leadId']
        self.client.rows.pop((admin.TABLE,receipt))
        plan=admin.make_plan(self.rows(),receipt=receipt,now_ms=NOW)
        self.assertEqual([r['key'] for r in plan['rows']],['sent:'+receipt])
        admin.erase(self.store,plan,plan['confirmation'],maintenance=True,now_ms=NOW)
        self.assertEqual(self.rows()[0]['phone'],'')

    def test_expired_selection_and_no_mass_or_live_version_deletion(self):
        receipt=json.loads(self.submit(v2())['body'])['leadId']
        with self.assertRaises(ValueError):admin.make_plan(self.rows(),expired=True,now_ms=NOW)
        future=three_years_after(NOW)+1
        plan=admin.make_plan(self.rows(),expired=True,now_ms=future)
        self.assertEqual(len(plan['rows']),1)
        with self.assertRaises(ValueError):admin.make_plan(self.rows(),expired=True,limit=1000,now_ms=future)
        broken=copy.deepcopy(plan);broken['database']='/wrong'
        with self.assertRaises(ValueError):admin.check_plan(broken,plan['confirmation'])

    def test_calendar_years_and_official_sdk_serialization(self):
        from datetime import datetime,timezone
        leap=int(datetime(2024,2,29,tzinfo=timezone.utc).timestamp()*1000)
        self.assertEqual(datetime.fromtimestamp(three_years_after(leap)/1000,timezone.utc).isoformat(),'2027-02-28T00:00:00+00:00')
        self.assertEqual(admin.ttl_settings().to_pb().value_since_unix_epoch.column_unit,
                         ydb._apis.ydb_table.ValueSinceUnixEpochModeSettings.UNIT_MILLISECONDS)
        # Real pinned SDK type descriptors/protobuf; not a SQLite compatibility claim.
        self.assertIn('received_at_ms',str(struct(LEGAL_TYPES)))

    def test_physical_delete_is_not_acknowledged_while_rows_or_guard_exist(self):
        receipt=json.loads(self.submit(v2())['body'])['leadId']
        plan=admin.make_plan(self.rows(),receipt=receipt,now_ms=NOW)
        admin.erase(self.store,plan,plan['confirmation'],maintenance=True,now_ms=NOW)
        self.assertEqual(admin.check_deleted(self.store,plan)['status'],'physical_delete_pending')
        self.client.rows.pop((admin.TABLE,receipt))  # emulate a TTL completion notification, not YDB validation
        self.assertEqual(admin.check_deleted(self.store,plan)['status'],'payload_deleted_replay_guard_pending')
        self.client.rows.pop((admin.TABLE,'deleted:'+receipt[:36]))
        self.assertEqual(admin.check_deleted(self.store,plan)['status'],'physical_delete_confirmed')

    def test_schema_migration_is_additive_and_refuses_existing_unrelated_ttl(self):
        columns=[ydb.Column(n,ydb.OptionalType(t)) for n,t in __import__('bulk_store').LEAD_TYPES.items()]
        session=Mock();session.describe_table.return_value=SimpleNamespace(columns=columns,ttl_settings=None)
        plan=admin.schema_plan(session)
        self.assertEqual(set(plan['add_nullable_columns']),set(__import__('retention').META_TEXT+__import__('retention').META_NUMBER))
        session.describe_table.return_value.ttl_settings=ydb.TtlSettings().with_date_type_column('other',100)
        with self.assertRaises(ValueError):admin.schema_plan(session)

    def test_official_sdk_serializes_live_and_cleared_rows_without_network(self):
        from ydb import _session_impl
        self.submit(v2())
        for row in (self.rows()[0],admin.clear_row('deleted:'+v2()['requestId'],NOW,tombstone=True)):
            request=_session_impl.bulk_upsert_request_factory(admin.TABLE,[row],struct(LEGAL_TYPES))
            self.assertGreater(len(request.SerializeToString()),0)

    def test_cli_plan_apply_and_pending_physical_check(self):
        from contextlib import redirect_stdout
        import io
        receipt=json.loads(self.submit(v2(),sender=lambda _:22)['body'])['leadId']
        session=Mock();session.create.return_value=session
        session.read_table.return_value=[SimpleNamespace(rows=self.rows())]
        self.client.session=lambda:session
        driver=Mock(table_client=self.client)
        with patch.object(admin,'connect',return_value=driver),patch.object(admin,'write_private') as write,redirect_stdout(io.StringIO()):
            self.assertEqual(admin.main(['plan','--receipt',receipt,'--plan','fixture-plan']),0)
        plan=write.call_args.args[1]
        with patch.object(admin,'connect',return_value=driver),patch.object(admin.Path,'read_text',return_value=json.dumps(plan)),patch.object(admin,'require_maintenance',return_value=True),patch.object(admin,'audit') as logged,redirect_stdout(io.StringIO()):
            args=['--plan','fixture-plan','--confirm',plan['confirmation']]
            self.assertEqual(admin.main(['apply',*args]),0)
            self.assertEqual(admin.main(['check',*args]),2)
            self.assertTrue(logged.called)

    def test_audit_has_no_phone_name_or_raw_key(self):
        data=v2();receipt=json.loads(self.submit(data)['body'])['leadId']
        plan=admin.make_plan(self.rows(),receipt=receipt,now_ms=NOW)
        with patch.object(admin.os,'open',return_value=42) as create,patch.object(admin.os,'fdopen',mock_open()) as opened:
            admin.audit('fixture-audit.jsonl',plan,{'status':'fixture'})
            body=''.join(call.args[0] for call in opened().write.call_args_list)
            self.assertEqual(create.call_args.args[-1],0o600)
            self.assertNotIn(data['phone'],body);self.assertNotIn(data['name'],body);self.assertNotIn(receipt,body)

    def test_maintenance_status_not_exposed_by_http(self):
        with patch.dict(index.os.environ,{'LEADS_MAINTENANCE':'true','LEADS_SCHEMA_V2_ENABLED':'true'},clear=True):
            self.assertEqual(index.handler({'adminStatus':True},None),{'maintenance':True,'schemaV2':True})
            self.assertNotEqual(index.handler(dict(event(),path='/adminStatus'),None),{'maintenance':True,'schemaV2':True})

    def test_maintenance_verifies_gateway_and_drains_active_version(self):
        route={'function_id':admin.FUNCTION,'tag':'fixture'}
        gateway={'openapi_spec':json.dumps({'paths':{'/leads':{'post':{'x-yc-apigateway-integration':route}}}})}
        version={'id':'fixture-version','tags':['fixture'],'environment':{'LEADS_MAINTENANCE':'true'},'execution_timeout':'3s'}
        elapsed=[0]
        def clock():return elapsed[0]
        def sleep(value):elapsed[0]+=value
        with patch.object(admin,'yc',side_effect=[gateway,[version],{'maintenance':True,'schemaV2':True},[version],gateway,{'maintenance':True,'schemaV2':True}]):
            self.assertTrue(admin.require_maintenance('fixture',clock=clock,sleep=sleep))
        self.assertEqual(elapsed[0],8)

    def test_gateway_metadata_accepts_json_and_safe_yaml(self):
        expected={'paths':{'/leads':{'post':{'enabled':True}}}}
        self.assertEqual(admin.gateway_spec(json.dumps(expected)),expected)
        self.assertEqual(admin.gateway_spec('paths:\n  /leads:\n    post:\n      enabled: true\n'),expected)


if __name__=='__main__':unittest.main()
