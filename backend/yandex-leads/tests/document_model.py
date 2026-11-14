"""Atomic Document API contract model. NOT a YDB implementation/compatibility proof."""
import copy
import threading
from document_api import encode,decode
from storage_errors import ConditionalFailed,StorageUnavailable

class AtomicDocumentModel:
    def __init__(self,page_size=25):
        self.rows={};self.lock=threading.RLock();self.calls=[];self.faults=[];self.page_size=page_size

    def fail(self,op,phase='before',prefix='lead:'):
        self.faults.append((op,phase,prefix))

    def _fault(self,op,phase,key):
        for i,match in enumerate(self.faults):
            if match[0]==op and match[1]==phase and key.startswith(match[2]):
                self.faults.pop(i)
                raise StorageUnavailable('Injected lost acknowledgement')

    def call(self,op,request):
        with self.lock:
            self.calls.append((op,copy.deepcopy(request)))
            key=decode(request.get('Key',request.get('Item',{}))).get('pk','')
            self._fault(op,'before',key)
            if op=='GetItem':
                assert request['ConsistentRead'] is True
                result={'Item':encode(self.rows[key])} if key in self.rows else {}
            elif op=='PutItem':
                item=decode(request['Item']);old=self.rows.get(key)
                condition=request['ConditionExpression']
                if condition=='attribute_not_exists(#pk)':
                    if old is not None:raise ConditionalFailed()
                elif condition=='attribute_exists(#pk) AND #v = :expected':
                    expected=decode(request['ExpressionAttributeValues'])[':expected']
                    if old is None or old['version']!=expected:raise ConditionalFailed()
                else:raise AssertionError('Unconditional or unknown write')
                self.rows[key]=copy.deepcopy(item);result={}
            elif op=='Scan':
                assert request['ConsistentRead'] is True
                start=decode(request.get('ExclusiveStartKey',{})).get('pk','')
                keys=[k for k in sorted(self.rows) if k>start]
                count=min(request['Limit'],self.page_size);evaluated=keys[:count]
                now=decode(request['ExpressionAttributeValues'])[':now']
                wanted=[self.rows[k] for k in evaluated if self.rows[k].get('kind')=='lead'
                    and self.rows[k].get('notify_state')=='pending' and self.rows[k]['next_attempt_ms']<=now]
                result={'Items':[encode({k:r[k] for k in ('pk','kind','notify_state','next_attempt_ms')}) for r in wanted]}
                if len(keys)>count:result['LastEvaluatedKey']=encode({'pk':evaluated[-1]})
            else:raise AssertionError('Unsupported operation: '+op)
            self._fault(op,'after',key)
            return result
