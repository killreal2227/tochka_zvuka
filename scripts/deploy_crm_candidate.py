"""Add nullable metadata, deploy a private candidate. Never switches public Gateway."""
import json
from pathlib import Path
import subprocess
import sys
import zipfile
import ydb

ROOT=Path(__file__).resolve().parents[1]
PROJECT=ROOT.parent
sys.path.insert(0,str(ROOT/'backend/yandex-leads'))
from bulk_store import LEGAL_TYPES
from retention import META_TEXT,META_NUMBER
from prepare_crm_cloud import yc,STATE,save,RUNTIME


def main():
    state=json.loads(STATE.read_text(encoding='utf-8'))
    production='--production' in sys.argv
    refresh='--refresh-smoke' in sys.argv
    if '--refresh-production' in sys.argv and state.get('production_operation'):
        state.setdefault('production_operations',[]).append(state.pop('production_operation'));save(state)
    if refresh and state.get('candidate_operation'):
        state.setdefault('candidate_operations',[]).append(state.pop('candidate_operation'));save(state)
    live=yc(['serverless','function','version','get','d4ed3c2offkoij8i487r'])
    # Native additive schema changes only. Do NOT enable TTL or delete anything.
    if not state.get('metadata_schema_ready'):
        token=subprocess.run([r'C:\Users\stepk\yandex-cloud\bin\yc.exe','iam','create-token'],
            capture_output=True,text=True,encoding='utf-8',check=True).stdout.strip()
        database=live['environment']['YDB_DATABASE']
        driver=ydb.Driver(endpoint=live['environment']['YDB_ENDPOINT'],database=database,
            credentials=ydb.AccessTokenCredentials(token))
        try:
            driver.wait(timeout=10,fail_fast=True);session=driver.table_client.session().create()
            table=database+'/'+live['environment']['YDB_TABLE_PREFIX']+'leads'
            names={x.name for x in session.describe_table(table).columns}
            missing=[x for x in (*META_TEXT,*META_NUMBER) if x not in names]
            if missing:session.alter_table(table,add_columns=[ydb.Column(n,LEGAL_TYPES[n]) for n in missing])
            actual={x.name for x in session.describe_table(table).columns}
            if not set((*META_TEXT,*META_NUMBER))<=actual:raise RuntimeError('Schema not confirmed')
            session.delete();state['metadata_schema_ready']=True;save(state)
        finally:driver.stop()
    env=dict(live['environment'],PUBLIC_LEADS_ENABLED='true' if production else 'false',DELIVERY_ENABLED='true',
        LEADS_SCHEMA_V2_ENABLED='true',LEADS_MAINTENANCE='false',ALFACRM_ENABLED='true',
        ALFACRM_LEAD_STATUS_ID='37',CRM_QUEUE_URL=state['queue_url'])
    if production:
        if not state.get('retry_trigger'):
            trigger=yc(['serverless','trigger','create','timer','tochka-crm-retry',
                '--cron-expression','0/1 * * * ? *','--invoke-function-id','d4ep7jlje5la3g8ohd70',
                '--invoke-function-tag','v2-private-20261114-r1','--invoke-function-service-account-id',RUNTIME])
            state['retry_trigger']=trigger['id'];save(state)
        env['DELIVERY_TRIGGER_ID']=state['retry_trigger']
    entrypoint='index.handler' if production else 'crm_smoke.handler'
    archive='leads-v2-python312.zip' if production else 'crm-private-smoke.zip'
    args=['serverless','function','version','create','--function-id','d4ep7jlje5la3g8ohd70',
        '--runtime','python312','--entrypoint',entrypoint,'--memory','256MB',
        '--execution-timeout','60s','--service-account-id',RUNTIME,'--concurrency','1',
        '--no-logging','--source-path',str(ROOT/'backend/yandex-leads/release'/archive),
        '--tags','v2-private-20261114-r1','--environment',','.join(k+'='+v for k,v in env.items()),'--async']
    for secret in live['secrets']:
        args+=['--secret',','.join(['id='+secret['id'],'version-id='+secret['version_id'],
            'key='+secret['key'],'environment-variable='+secret['environment_variable']])]
    for key in ('ALFACRM_EMAIL','ALFACRM_API_KEY','CRM_QUEUE_ACCESS_KEY','CRM_QUEUE_SECRET_KEY'):
        args+=['--secret',','.join(['id='+state['crm_secret'],'version-id='+state['crm_secret_version'],
            'key='+key,'environment-variable='+key])]
    operation_key='production_operation' if production else 'candidate_operation'
    if not state.get(operation_key):
        state['candidate_tag']='v2-private-20261114-r1'
        state['previous_diagnostic_version']='d4e5ok3fim3qgeatoojr';save(state)
        operation=yc(args);state[operation_key]=operation['id'];save(state)
    print(json.dumps({'operation':state[operation_key],'production_candidate':production,'schema_ready':True,'gateway_changed':False}))


if __name__=='__main__':
    try:main()
    except Exception as e:
        print(json.dumps({'error_type':type(e).__name__}));sys.exit(1)
