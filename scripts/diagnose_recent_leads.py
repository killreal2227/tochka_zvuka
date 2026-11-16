"""Read technical delivery metadata only. No names/phones, cache or CRM writes."""
import json,re,subprocess,sys,time
from pathlib import Path
from datetime import datetime,timezone
import ydb
ROOT=Path(__file__).resolve().parents[1];PROJECT=ROOT.parent
sys.path.insert(0,str(ROOT/'backend/yandex-leads'))
from bulk_store import struct
from crm_queue import Queue
from prepare_crm_cloud import STATE

def main():
 token=subprocess.run([r'C:\Users\stepk\yandex-cloud\bin\yc.exe','iam','create-token'],capture_output=True,text=True,check=True).stdout.strip()
 db='/ru-central1/b1gs93r1fhsuparnmrba/etntmjbnguvsu5l8bv3s';table=db+'/tz_site_test_20261114_leads'
 driver=ydb.Driver(endpoint='grpcs://ydb.serverless.yandexcloud.net:2135',database=db,credentials=ydb.AccessTokenCredentials(token))
 try:
  driver.wait(timeout=10,fail_fast=True);session=driver.table_client.session().create();rows=[]
  columns=['request_id','branch','created_at_ms','received_at_ms','status','crm_state','crm_external_id','telegram_message_id']
  for chunk in session.read_table(table,columns=columns,row_limit=300,settings=ydb.BaseRequestSettings().with_timeout(10)):
   rows.extend(dict(r) for r in chunk.rows)
  session.delete()
  cutoff=int(time.time()*1000)-3*3600000
  recent=sorted([r for r in rows if re.fullmatch(r'[0-9a-f-]{36}:[0-9a-f]{64}',r.get('request_id','')) and (r.get('received_at_ms') or r.get('created_at_ms',0))>=cutoff],key=lambda r:r.get('received_at_ms') or r.get('created_at_ms',0),reverse=True)[:20]
  report=[]
  for r in recent:
   item={'receipt':r['request_id'],'branch':r['branch'],'time':datetime.fromtimestamp((r.get('received_at_ms') or r['created_at_ms'])/1000,timezone.utc).isoformat()}
   keys=[{'request_id':p+r['request_id']} for p in ('crm:','notice:')]
   markers=driver.table_client.read_rows(table,keys,struct({'request_id':ydb.PrimitiveType.Utf8}),settings=ydb.BaseRequestSettings().with_timeout(8)).rows
   for marker in markers:
    m=dict(marker);kind='crm' if m['request_id'].startswith('crm:') else 'notice'
    item[kind]={'state':m.get('crm_state'),'external_id':m.get('crm_external_id'),'message_id':m.get('telegram_message_id')}
   report.append(item)
  state=json.loads(STATE.read_text(encoding='utf-8'))
  q=Queue({'CRM_QUEUE_ACCESS_KEY':state['access']['access_key']['key_id'],'CRM_QUEUE_SECRET_KEY':state['access']['secret'],'CRM_QUEUE_URL':state['queue_url']})
  attrs=q.call('GetQueueAttributes',QueueUrl=q.url,**{'AttributeName.1':'ApproximateNumberOfMessages','AttributeName.2':'ApproximateNumberOfMessagesNotVisible'})
  queue={a.findtext('Name'):a.findtext('Value') for a in attrs.findall('.//Attribute')}
  print(json.dumps({'metadata_rows_scanned':len(rows),'scan_may_be_incomplete':len(rows)>=300,'recent':report,'queue':queue},ensure_ascii=False))
 finally:driver.stop()

if __name__=='__main__':
 try:main()
 except Exception as e:print(json.dumps({'error_type':type(e).__name__}));sys.exit(1)
