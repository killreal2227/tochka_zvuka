"""Read exact synthetic YDB receipts; no client contacts or secret payloads printed."""
import json
from pathlib import Path
import subprocess
import sys
import ydb
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend/yandex-leads'))
from bulk_store import BulkStore
from prepare_crm_cloud import yc,STATE

RECEIPTS={
 'kaluga':'7af58172-0e20-4c37-bb07-984cca1d29b2:ed069ccb9f9503d0d0fa8ddff06557380142103a0e92098e1b866a40d045a599',
 'troitsk':'1bbfdbb8-a68c-4c57-a350-7e552bf4fef7:69995de0e1ed5f1776aa6d3d46f8ef9ca2a6b5b0a4da06674a8c59eeb2ad152f',
 'recovered':'eaac8712-6c6d-46a6-80bb-999b733dca94:159c62604b79841af4ed3223e18973206df6a9cda52cfd1469dcf4081a369f83'}

def main():
 token=subprocess.run([r'C:\Users\stepk\yandex-cloud\bin\yc.exe','iam','create-token'],capture_output=True,text=True,check=True).stdout.strip()
 db='/ru-central1/b1gs93r1fhsuparnmrba/etntmjbnguvsu5l8bv3s'
 driver=ydb.Driver(endpoint='grpcs://ydb.serverless.yandexcloud.net:2135',database=db,credentials=ydb.AccessTokenCredentials(token))
 try:
  driver.wait(timeout=10,fail_fast=True);store=BulkStore(driver.table_client,db,'tz_site_test_20261114_',metadata_enabled=True)
  report={}
  for case,receipt in RECEIPTS.items():
   lead=store.load_lead(receipt);assert lead['name']=='Synthetic'
   crm=store.crm_marker(receipt);notice=store.notice_marker(receipt)
   assert crm['crm_state']=='sent' and crm['crm_external_id'].isdigit()
   assert notice['crm_state']=='sent' and notice['telegram_sent'] is True
   assert all(not notice[k] for k in ('name','surname','phone'))
   report[case]={'branch':lead['branch'],'crm_id':crm['crm_external_id'],
    'notice_id':notice['telegram_message_id'],'crm_confirmed':True,'notice_confirmed':True,'notice_marker_no_contacts':True}
  assert report['recovered']['notice_id']=='24'
  path=ROOT/'backend/yandex-leads/release/CRM-CLOUD-VERIFIED.json'
  path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
  print(json.dumps(report))
 finally:driver.stop()

if __name__=='__main__':
 try:main()
 except Exception as e:print(json.dumps({'verified':False,'error_type':type(e).__name__}));sys.exit(1)
