"""Minimal native RPC storage. No YQL, transactions or conditional-write claims."""
import re
import threading
import time
from datetime import datetime
import ydb
from retention import META_TEXT, META_NUMBER, evidence
from storage_errors import RequestDeleted

TEXT_FIELDS = ('request_id payload_hash lead_id branch name surname phone direction source status '
               'client_created_at consent_accepted_at consent_version consent_document_url '
               'privacy_url page_path telegram_message_id crm_state crm_external_id').split()
LEAD_TYPES = {k:ydb.PrimitiveType.Utf8 for k in TEXT_FIELDS}
LEAD_TYPES.update(created_at_ms=ydb.PrimitiveType.Uint64, telegram_sent=ydb.PrimitiveType.Bool)
LEGAL_TYPES = dict(LEAD_TYPES)
LEGAL_TYPES.update({k:ydb.OptionalType(ydb.PrimitiveType.Utf8) for k in META_TEXT})
LEGAL_TYPES.update({k:ydb.OptionalType(ydb.PrimitiveType.Uint64) for k in META_NUMBER})

def struct(types):
    result=ydb.StructType()
    for key,kind in types.items(): result.add_member(key,kind)
    return result

class BulkStore:
    def __init__(self,client,database,prefix,metadata_enabled=False):
        if not re.fullmatch(r'[a-z][a-z0-9_]{0,40}_',prefix): raise ValueError('Invalid prefix')
        self.client,self.database,self.prefix=client,database.rstrip('/'),prefix
        self.metadata_enabled=metadata_enabled
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

    def _guard(self, receipt):
        identity=receipt[:36]
        if self._read('leads', {'request_id':'deleted:'+identity}, {'request_id':ydb.PrimitiveType.Utf8}):
            raise RequestDeleted()

    def save(self,data,digest,now_ms):
        receipt=data['requestId']+':'+digest
        self._guard(receipt)
        existing=self._read('leads',{'request_id':receipt},{'request_id':ydb.PrimitiveType.Utf8})
        if existing and (existing.get('status')=='deleting' or (
            existing.get('purge_at_ms') is not None and existing['purge_at_ms']<=now_ms)):
            raise RequestDeleted()
        if data['schemaVersion']==2 and not self.metadata_enabled:
            raise RuntimeError('Schema migration required')
        c=data.get('consent',{})
        row={k:'' for k in TEXT_FIELDS}
        row.update(request_id=receipt,lead_id=receipt,payload_hash=digest,
            **{k:data[k] for k in ('branch','name','surname','phone','direction')},
            source='Сайт',status='notification_pending',client_created_at=data['createdAt'],
            created_at_ms=int(datetime.fromisoformat(data['createdAt'].replace('Z','+00:00')).timestamp()*1000),
            consent_accepted_at=c.get('acceptedAt',''),consent_version=c.get('version',''),
            consent_document_url=c.get('documentUrl',''),privacy_url=c.get('privacyUrl','https://tzvuka.ru/documents/#privacy'),
            page_path=data['pagePath'],telegram_sent=False,crm_state='pending')
        types=LEAD_TYPES
        if self.metadata_enabled:
            values=evidence(data,now_ms)
            if existing:
                values.update({k:existing[k] for k in (*META_TEXT,*META_NUMBER) if existing.get(k) is not None})
            row.update(values)
            types=LEGAL_TYPES
        # Deterministic full row: a repeated submission cannot overwrite delivery acknowledgements.
        self._write_confirm('leads',row,types,{'request_id':receipt})
        self._guard(receipt)
        return receipt

    def notify(self,receipt,sender):
        if not isinstance(receipt,str) or not re.fullmatch(r'[0-9a-f-]{36}:[0-9a-f]{64}',receipt):
            raise ValueError('Invalid receipt')
        self._guard(receipt)
        lead=self._read('leads',{'request_id':receipt},{'request_id':ydb.PrimitiveType.Utf8})
        if not lead: raise RuntimeError('Lead missing')
        if (lead.get('purge_at_ms') is not None and lead['purge_at_ms']<=int(time.time()*1000)) or lead.get('status')=='deleting' or (
            lead.get('retention_due_ms') and lead['retention_due_ms']<=int(time.time()*1000)):
            raise RequestDeleted()
        # YDB ReadRows rejects tables with indexes (400070); existing outbox has due_idx.
        # A reserved key in the unindexed leads table keeps the acknowledgement independent.
        key={'request_id':'sent:'+receipt}
        marker=self._read('leads',key,{'request_id':ydb.PrimitiveType.Utf8})
        if marker and marker.get('telegram_sent') is True: return 'sent'
        self._guard(receipt)
        # Failure/timeout never overwrites the durable pending intent or a successful marker.
        message=sender(lead)
        if type(message) is not int or message<=0: raise RuntimeError('Delivery unconfirmed')
        marker=dict(lead,**key,status='notification_sent',telegram_sent=True,telegram_message_id=str(message))
        self._write_confirm('leads',marker,LEGAL_TYPES if self.metadata_enabled else LEAD_TYPES,key)
        return 'sent'
