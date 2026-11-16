"""Synthetic IAM-private fixture. Excluded from the production archive."""
import hashlib
import json
import os
import time
import uuid
from datetime import datetime,timezone
import index
from service import NOTICE_VERSION


def handler(event,context):
    stage='validate'
    try:
        if set(event)=={'drain'} and event['drain'] is True:
            return index.get_delivery().drain()
        assert os.environ['PUBLIC_LEADS_ENABLED']=='false'
        assert set(event) in ({'branch','requestId'},{'branch','requestId','simulateFailure'}) and event['branch'] in ('kaluga','troitsk')
        assert str(uuid.UUID(event['requestId']))==event['requestId']
        branch=event['branch'];stamp=datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
        data=dict(schemaVersion=2,requestId=event['requestId'],createdAt=stamp,
            name='Synthetic',surname='Crm'+branch,phone=('+70000000013' if event.get('simulateFailure') else ('+70000000011' if branch=='kaluga' else '+70000000012')),
            branch=branch,direction='unsure',website='',pagePath='/'+branch+'/',privacyNoticeVersion=NOTICE_VERSION)
        stage='save'
        digest=hashlib.sha256(json.dumps(data,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
        receipt=index.get_store().save(data,digest,int(time.time()*1000))
        stage='deliver'
        dispatcher=index.get_delivery()
        if event.get('simulateFailure') is True:
            real_crm=dispatcher.crm;real_take=dispatcher.queue.take;captured=[]
            class Unavailable:
                def sync(self,*args):raise RuntimeError('synthetic_crm_unavailable')
            def take():
                item=real_take()
                if item:captured.append(item)
                return item
            try:
                dispatcher.crm=Unavailable();dispatcher.queue.take=take
                delivery=dispatcher.accept(receipt)
                # Release only this synthetic failed delivery for the following recovery check.
                if captured and captured[0][0]==receipt:
                    dispatcher.queue.call('ChangeMessageVisibility',QueueUrl=dispatcher.queue.url,
                        ReceiptHandle=captured[0][1],VisibilityTimeout=0)
            finally:dispatcher.crm=real_crm;dispatcher.queue.take=real_take
        else:delivery=dispatcher.accept(receipt)
        marker=index.get_store().crm_marker(receipt) or {}
        notice=index.get_store().notice_marker(receipt) or {}
        return dict(saved=True,synthetic=True,receipt=receipt,branch=branch,**delivery,
            customer_id=marker.get('crm_external_id',''),notice_state=notice.get('crm_state',''),
            telegram_message_id=notice.get('telegram_message_id',''))
    except Exception as error:
        return {'saved':False,'stage':stage,'error_type':type(error).__name__}
