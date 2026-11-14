"""Cloud Functions entrypoint: index.handler. Off by default; no resources created."""
import json
import os
import threading
import urllib.parse
import urllib.request
import ydb
from service import BRANCHES, DIRECTIONS, receive, deliver_due, reply
from ydb_store import YdbStore

_lock=threading.Lock()
_driver=None
_store=None

def get_store():
    global _driver,_store
    with _lock:
        if _store is None:
            driver=ydb.Driver(endpoint=os.environ["YDB_ENDPOINT"],database=os.environ["YDB_DATABASE"],
                              credentials=ydb.iam.MetadataUrlCredentials())
            try:
                driver.wait(timeout=5,fail_fast=True)
                store=YdbStore(ydb.SessionPool(driver,size=5),os.environ.get("YDB_TABLE_PREFIX","tz_site_"))
            except Exception:
                driver.stop()
                raise
            _driver,_store=driver,store
        return _store

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None

def post(url, body, content_type):
    request=urllib.request.Request(url,data=body,headers={"Content-Type":content_type},method="POST")
    with urllib.request.build_opener(NoRedirect).open(request,timeout=8) as response:
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
    result=post("https://api.telegram.org/bot"+os.environ["TELEGRAM_BOT_TOKEN"]+"/sendMessage",
        json.dumps({"chat_id":chat,"text":text,"link_preview_options":{"is_disabled":True}}).encode(),"application/json")
    message=result.get("result",{}).get("message_id")
    if result.get("ok") is not True or type(message) is not int or message<=0:
        raise RuntimeError("Delivery unconfirmed")
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
            return receive(event,os.environ,LazyStore(),verify)
        if os.environ.get("DELIVERY_ENABLED")=="true" and timer_allowed(event):
            return deliver_due(get_store(),telegram)
        return {"ignored":True}
    except Exception:
        # Never return SDK, SQL, secret, contact, HTTP request or Telegram URL details.
        return reply(503,{"error":"unavailable"})
