"""YDB Document API HTTP client. No YQL, SigV4 keys, schema creation or logging."""
import json
from decimal import Decimal,InvalidOperation
import urllib.error
import urllib.parse
import urllib.request
from storage_errors import ConditionalFailed, StorageUnavailable

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def encode(item):
    result={}
    for key,value in item.items():
        if type(value) is bool:result[key]={'BOOL':value}
        elif type(value) is int:result[key]={'N':str(value)}
        elif isinstance(value,str):result[key]={'S':value}
        else:raise ValueError('Only explicit scalar attributes are stored')
    return result

def decode(item):
    result={}
    for key,value in item.items():
        if set(value)=={'S'} and isinstance(value['S'],str):result[key]=value['S']
        elif set(value)=={'N'}:
            try:
                number=Decimal(value['N'])
                if not number.is_finite() or number!=number.to_integral_value():
                    raise ValueError()
                result[key]=int(number)
            except (ValueError,InvalidOperation):raise StorageUnavailable('Invalid stored integer') from None
        elif set(value)=={'BOOL'} and type(value['BOOL']) is bool:result[key]=value['BOOL']
        else:raise StorageUnavailable('Unexpected stored attribute')
    return result

class DocumentAPI:
    def __init__(self,endpoint,token_provider,opener=None):
        url=urllib.parse.urlsplit(endpoint)
        expected='/ru-central1/b1gs93r1fhsuparnmrba/etntmjbnguvsu5l8bv3s'
        if (url.scheme!='https' or url.netloc!='docapi.serverless.yandexcloud.net' or
                url.path!=expected or url.query or url.fragment):
            raise RuntimeError('Document API must target the verified tochka-leads database')
        self.endpoint,self.token_provider=endpoint,token_provider
        self.opener=opener or urllib.request.build_opener(NoRedirect)

    def call(self,operation,payload):
        if operation not in {'PutItem','GetItem','Scan'}:
            raise ValueError('Operation not allowed in runtime')
        try:
            request=urllib.request.Request(self.endpoint,data=json.dumps(payload).encode(),headers={
                'Authorization':'Bearer '+self.token_provider(),
                'X-Amz-Target':'DynamoDB_20120810.'+operation,
                'Content-Type':'application/x-amz-json-1.0'},method='POST')
            with self.opener.open(request,timeout=8) as response:
                if response.status!=200:raise StorageUnavailable('Unconfirmed operation')
                raw=response.read(2*1024*1024+1)
                if len(raw)>2*1024*1024:raise StorageUnavailable('Oversized response')
                data=json.loads(raw)
                if not isinstance(data,dict):raise StorageUnavailable('Malformed response')
                if '__type' in data:raise StorageUnavailable('Unexpected error response')
                return data
        except urllib.error.HTTPError as error:
            try:
                code=json.loads(error.read(65536)).get('__type','').split('#')[-1]
            except Exception:code=''
            if code=='ConditionalCheckFailedException':raise ConditionalFailed() from None
            raise StorageUnavailable('Document operation unavailable') from None
        except (ConditionalFailed,StorageUnavailable):raise
        except Exception:raise StorageUnavailable('Document response not confirmed') from None
