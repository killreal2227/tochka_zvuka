"""One atomic item = immutable application + durable notification intent.

All changes use conditional PutItem; no unconditional writes, BulkUpsert or YQL.
The API's atomic conditional-write semantics are a required deployment gate.
"""
import copy
import json
import random
import re
import time
import uuid
from document_api import encode,decode
from storage_errors import RequestConflict,ConditionalFailed,StorageUnavailable,DeliveryFailure

class DocumentStore:
    def __init__(self,api,table,sleep=time.sleep):
        if not re.fullmatch(r'tz_site_(?:test_[a-z0-9_]+_)?documents',table):
            raise RuntimeError('Unreviewed document table')
        self.api,self.table,self.sleep=api,table,sleep

    def _get(self,key):
        result=self.api.call('GetItem',{'TableName':self.table,'Key':encode({'pk':key}),'ConsistentRead':True})
        return decode(result['Item']) if result.get('Item') else None

    def _create(self,item):
        try:
            self.api.call('PutItem',{'TableName':self.table,'Item':encode(item),
                'ConditionExpression':'attribute_not_exists(#pk)',
                'ExpressionAttributeNames':{'#pk':'pk'}})
            return True
        except ConditionalFailed:return False

    def _cas(self,old,new):
        assert old['pk']==new['pk']
        candidate=dict(new,version=old['version']+1)
        try:
            self.api.call('PutItem',{'TableName':self.table,'Item':encode(candidate),
                'ConditionExpression':'attribute_exists(#pk) AND #v = :expected',
                'ExpressionAttributeNames':{'#pk':'pk','#v':'version'},
                'ExpressionAttributeValues':encode({':expected':old['version']})})
            return True
        except ConditionalFailed:return False

    def _backoff(self,attempt):self.sleep(random.uniform(0,min(.05,.002*2**attempt)))

    def save(self,data,payload_hash,now_ms):
        key='lead:'+data['requestId']
        business=json.dumps(data,sort_keys=True,ensure_ascii=False,separators=(',',':'))
        item=dict(pk=key,kind='lead',version=0,request_id=data['requestId'],
            payload_hash=payload_hash,lead_id=str(uuid.uuid4()),payload_json=business,
            created_at_ms=now_ms,notify_state='pending',attempts=0,next_attempt_ms=now_ms,
            lease_until_ms=0,lease_token='',telegram_sent=False,telegram_message_id='',last_error_code='')
        # A lost write response is resolved only by a strongly consistent read.
        # If neither response nor read confirms persistence, the HTTP caller gets no success.
        try:self._create(item)
        except StorageUnavailable:pass
        saved=self._get(key)
        if not saved:raise StorageUnavailable('Persistence not confirmed')
        if saved.get('payload_hash')!=payload_hash or saved.get('payload_json')!=business:
            raise RequestConflict()
        required={'attempts','next_attempt_ms','lease_until_ms','lease_token','version','telegram_sent'}
        if (not saved.get('lead_id') or saved.get('kind')!='lead' or not required.issubset(saved)
                or saved.get('notify_state') not in {'pending','sent','attention'}
                or saved.get('request_id')!=data['requestId']):
            raise StorageUnavailable('Invalid receipt')
        return saved['lead_id']

    def rate_limit(self,key,now_ms,limit=5,global_limit=100):
        # One minute-item atomically holds BOTH per-source and total counters.
        # No partial two-row counter transaction is needed.
        bucket='rate:'+str(now_ms//60000)
        for attempt in range(6):
            old=self._get(bucket)
            counts=json.loads(old['counts_json']) if old else {}
            total=old['hits'] if old else 0
            if counts.get(key,0)>=limit or total>=global_limit:return False
            counts[key]=counts.get(key,0)+1
            new=dict(pk=bucket,kind='rate',version=0,hits=total+1,
                counts_json=json.dumps(counts,sort_keys=True),expires_at=now_ms//1000+86400)
            if (self._cas(old,new) if old else self._create(new)):return True
            self._backoff(attempt)
        raise StorageUnavailable('Rate counter contention')

    def due(self,now_ms,limit=10):
        # Persisted scan cursor prevents permanent starvation behind old/sent/rate rows.
        # Cursor is only an acceleration hint: pending work is NEVER deleted on advance.
        key='meta:delivery-cursor'
        old=self._get(key)
        if old is None:
            self._create(dict(pk=key,kind='cursor',version=0,cursor_json=''))
            old=self._get(key)
        if old is None:raise StorageUnavailable('Cursor unconfirmed')
        cursor=json.loads(old['cursor_json']) if old['cursor_json'] else None
        found=[]
        for _ in range(8):
            request={'TableName':self.table,'ConsistentRead':True,'Limit':min(25,limit-len(found)),
                'FilterExpression':'#kind = :lead AND #state = :pending AND #next <= :now',
                'ProjectionExpression':'#pk,#kind,#state,#next',
                'ExpressionAttributeNames':{'#pk':'pk','#kind':'kind','#state':'notify_state','#next':'next_attempt_ms'},
                'ExpressionAttributeValues':encode({':lead':'lead',':pending':'pending',':now':now_ms})}
            if cursor:request['ExclusiveStartKey']=cursor
            page=self.api.call('Scan',request)
            for raw in page.get('Items',[]):
                item=decode(raw)
                if item.get('kind')=='lead' and item.get('notify_state')=='pending' and item.get('next_attempt_ms',now_ms+1)<=now_ms:
                    found.append(item['pk'].removeprefix('lead:'))
            cursor=page.get('LastEvaluatedKey') or None
            new=dict(old,cursor_json=json.dumps(cursor,sort_keys=True) if cursor else '')
            if not self._cas(old,new):break
            old=dict(new,version=old['version']+1)
            if not cursor or len(found)>=limit:break
        return found[:limit]

    def claim(self,request_id,now_ms):
        token=str(uuid.uuid4())
        for attempt in range(6):
            old=self._get('lead:'+request_id)
            if not old or old['notify_state']!='pending' or old['next_attempt_ms']>now_ms or old['lease_until_ms']>now_ms:
                return None
            new=dict(old,attempts=old['attempts']+1,lease_token=token,
                lease_until_ms=now_ms+90000,next_attempt_ms=now_ms+90000)
            if self._cas(old,new):
                data=json.loads(old['payload_json'])
                return {'token':token,'attempts':new['attempts'],'lead':{
                    'request_id':request_id,'name':data['name'],'surname':data['surname'],
                    'phone':data['phone'],'branch':data['branch'],'direction':data['direction']}}
            self._backoff(attempt)
        raise StorageUnavailable('Lease contention')

    def finish(self,request_id,token,now_ms,attempts,message_id=None,failure=None):
        if message_id is not None and (type(message_id) is not int or message_id<=0):
            raise ValueError('Telegram acknowledgement required')
        failure=failure or DeliveryFailure()
        for attempt in range(6):
            old=self._get('lead:'+request_id)
            if not old or old['lease_token']!=token or old['notify_state']!='pending':return False
            if message_id is not None:
                new=dict(old,notify_state='sent',telegram_sent=True,telegram_message_id=str(message_id),
                    lease_token='',lease_until_ms=0,last_error_code='')
            else:
                delay=min(3600000,30000*2**min(old['attempts'],7))
                if failure.retry_after is not None:delay=max(delay,failure.retry_after*1000)
                new=dict(old,notify_state='attention' if failure.permanent or old['attempts']>=12 else 'pending',
                    next_attempt_ms=now_ms+delay,lease_token='',lease_until_ms=0,last_error_code=failure.code)
            if self._cas(old,new):return True
            self._backoff(attempt)
        raise StorageUnavailable('Receipt contention')
