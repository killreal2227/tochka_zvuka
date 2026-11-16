"""Small SQS Query/SigV4 client for a single Yandex FIFO message group.

Queue bodies contain receipts only. No automatic network retries or logging.
"""
import hashlib
import hmac
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

HOST='message-queue.api.cloud.yandex.net'
RECEIPT=re.compile(r'[0-9a-f-]{36}:[0-9a-f]{64}')


class QueueError(RuntimeError):
    def __init__(self):super().__init__('queue_unavailable')


def sign(key, message):return hmac.new(key,message.encode(),hashlib.sha256).digest()


class Queue:
    def __init__(self, env, opener=None):
        self.access=env['CRM_QUEUE_ACCESS_KEY'];self.secret=env['CRM_QUEUE_SECRET_KEY']
        self.url=env.get('CRM_QUEUE_URL','')
        if self.url and (not self.url.startswith('https://'+HOST+'/') or not self.url.endswith('.fifo')):
            raise ValueError('Invalid queue')
        self.opener=opener or urllib.request.build_opener()

    def call(self, action, **params):
        body=urllib.parse.urlencode(dict(Action=action,Version='2012-11-05',**params)).encode()
        now=datetime.now(timezone.utc);date=now.strftime('%Y%m%d');stamp=now.strftime('%Y%m%dT%H%M%SZ')
        content_type='application/x-www-form-urlencoded'
        names='content-type;host;x-amz-date'
        canonical='\n'.join(['POST','/','',f'content-type:{content_type}\nhost:{HOST}\nx-amz-date:{stamp}\n',names,hashlib.sha256(body).hexdigest()])
        scope=date+'/ru-central1/sqs/aws4_request'
        string='AWS4-HMAC-SHA256\n'+stamp+'\n'+scope+'\n'+hashlib.sha256(canonical.encode()).hexdigest()
        key=sign(sign(sign(sign(('AWS4'+self.secret).encode(),date),'ru-central1'),'sqs'),'aws4_request')
        signature=hmac.new(key,string.encode(),hashlib.sha256).hexdigest()
        auth=f'AWS4-HMAC-SHA256 Credential={self.access}/{scope}, SignedHeaders={names}, Signature={signature}'
        request=urllib.request.Request('https://'+HOST+'/',data=body,method='POST',
            headers={'Content-Type':content_type,'Host':HOST,'X-Amz-Date':stamp,'Authorization':auth})
        try:
            with self.opener.open(request,timeout=8) as response:
                raw=response.read(262145)
                if response.status!=200 or len(raw)>262144:raise QueueError()
                root=ET.fromstring(raw)
                for element in root.iter():element.tag=element.tag.rsplit('}',1)[-1]
                return root
        except Exception:raise QueueError() from None

    def enqueue(self,receipt):
        if not RECEIPT.fullmatch(receipt):raise ValueError('Invalid receipt')
        root=self.call('SendMessage',QueueUrl=self.url,MessageBody=receipt,
            MessageGroupId='alfacrm-account',MessageDeduplicationId=hashlib.sha256(receipt.encode()).hexdigest())
        if not root.findtext('.//MessageId'):raise QueueError()

    def take(self):
        root=self.call('ReceiveMessage',QueueUrl=self.url,MaxNumberOfMessages=1,
            VisibilityTimeout=300,WaitTimeSeconds=0)
        item=root.find('.//Message')
        if item is None:return None
        receipt=item.findtext('Body');handle=item.findtext('ReceiptHandle')
        if not receipt or not RECEIPT.fullmatch(receipt) or not handle:raise QueueError()
        return receipt,handle

    def delete(self,handle):self.call('DeleteMessage',QueueUrl=self.url,ReceiptHandle=handle)
