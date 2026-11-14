"""Cloud Functions entrypoint: index.handler. Off by default; no resources created."""
import json
import http.client
import os
import socket
import threading
import urllib.parse
import urllib.request
import urllib.error
import ydb
from service import BRANCHES, DIRECTIONS, receive, deliver_due, reply
from bulk_store import BulkStore
from storage_errors import DeliveryFailure

_lock=threading.Lock()
_store=None

def get_store():
    global _store
    with _lock:
        if _store is None:
            # Operator must verify the actual resource IDs; this label is only a guard.
            if os.environ.get("YDB_DATABASE_LABEL")!="tochka-leads":
                raise RuntimeError("Unreviewed database target")
            if os.environ.get('LEADS_STORAGE_BACKEND')!='bulk_read':
                raise RuntimeError('Native RPC backend must be explicit')
            endpoint=os.environ.get('YDB_ENDPOINT','')
            database=os.environ.get('YDB_DATABASE','')
            if endpoint!='grpcs://ydb.serverless.yandexcloud.net:2135' or database!='/ru-central1/b1gs93r1fhsuparnmrba/etntmjbnguvsu5l8bv3s':
                raise RuntimeError('Unreviewed database endpoint/path')
            prefix=os.environ.get('YDB_TABLE_PREFIX','')
            if prefix!='tz_site_test_20261114_':
                raise RuntimeError('Only approved test tables are enabled')
            driver=ydb.Driver(endpoint=endpoint,database=database,credentials=ydb.iam.MetadataUrlCredentials())
            driver.wait(timeout=8,fail_fast=True)
            _store=BulkStore(driver.table_client,database,prefix)
            _store.driver=driver

        return _store

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None

class TelegramConnection(http.client.HTTPSConnection):
    def __init__(self,host,address,**kwargs):
        if host!='api.telegram.org' or address!='149.154.167.220':
            raise RuntimeError('Unreviewed Telegram destination')
        super().__init__(host,**kwargs)
        self.address=address

    def connect(self):
        # Connect to the verified reachable Telegram address, retaining hostname/SNI/certificate checks.
        raw=socket.create_connection((self.address,443),self.timeout,self.source_address)
        try:
            self.sock=self._context.wrap_socket(raw,server_hostname=self.host)
        except Exception:
            raw.close()
            raise

class TelegramHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self,address):
        super().__init__()
        self.address=address

    def https_open(self,request):
        return self.do_open(lambda host,**kwargs:TelegramConnection(host,self.address,**kwargs),
                            request,context=self._context)

def post(url, body, content_type):
    request=urllib.request.Request(url,data=body,headers={"Content-Type":content_type},method="POST")
    handlers=[NoRedirect]
    if urllib.parse.urlsplit(url).netloc=='api.telegram.org' and os.environ.get('TELEGRAM_CONNECT_IPV4'):
        handlers.extend([urllib.request.ProxyHandler({}),TelegramHTTPSHandler(os.environ['TELEGRAM_CONNECT_IPV4'])])
    with urllib.request.build_opener(*handlers).open(request,timeout=8) as response:
        if response.status!=200:
            raise RuntimeError("Upstream unavailable")
        raw=response.read(65537)
        if len(raw)>65536:
            raise RuntimeError("Upstream invalid")
        return json.loads(raw.decode())

def verify(token, ip):
    body=urllib.parse.urlencode({"secret":os.environ["SMARTCAPTCHA_SERVER_KEY"],"token":token,"ip":ip}).encode()
    return post("https://smartcaptcha.cloud.yandex.ru/validate",body,"application/x-www-form-urlencoded")

def telegram(lead):
    branch=lead["branch"]
    if branch not in BRANCHES:
        raise RuntimeError("Unknown branch")
    chat=os.environ["TELEGRAM_CHAT_"+branch.upper()]
    text="\n".join(["Новая заявка с сайта «Точка звука»","Филиал: "+BRANCHES[branch],
        "Имя: "+lead["name"]+" "+lead["surname"],"Телефон: "+lead["phone"],
        "Направление: "+DIRECTIONS[lead["direction"]],"Заявка: "+lead["request_id"]])
    try:
        result=post("https://api.telegram.org/bot"+os.environ["TELEGRAM_BOT_TOKEN"]+"/sendMessage",
            json.dumps({"chat_id":chat,"text":text,"link_preview_options":{"is_disabled":True}}).encode(),"application/json")
    except urllib.error.HTTPError as error:
        status=error.code
        try:result=json.loads(error.read(65536))
        except Exception:result={}
        if status==429:
            raise DeliveryFailure('telegram_429',result.get('parameters',{}).get('retry_after')) from None
        if status in (400,401,403):
            raise DeliveryFailure('telegram_'+str(status),permanent=True) from None
        raise DeliveryFailure('telegram_5xx' if status>=500 else 'delivery_unconfirmed') from None
    except Exception:raise DeliveryFailure() from None
    message=result.get("result",{}).get("message_id")
    if result.get("ok") is not True or type(message) is not int or message<=0:
        code=result.get('error_code')
        if code==429:raise DeliveryFailure('telegram_429',result.get('parameters',{}).get('retry_after'))
        if code in (400,401,403):raise DeliveryFailure('telegram_'+str(code),permanent=True)
        raise DeliveryFailure()
    return message

def timer_allowed(event):
    messages=event.get("messages",[])
    trigger=os.environ.get("DELIVERY_TRIGGER_ID")
    return bool(trigger and messages and all(
        m.get("event_metadata",{}).get("event_type")=="yandex.cloud.events.serverless.triggers.TimerMessage"
        and m.get("event_metadata",{}).get("trigger_id")==trigger for m in messages))

class LazyStore:
    def __getattr__(self,name):
        return getattr(get_store(),name)

def handler(event, context):
    try:
        if "httpMethod" in event:
            return receive(event,os.environ,LazyStore(),verify,
                sender=telegram if os.environ.get("DELIVERY_ENABLED")=="true" else None)
        # Direct IAM-authorized invocation only: never exposed as an HTTP route.
        if os.environ.get("DELIVERY_ENABLED")=="true" and set(event)=={"retryReceipt"}:
            try:
                return {"notification":get_store().notify(event['retryReceipt'],telegram)}
            except Exception:
                return {"notification":"pending"}
        return {"ignored":True}
    except Exception:
        # Never return SDK, SQL, secret, contact, HTTP request or Telegram URL details.
        return reply(503,{"error":"unavailable"})
