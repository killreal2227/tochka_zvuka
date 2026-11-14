"""Minimal native RPC storage. No YQL, transactions or conditional-write claims."""
import re
import threading
from datetime import datetime
import ydb

TEXT_FIELDS = ('request_id payload_hash lead_id branch name surname phone direction source status '
               'client_created_at consent_accepted_at consent_version consent_document_url '
               'privacy_url page_path telegram_message_id crm_state crm_external_id').split()
LEAD_TYPES = {k:ydb.PrimitiveType.Utf8 for k in TEXT_FIELDS}
LEAD_TYPES.update(created_at_ms=ydb.PrimitiveType.Uint64, telegram_sent=ydb.PrimitiveType.Bool)

def struct(types):
    result=ydb.StructType()
    for key,kind in types.items(): result.add_member(key,kind)
    return result

class BulkStore:
    def __init__(self,client,database,prefix):
        if not re.fullmatch(r'[a-z][a-z0-9_]{0,40}_',prefix): raise ValueError('Invalid prefix')
        self.client,self.database,self.prefix=client,database.rstrip('/'),prefix
        self._lock=threading.Lock(); self._buckets={}

    def _read(self,table,key,types):
        rows=self.client.read_rows(self.database+'/'+self.prefix+table,[key],struct(types),
            settings=ydb.BaseRequestSettings().with_timeout(8)).rows
        return dict(rows[0]) if rows else None

    def _write_confirm(self,table,row,types,key):
        self.client.bulk_upsert(self.database+'/'+self.prefix+table,[row],struct(types),
            settings=ydb.BaseRequestSettings().with_timeout(8))
        actual=self._read(table,key,{k:types[k] for k in key})
        if actual is None or any(actual.get(k)!=v for k,v in row.items()):
            raise RuntimeError('Persistence unconfirmed')

    def rate_limit(self,key,now_ms):
        # Per warm function instance only. CAPTCHA remains mandatory; no distributed counter claim.
        window=now_ms//60000
        with self._lock:
            self._buckets={k:v for k,v in self._buckets.items() if v[0]==window}
            count=self._buckets.get(key,(window,0))[1]
            total=self._buckets.get('_all',(window,0))[1]
            if count>=5 or total>=100: return False
            self._buckets[key]=(window,count+1);self._buckets['_all']=(window,total+1)
            return True

    def save(self,data,digest,now_ms):
        receipt=data['requestId']+':'+digest
        c=data['consent']
        row={k:'' for k in TEXT_FIELDS}
        row.update(request_id=receipt,lead_id=receipt,payload_hash=digest,
            **{k:data[k] for k in ('branch','name','surname','phone','direction')},
            source='Сайт',status='notification_pending',client_created_at=data['createdAt'],
            created_at_ms=int(datetime.fromisoformat(data['createdAt'].replace('Z','+00:00')).timestamp()*1000),
            consent_accepted_at=c['acceptedAt'],consent_version=c['version'],
            consent_document_url=c['documentUrl'],privacy_url=c['privacyUrl'],
            page_path=data['pagePath'],telegram_sent=False,crm_state='pending')
        # Deterministic full row: a repeated submission cannot overwrite delivery acknowledgements.
        self._write_confirm('leads',row,LEAD_TYPES,{'request_id':receipt})
        return receipt

    def notify(self,receipt,sender):
        if not isinstance(receipt,str) or not re.fullmatch(r'[0-9a-f-]{36}:[0-9a-f]{64}',receipt):
            raise ValueError('Invalid receipt')
        lead=self._read('leads',{'request_id':receipt},{'request_id':ydb.PrimitiveType.Utf8})
        if not lead: raise RuntimeError('Lead missing')
        # YDB ReadRows rejects tables with indexes (400070); existing outbox has due_idx.
        # A reserved key in the unindexed leads table keeps the acknowledgement independent.
        key={'request_id':'sent:'+receipt}
        marker=self._read('leads',key,{'request_id':ydb.PrimitiveType.Utf8})
        if marker and marker.get('telegram_sent') is True: return 'sent'
        # Failure/timeout never overwrites the durable pending intent or a successful marker.
        message=sender(lead)
        if type(message) is not int or message<=0: raise RuntimeError('Delivery unconfirmed')
        marker=dict(lead,**key,status='notification_sent',telegram_sent=True,telegram_message_id=str(message))
        self._write_confirm('leads',marker,LEAD_TYPES,key)
        return 'sent'
