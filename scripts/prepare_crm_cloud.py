"""Prepare isolated FIFO/Lockbox resources. Does not switch Gateway or publish site."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
PROJECT=ROOT.parent
sys.path.insert(0,str(ROOT/'backend/yandex-leads'))
from crm_queue import Queue
YC=r'C:\Users\stepk\yandex-cloud\bin\yc.exe'
FOLDER='b1g6u3cbni3v79le1k3u'
RUNTIME='aje3h7miof09lfdkkcom'
STATE=PROJECT/'.secrets/crm-cloud-state.json'


def yc(args,payload=None):
    r=subprocess.run([YC,*args,'--format','json','--retry','0'],input=payload,
        capture_output=True,text=True,encoding='utf-8',timeout=90)
    if r.returncode:
        if args[:4]==['serverless','function','version','create']:
            # This command contains references to secret versions, not payload values.
            print(json.dumps({'version_create_error':r.stderr[-2500:]}))
        raise RuntimeError('yc failed: '+' '.join(args[:3]))
    return json.loads(r.stdout) if r.stdout.strip() else {}


def save(state):
    STATE.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8')


def main():
    state=json.loads(STATE.read_text(encoding='utf-8')) if STATE.exists() else {}
    if 'queue_sa' not in state:
        state['queue_sa']=yc(['iam','service-account','create','--name','tochka-crm-queue',
            '--folder-id',FOLDER])['id'];save(state)
    if not state.get('queue_role'):
        yc(['resource-manager','folder','add-access-binding',FOLDER,'--role','ymq.admin',
            '--subject','serviceAccount:'+state['queue_sa']]);state['queue_role']=True;save(state)
    if 'access' not in state:
        state['access']=yc(['iam','access-key','create','--service-account-id',state['queue_sa'],
            '--description','FIFO CRM delivery only']);save(state)
    access=state['access']
    env={'CRM_QUEUE_ACCESS_KEY':access['access_key']['key_id'],
         'CRM_QUEUE_SECRET_KEY':access['secret']}
    q=Queue(env)
    if 'queue_url' not in state:
        # IAM permissions may take a few seconds to propagate; no infinite retry.
        time.sleep(3)
        result=q.call('CreateQueue',QueueName='tochka-alfacrm.fifo',**{
            'Attribute.1.Name':'FifoQueue','Attribute.1.Value':'true',
            'Attribute.2.Name':'VisibilityTimeout','Attribute.2.Value':'300',
            'Attribute.3.Name':'MessageRetentionPeriod','Attribute.3.Value':'1209600'})
        state['queue_url']=result.findtext('.//QueueUrl')
        if not state['queue_url']:raise RuntimeError('Queue creation unconfirmed')
        save(state)
    if 'crm_secret' not in state:
        values={}
        for line in (PROJECT/'.secrets/alfacrm.env').read_text(encoding='utf-8-sig').splitlines():
            if '=' in line:
                key,value=line.split('=',1);values[key.strip()]=value.strip().strip('\"\'')
        env.update({k:values[k] for k in ('ALFACRM_EMAIL','ALFACRM_API_KEY')})
        payload=json.dumps([{'key':k,'text_value':v} for k,v in env.items()])
        secret=yc(['lockbox','secret','create','--name','tochka-alfacrm-delivery',
            '--folder-id',FOLDER,'--payload','-','--deletion-protection'],payload)
        state['crm_secret']=secret['id'];state['crm_secret_version']=secret['current_version']['id'];save(state)
    if not state.get('secret_binding'):
        yc(['lockbox','secret','add-access-binding',state['crm_secret'],'--role','lockbox.payloadViewer',
            '--subject','serviceAccount:'+RUNTIME]);state['secret_binding']=True;save(state)
    print(json.dumps({'prepared':True,'queue_url':state['queue_url'],
        'secret_id':state['crm_secret'],'gateway_changed':False,'keys_printed':False}))


if __name__=='__main__':
    try:main()
    except Exception as e:
        # Never expose SDK/HTTP objects containing keys or request headers.
        print(json.dumps({'prepared':False,'error_type':type(e).__name__}));sys.exit(1)
