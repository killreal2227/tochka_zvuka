"""Private, explicit YDB maintenance CLI. Never exposed through the API Gateway.

All writes require a bounded, fingerprinted plan and its exact confirmation hash.
Deletion requires a verified maintenance version and invocation drain interval.
No contacts, tokens, payloads or receipts are printed to the audit journal.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

import ydb
from bulk_store import BulkStore, LEAD_TYPES, LEGAL_TYPES, struct
from retention import META_TEXT, META_NUMBER, three_years_after

DATABASE = '/ru-central1/b1gs93r1fhsuparnmrba/etntmjbnguvsu5l8bv3s'
ENDPOINT = 'grpcs://ydb.serverless.yandexcloud.net:2135'
PREFIX = 'tz_site_test_20261114_'
TABLE = DATABASE + '/' + PREFIX + 'leads'
FUNCTION = 'd4ep7jlje5la3g8ohd70'
GATEWAY = 'd5d2psrdhd0snl30t7b0'
RECEIPT = re.compile(r'[0-9a-f-]{36}:[0-9a-f]{64}')
MAX_ROWS = 40  # including sent: copies; no unbounded --all option


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def sealed(plan):
    return dict(plan, confirmation=digest(plan))


def check_plan(plan, confirmation):
    body={k:v for k,v in plan.items() if k!='confirmation'}
    if (plan.get('confirmation')!=confirmation or digest(body)!=confirmation
        or plan.get('database')!=DATABASE or plan.get('table')!=TABLE):
        raise ValueError('plan_confirmation_mismatch')
    if plan.get('version')!=1 or plan.get('operation') not in ('schema','delete','retention'):
        raise ValueError('unsupported_plan')
    if plan['operation']!='schema':
        rows=plan.get('rows',[])
        if not 1<=len(rows)<=MAX_ROWS or len({r['key'] for r in rows})!=len(rows):
            raise ValueError('invalid_bounded_rows')
    return body


def due(row):
    if row.get('retention_due_ms') is not None:
        return row['retention_due_ms']
    # Legacy client clock is explicitly not independent server evidence.
    anchor=row.get('created_at_ms')
    return three_years_after(anchor) if type(anchor) is int and anchor>0 else None


def make_plan(rows, *, receipt=None, expired=False, now_ms=None, limit=5, within_days=0):
    now_ms=int(time.time()*1000) if now_ms is None else now_ms
    if bool(receipt)==bool(expired) or not 1<=limit<=20 or not 0<=within_days<=30 or (within_days and not expired):
        raise ValueError('choose_one_bounded_selector')
    if receipt and not RECEIPT.fullmatch(receipt):
        raise ValueError('invalid_receipt')
    rows=[dict(r) for r in rows]
    mains=[r for r in rows if RECEIPT.fullmatch(r.get('request_id',''))]
    if receipt:
        identities={receipt[:36]}
        if not any(RECEIPT.fullmatch(r.get('request_id','').removeprefix('sent:'))
                   and r['request_id'].removeprefix('sent:')[:36]==receipt[:36] for r in rows):
            raise ValueError('receipt_not_found')
    else:
        overdue=sorted((r for r in mains if due(r) is not None and due(r)<=now_ms+within_days*86400000),
                       key=lambda r:(due(r),r['request_id']))
        identities={r['request_id'][:36] for r in overdue[:limit]}
    selected=[]
    for row in rows:
        key=row.get('request_id','')
        base=key[5:] if key.startswith('sent:') else key
        if RECEIPT.fullmatch(base) and base[:36] in identities:
            # Never pull a live version into an expired-only deletion implicitly.
            if expired and (due(row) is None or due(row)>now_ms+within_days*86400000):
                raise ValueError('related_version_not_expired_use_specific_review')
            selected.append({'key':key,'fingerprint':digest(row),
                'branch':row.get('branch',''), 'telegram_message_id':row.get('telegram_message_id','')})
    if not selected or len(selected)>MAX_ROWS:
        raise ValueError('empty_or_oversized_plan')
    return sealed({'version':1,'operation':'delete','database':DATABASE,'table':TABLE,
                   'created_at_ms':now_ms,'selector':'expired' if expired else 'receipt','within_days':within_days,
                   'rows':sorted(selected,key=lambda r:r['key'])})


def validate_rows(store, plan):
    if not 1<=len(plan.get('rows',[]))<=MAX_ROWS:
        raise ValueError('row_count_rejected')
    found=[]
    for item in plan['rows']:
        key=item['key']; base=key[5:] if key.startswith('sent:') else key
        if not RECEIPT.fullmatch(base):
            raise ValueError('invalid_plan_key')
        row=store._read('leads',{'request_id':key},{'request_id':ydb.PrimitiveType.Utf8})
        if row is None or digest(row)!=item['fingerprint']:
            raise ValueError('plan_stale_no_write_performed')
        found.append(row)
    return found


def clear_row(key, now_ms, *, tombstone=False):
    row={k:'' for k in LEAD_TYPES if k not in ('created_at_ms','telegram_sent')}
    row.update(request_id=key,created_at_ms=0,telegram_sent=False,status='deleting')
    row.update({k:None for k in (*META_TEXT,*META_NUMBER)})
    # Keep a short-lived non-contact replay guard beyond the 24h request window.
    row['purge_at_ms']=now_ms+48*3600000 if tombstone else now_ms
    return row


def erase(store, plan, confirmation, *, maintenance=False, now_ms=None):
    check_plan(plan,confirmation)
    if plan.get('operation')!='delete' or not maintenance:
        raise ValueError('verified_drained_maintenance_required')
    now_ms=int(time.time()*1000) if now_ms is None else now_ms
    if not 0<=now_ms-plan['created_at_ms']<=3600000:
        raise ValueError('plan_expired')
    rows=validate_rows(store,plan)  # verify ALL rows before the first mutation
    identities={r['request_id'].removeprefix('sent:')[:36] for r in rows}
    for identity in sorted(identities):
        key='deleted:'+identity
        store._write_confirm('leads',clear_row(key,now_ms,tombstone=True),LEGAL_TYPES,{'request_id':key})
    for row in rows:
        key=row['request_id']
        store._write_confirm('leads',clear_row(key,now_ms),LEGAL_TYPES,{'request_id':key})
    return {'status':'purge_scheduled_not_confirmed','rows':len(rows)}


def check_deleted(store, plan):
    remaining=sum(store._read('leads',{'request_id':r['key']},{'request_id':ydb.PrimitiveType.Utf8}) is not None for r in plan['rows'])
    identities={r['key'].removeprefix('sent:')[:36] for r in plan['rows']}
    guards=sum(store._read('leads',{'request_id':'deleted:'+i},{'request_id':ydb.PrimitiveType.Utf8}) is not None for i in identities)
    status='physical_delete_pending' if remaining else ('payload_deleted_replay_guard_pending' if guards else 'physical_delete_confirmed')
    return {'status':status,'remaining':remaining,'guards_remaining':guards}


def yc(*args):
    result=subprocess.run(['yc',*args,'--format','json'],capture_output=True,text=True,check=False)
    if result.returncode:
        raise RuntimeError('yc_operation_failed')  # never echo CLI/token output
    if args[:2]==('iam','create-token'):
        try:
            return json.loads(result.stdout)
        except ValueError:
            value=result.stdout.strip()
            if not value or any(c.isspace() for c in value):
                raise RuntimeError('iam_token_unavailable') from None
            return value
    return json.loads(result.stdout)


def gateway_spec(value):
    if isinstance(value,dict):
        return value
    try:
        return json.loads(value)
    except ValueError:
        # Gateway may normalize the submitted JSON OpenAPI into YAML.
        import yaml  # admin-only dependency, never shipped with the function
        result=yaml.safe_load(value)
        if not isinstance(result,dict):
            raise ValueError('invalid_gateway_spec')
        return result


def require_maintenance(tag, *, clock=time.monotonic, sleep=time.sleep):
    gateway=yc('serverless','api-gateway','get','--id',GATEWAY,'--full')
    spec=gateway_spec(gateway.get('openapi'))
    route=spec['paths']['/leads']['post']['x-yc-apigateway-integration']
    if route.get('function_id')!=FUNCTION or route.get('tag')!=tag:
        raise ValueError('active_gateway_tag_mismatch')
    versions=yc('serverless','function','version','list','--function-id',FUNCTION)
    versions=versions if isinstance(versions,list) else versions.get('versions',[])
    active=[v for v in versions if tag in v.get('tags',[])]
    if len(active)!=1:
        raise ValueError('ambiguous_function_tag')
    version=active[0]
    timeout=version.get('execution_timeout',version.get('executionTimeout',''))
    if not re.fullmatch(r'\d+(?:\.\d+)?s',timeout):
        raise ValueError('unknown_execution_timeout')
    if version.get('environment',{}).get('LEADS_MAINTENANCE')!='true':
        raise ValueError('maintenance_not_enabled')
    def status():
        value=yc('serverless','function','invoke','--id',FUNCTION,'--tag',tag,
                 '--data','{"adminStatus":true}')
        if value.get('maintenance') is not True or value.get('schemaV2') is not True:
            raise ValueError('private_maintenance_probe_failed')
    status()
    timeouts=[v.get('execution_timeout',v.get('executionTimeout','')) for v in versions]
    if any(not re.fullmatch(r'\d+(?:\.\d+)?s',value) for value in timeouts):
        raise ValueError('unknown_prior_execution_timeout')
    end=clock()+max(float(value[:-1]) for value in timeouts)+5
    while clock()<end:
        sleep(min(5,end-clock()))
    # Prevent applying after the tag or gateway was moved during the drain wait.
    latest=yc('serverless','function','version','list','--function-id',FUNCTION)
    latest=latest if isinstance(latest,list) else latest.get('versions',[])
    if [v.get('id') for v in latest if tag in v.get('tags',[])]!=[version.get('id')]:
        raise ValueError('tag_changed_during_drain')
    gateway=yc('serverless','api-gateway','get','--id',GATEWAY,'--full')
    spec=gateway_spec(gateway['openapi'])
    if spec['paths']['/leads']['post']['x-yc-apigateway-integration']!=route:
        raise ValueError('gateway_changed_during_drain')
    status()
    return True


def connect():
    # Use existing yc authentication, never create a service-account key.
    token=yc('iam','create-token')
    # yc may emit the IAM token as a JSON string or a token response object.
    token=token if isinstance(token,str) else token.get('iam_token',token.get('iamToken'))
    if not token:
        raise RuntimeError('iam_token_unavailable')
    driver=ydb.Driver(endpoint=ENDPOINT,database=DATABASE,credentials=ydb.AccessTokenCredentials(token))
    driver.wait(timeout=8,fail_fast=True)
    return driver


def schema_plan(session):
    current=session.describe_table(TABLE)
    columns={c.name:c.type for c in current.columns}
    missing=[]
    for name in (*META_TEXT,*META_NUMBER):
        expected=LEGAL_TYPES[name]
        if name in columns and str(columns[name])!=str(expected):
            raise ValueError('schema_type_mismatch')
        if name not in columns:
            missing.append(name)
    ttl=getattr(current,'ttl_settings',None)
    if ttl is not None and ttl.to_pb().SerializeToString() not in (b'',ttl_settings().to_pb().SerializeToString()):
        raise ValueError('existing_ttl_not_overwritten')
    return sealed({'version':1,'operation':'schema','database':DATABASE,'table':TABLE,
                   'add_nullable_columns':missing,'ttl':'purge_at_ms:milliseconds:0',
                   'ttl_configured':ttl is not None and ttl.to_pb().SerializeToString()==ttl_settings().to_pb().SerializeToString()})


def ttl_settings():
    # Table API enum UNIT_MILLISECONDS=2; covered against the pinned SDK protobuf.
    return ydb.TtlSettings().with_value_since_unix_epoch('purge_at_ms',2,0)


def audit(path, plan, result):
    record={'at':datetime.now(timezone.utc).isoformat(),'plan_hash':plan['confirmation'],
            'operation':plan['operation'],**result}
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
    with os.fdopen(fd,'a',encoding='utf-8') as handle:
        handle.write(canonical(record)+'\n')


def write_private(path, value):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w',encoding='utf-8') as handle:
        handle.write(canonical(value)+'\n')


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['schema-plan','schema-apply','plan','apply','check','telegram-delete','telegram-manual-confirm','retention-plan','retention-apply'])
    parser.add_argument('--plan',required=True)
    parser.add_argument('--receipt');parser.add_argument('--expired',action='store_true')
    parser.add_argument('--limit',type=int,default=5);parser.add_argument('--confirm')
    parser.add_argument('--within-days',type=int,default=0)
    parser.add_argument('--tag',default='leads-public-20261114')
    parser.add_argument('--audit',default='leads-admin.local.jsonl')
    parser.add_argument('--anchor');parser.add_argument('--reason',choices=['meaningful_contact','training_ended','legacy_received'])
    args=parser.parse_args(argv)
    driver=None
    try:
        if args.action not in ('plan','schema-plan','retention-plan'):
            plan=json.loads(Path(args.plan).read_text(encoding='utf-8'))
            check_plan(plan,args.confirm)
        driver=connect();store=BulkStore(driver.table_client,DATABASE,PREFIX,metadata_enabled=True)
        session=driver.table_client.session().create()
        if args.action=='schema-plan':
            plan=schema_plan(session);write_private(args.plan,plan)
            print(canonical({'confirmation':plan['confirmation'],'operation':'schema'}))
        elif args.action=='schema-apply':
            if plan!=schema_plan(session):
                raise ValueError('schema_plan_stale')
            if plan['add_nullable_columns']:
                session.alter_table(TABLE,add_columns=[ydb.Column(n,LEGAL_TYPES[n]) for n in plan['add_nullable_columns']])
            session.alter_table(TABLE,set_ttl_settings=ttl_settings())
            result=schema_plan(session)
            if result['add_nullable_columns'] or not result['ttl_configured']:
                raise RuntimeError('migration_unconfirmed')
            audit(args.audit,plan,{'status':'schema_confirmed'})
        elif args.action in ('plan','retention-plan'):
            rows=(row for result in session.read_table(TABLE,ordered=True,use_snapshot=True) for row in result.rows)
            plan=make_plan(rows,receipt=args.receipt,expired=args.expired,limit=args.limit,within_days=args.within_days)
            if args.action=='retention-plan':
                if not args.receipt or not args.anchor or not args.reason:
                    raise ValueError('retention_event_required')
                parsed=datetime.fromisoformat(args.anchor.replace('Z','+00:00'))
                if parsed.utcoffset() is None:
                    raise ValueError('timezone_required')
                anchor=int(parsed.timestamp()*1000)
                now=int(time.time()*1000)
                if not 0<anchor<=now:
                    raise ValueError('invalid_anchor')
                plan.pop('confirmation');plan.update(operation='retention',anchor_ms=anchor,reason=args.reason)
                plan=sealed(plan)
            write_private(args.plan,plan)
            print(canonical({'confirmation':plan['confirmation'],'rows':len(plan['rows'])}))
        elif args.action in ('apply','retention-apply'):
            if args.action=='apply' and plan.get('operation')!='delete' or args.action=='retention-apply' and plan.get('operation')!='retention':
                raise ValueError('operation_mismatch')
            require_maintenance(args.tag)
            if args.action=='apply':
                result=erase(store,plan,args.confirm,maintenance=True)
            else:
                rows=validate_rows(store,plan)
                for row in rows:
                    if row.get('status')=='deleting':
                        raise ValueError('cannot_extend_deleting_record')
                    row.update(retention_anchor_ms=plan['anchor_ms'],retention_due_ms=three_years_after(plan['anchor_ms']),
                               purge_at_ms=three_years_after(plan['anchor_ms']),retention_reason=plan['reason'])
                    store._write_confirm('leads',row,LEGAL_TYPES,{'request_id':row['request_id']})
                result={'status':'retention_event_confirmed','rows':len(rows)}
            audit(args.audit,plan,result);print(canonical(result))
        elif args.action=='check':
            if plan['operation']!='delete':
                raise ValueError('operation_mismatch')
            result=check_deleted(store,plan)
            audit(args.audit,plan,result);print(canonical(result))
            return 0 if result['status']=='physical_delete_confirmed' else 2
        elif args.action=='telegram-delete':
            if plan['operation']!='delete':
                raise ValueError('operation_mismatch')
            # Required credentials are read from the operator environment, never from the plan.
            import index
            messages={(r['branch'],r['telegram_message_id']) for r in plan['rows'] if r.get('telegram_message_id')}
            for branch,message in sorted(messages):
                if branch not in ('kaluga','troitsk') or not message.isdigit():
                    raise ValueError('invalid_message_reference')
                body={'chat_id':os.environ['TELEGRAM_CHAT_'+branch.upper()],'message_id':int(message)}
                result=index.post('https://api.telegram.org/bot'+os.environ['TELEGRAM_BOT_TOKEN']+'/deleteMessage',json.dumps(body).encode(),'application/json')
                if result.get('ok') is not True or result.get('result') is not True:
                    raise RuntimeError('telegram_delete_unconfirmed')
            audit(args.audit,plan,{'status':'telegram_api_confirmed','messages':len(messages)})
        elif args.action=='telegram-manual-confirm':
            if plan['operation']!='delete':
                raise ValueError('operation_mismatch')
            messages={(r['branch'],r['telegram_message_id']) for r in plan['rows'] if r.get('telegram_message_id')}
            # Operator assertion after actual UI deletion, not an API verification.
            audit(args.audit,plan,{'status':'telegram_manual_operator_assertion','messages':len(messages)})
    except Exception:
        if 'plan' in locals() and args.action in ('apply','retention-apply','schema-apply','telegram-delete'):
            try: audit(args.audit,plan,{'status':'operation_unconfirmed'})
            except Exception: pass
        # No exception text: SDK/yc/upstream exceptions may contain sensitive data.
        print('Operation not confirmed; inspect configuration and recreate a stale plan if needed.',file=sys.stderr)
        return 1
    finally:
        if driver is not None:
            driver.stop()
    return 0


if __name__=='__main__':
    sys.exit(main())
