"""Private IAM-only synthetic fixture, never deployed behind the Gateway."""
import json,os,time,uuid
from datetime import datetime,timezone
import index
from service import receive,NOTICE_VERSION

def request(data,ip='192.0.2.19'):
    return {'version':'1.0','path':'/leads','httpMethod':'POST',
        'headers':{'origin':'https://tzvuka.ru','content-type':'application/json'},'body':json.dumps(data),
        'requestContext':{'identity':{'sourceIp':ip},'apiGateway':{'operationContext':{'route':'website-leads-v1'}}}}

def handler(event,context):
    stage='event'
    try:
        assert os.environ['DELIVERY_ENABLED']=='false'
        if set(event)=={'browserPayload'}:
            data=event['browserPayload']
            assert data['name'].startswith('Synthetic') and data['phone']=='+79990000000'
            result=index.handler(request(data),context)
            return {'status':result['statusCode'],'body':json.loads(result['body'])}
        assert set(event)=={'testIds'} and len(event['testIds'])==4
        ids=event['testIds'];assert all(str(uuid.UUID(v))==v for v in ids)
        store=index.get_store();cases=[];i=0
        for version in (1,2):
            for branch in ('kaluga','troitsk'):
                stage='save_'+str(version)+'_'+branch
                now=int(time.time()*1000);stamp=datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
                data=dict(schemaVersion=version,requestId=ids[i],createdAt=stamp,name='SyntheticPrivate',surname='Fixture' if version==1 else '',phone='+79990000000',branch=branch,direction='unsure',website='',pagePath='/'+branch+'/',captchaToken='synthetic-private-fixture')
                ip='192.0.2.'+str(30+i)
                i+=1
                if version==1:
                    data['consent']=dict(accepted=True,acceptedAt=stamp,version='2026-11-10-v3',documentUrl='https://tzvuka.ru/documents/#consent',privacyUrl='https://tzvuka.ru/documents/#privacy')
                else:data['privacyNoticeVersion']=NOTICE_VERSION
                def unavailable_sender(_):raise RuntimeError('injected_notification_failure')
                response=receive(request(data,ip),os.environ,store,lambda *_:{'status':'ok','host':'tzvuka.ru'},now,
                                 sender=unavailable_sender if version==2 and branch=='troitsk' else None)
                assert response['statusCode']==200
                saved=json.loads(response['body']);assert saved['saved'] is True
                repeat=receive(request(data,ip),os.environ,store,lambda *_:{'status':'ok','host':'tzvuka.ru'},now+1)
                assert repeat['statusCode']==200 and json.loads(repeat['body'])['leadId']==saved['leadId']
                cases.append(dict(version=version,branch=branch,receipt=saved['leadId'],notification=saved['notification']))
        stage='real_smartcaptcha_rejection'
        invalid=dict(data,captchaToken='INVALID_SYNTHETIC_TOKEN')
        denied=index.handler(request(invalid),context)
        assert denied['statusCode']==403
        stage='storage_failure'
        class BrokenStore:
            def rate_limit(self,*_):return True
            def save(self,*_):raise RuntimeError('injected_storage_failure')
        failed=receive(request(data),os.environ,BrokenStore(),lambda *_:{'status':'ok','host':'tzvuka.ru'})
        assert failed['statusCode']==503 and json.loads(failed['body']).get('saved') is not True
        stage='strict_validation'
        malformed=dict(data,unexpected=True)
        assert index.handler(request(malformed),context)['statusCode']==400
        return {'ok':True,'cases':cases,'checks':{'real_ydb_persistence_and_retry':True,
            'real_smartcaptcha_invalid_rejected':True,'injected_storage_error_no_false_success':True,
            'injected_telegram_error_keeps_saved_intent':True,'strict_validation':True},'telegram_calls':0}
    except Exception as error:
        return {'ok':False,'failed_stage':stage,'error_type':type(error).__name__,'telegram_calls':0}
