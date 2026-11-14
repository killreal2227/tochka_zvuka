"""Future IAM-private test entrypoint. Fixed synthetic data only; never Telegram."""
import hashlib
import json
import os
import time
import index
from service import valid,reply
from storage_errors import RequestConflict

def handler(event,context):
    if (os.environ.get('PRIVATE_SYNTHETIC_TEST_MODE')!='true' or
        os.environ.get('PUBLIC_LEADS_ENABLED')!='false' or
        os.environ.get('DELIVERY_ENABLED')!='false' or
        os.environ.get('YDB_DOCUMENT_TABLE')!='tz_site_test_20261114_documents'):
        return reply(503,{'error':'private_test_disabled'})
    expected={'requestId','createdAt','branch','captchaToken'}
    if not isinstance(event,dict) or set(event)!=expected:return reply(400,{'error':'invalid_test_request'})
    data={'schemaVersion':1,'requestId':event['requestId'],'createdAt':event['createdAt'],
        'name':'Synthetic','surname':'Test','phone':'+79990000000','branch':event['branch'],
        'direction':'vocal','website':'','pagePath':'/'+str(event['branch'])+'/',
        'captchaToken':event['captchaToken'],'consent':{'accepted':True,'acceptedAt':event['createdAt'],
            'version':'2026-11-10-v3','documentUrl':'https://tzvuka.ru/documents/#consent',
            'privacyUrl':'https://tzvuka.ru/documents/#privacy'}}
    if not valid(data,'https://tzvuka.ru',int(time.time()*1000)):
        return reply(400,{'error':'invalid_test_request'})
    try:
        # Local test widget has a separate key. Do not rewrite/fabricate its host.
        proof=index.post('https://smartcaptcha.cloud.yandex.ru/validate',index.urllib.parse.urlencode({
            'secret':os.environ['SMARTCAPTCHA_SERVER_KEY'],'token':event['captchaToken']}).encode(),
            'application/x-www-form-urlencoded')
        if proof.get('status')!='ok' or proof.get('host')!='localhost:8767':
            return reply(403,{'error':'verification_failed'})
        data.pop('captchaToken')
        digest=hashlib.sha256(json.dumps(data,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
        receipt=index.get_store().save(data,digest,int(time.time()*1000))
        return reply(200,{'ok':True,'saved':True,'synthetic':True,'requestId':data['requestId'],'leadId':receipt})
    except RequestConflict:return reply(409,{'error':'request_conflict'})
    except Exception:return reply(503,{'error':'unavailable'})
