"""Provider-neutral lead contract with SmartCaptcha proof; no logging of requests."""
import base64
import hashlib
import hmac
import ipaddress
import json
import re
import time
import unicodedata
import uuid
from datetime import datetime
from ydb_store import RequestConflict

ORIGINS={"https://tzvuka.ru","https://www.tzvuka.ru"}
BRANCHES={"kaluga":"Калуга","troitsk":"Троицк"}
DIRECTIONS={"vocal":"Вокал","guitar":"Гитара","drums":"Барабаны","piano":"Фортепиано",
            "actor":"Актёрское мастерство","speech":"Ораторское искусство","unsure":"Помогите выбрать"}
FIELDS={"schemaVersion","requestId","createdAt","name","surname","phone","branch","direction","website","pagePath","consent","captchaToken"}
CONSENT_FIELDS={"accepted","acceptedAt","version","documentUrl","privacyUrl"}
def timestamp(value, now_ms):
    if not isinstance(value,str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z",value):
        return False
    try:
        ms=datetime.fromisoformat(value.replace("Z","+00:00")).timestamp()*1000
        return now_ms-86400000<=ms<=now_ms+300000
    except ValueError:
        return False

def person(value):
    return (isinstance(value,str) and value==value.strip() and 2<=len(value)<=80 and value[0].isalpha()
            and all(unicodedata.category(c)[0] in ("L","M") or c in " '-’" for c in value))

def valid(data, origin, now_ms):
    if not isinstance(data,dict) or set(data)!=FIELDS:
        return False
    c=data["consent"]
    try:
        request_id=uuid.UUID(data["requestId"])
        id_ok=request_id.version==4 and str(request_id)==data["requestId"]
    except (ValueError,TypeError,AttributeError):
        return False
    return (type(data["schemaVersion"]) is int and data["schemaVersion"]==1 and id_ok
        and timestamp(data["createdAt"],now_ms) and person(data["name"]) and person(data["surname"])
        and isinstance(data["phone"],str) and re.fullmatch(r"\+7\d{10}",data["phone"],re.ASCII) is not None
        and isinstance(data["branch"],str) and data["branch"] in BRANCHES
        and isinstance(data["direction"],str) and data["direction"] in DIRECTIONS and data["website"]==""
        and data["pagePath"] in ("/","/"+data["branch"]+"/")
        and isinstance(data["captchaToken"],str) and 0<len(data["captchaToken"])<=8192
        and isinstance(c,dict) and set(c)==CONSENT_FIELDS and c["accepted"] is True
        and timestamp(c["acceptedAt"],now_ms) and c["version"]=="2026-11-10-v3"
        and c["documentUrl"]==origin+"/documents/#consent" and c["privacyUrl"]==origin+"/documents/#privacy")

def reply(status, body, origin=None):
    return {"statusCode":status,"isBase64Encoded":False,"headers":{
        "Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Vary":"Origin",
        **({"Access-Control-Allow-Origin":origin} if origin else {}),
        **({"Retry-After":"60"} if status==429 else {})},
        "body":json.dumps(body,ensure_ascii=False)}

def decode_body(event):
    body=event.get("body","")
    if not isinstance(body,str) or len(body)>24000:
        raise OverflowError()
    raw=base64.b64decode(body,validate=True) if event.get("isBase64Encoded") else body.encode("utf-8")
    if len(raw)>16384:
        raise OverflowError()
    def object_pairs(pairs):
        result={}
        for k,v in pairs:
            if k in result:
                raise ValueError("Duplicate field")
            result[k]=v
        return result
    return json.loads(raw.decode("utf-8"),object_pairs_hook=object_pairs)

def receive(event, env, store, verify, now_ms=None):
    now_ms=int(time.time()*1000) if now_ms is None else now_ms
    headers={str(k).lower():v for k,v in event.get("headers",{}).items()}
    origin=headers.get("origin")
    if origin not in ORIGINS:
        return reply(403,{"error":"origin_rejected"})
    if event.get("path")!="/public/lead":
        return reply(404,{"error":"not_found"},origin)
    method=event.get("httpMethod")
    if method=="OPTIONS":
        if headers.get("access-control-request-method")!="POST" or any(
            h.strip().lower()!="content-type" for h in headers.get("access-control-request-headers","").split(",") if h):
            return reply(403,{"error":"cors_rejected"},origin)
        result=reply(204,{},origin);result["body"]=""
        result["headers"].update({"Access-Control-Allow-Methods":"POST, OPTIONS",
                                  "Access-Control-Allow-Headers":"Content-Type","Access-Control-Max-Age":"600"})
        return result
    if method!="POST":
        return reply(405,{"error":"method_rejected"},origin)
    if env.get("PUBLIC_LEADS_ENABLED")!="true":
        return reply(503,{"error":"disabled"},origin)
    if not re.fullmatch(r"application/json(?:\s*;\s*charset=utf-8)?",headers.get("content-type",""),re.I):
        return reply(415,{"error":"json_required"},origin)
    try:
        # Trust gateway-produced context, never X-Forwarded-For / cf-connecting-ip.
        context=event.get("requestContext",{})
        if context.get("apiGateway",{}).get("operationContext",{}).get("route")!="website-leads-v1":
            return reply(403,{"error":"gateway_required"},origin)
        ip=str(ipaddress.ip_address(context.get("identity",{}).get("sourceIp","")))
        key=hmac.new(env["RATE_HMAC_KEY"].encode(),(str(now_ms//86400000)+":"+ip).encode(),hashlib.sha256).hexdigest()
        if not store.rate_limit(key,now_ms):
            return reply(429,{"error":"rate_limited"},origin)
        try:
            data=decode_body(event)
        except OverflowError:
            return reply(413,{"error":"too_large"},origin)
        except (ValueError,UnicodeError):
            return reply(400,{"error":"invalid_request"},origin)
        if not valid(data,origin,now_ms):
            return reply(400,{"error":"invalid_request"},origin)
        proof=verify(data["captchaToken"],ip)
        # SmartCaptcha has status/host, NOT Turnstile success/action fields.
        if proof.get("status")!="ok" or proof.get("host")!=origin.split("://",1)[1]:
            return reply(403,{"error":"verification_failed"},origin)
        business={k:v for k,v in data.items() if k!="captchaToken"}
        digest=hashlib.sha256(json.dumps(business,sort_keys=True,ensure_ascii=False,separators=(",",":")).encode()).hexdigest()
        lead_id=store.save(business,digest,now_ms)
        if not isinstance(lead_id,str) or not lead_id:
            raise RuntimeError("Persistence unconfirmed")
        return reply(200,{"ok":True,"saved":True,"requestId":data["requestId"],"leadId":lead_id},origin)
    except RequestConflict:
        return reply(409,{"error":"request_conflict"},origin)
    except Exception:
        return reply(503,{"error":"unavailable"},origin)

def deliver_due(store, telegram, now_ms=None):
    clock=(lambda:int(time.time()*1000)) if now_ms is None else (lambda:now_ms)
    counts={"sent":0,"deferred":0,"errors":0}
    for request_id in store.due(clock(),10):
        try:
            claim=store.claim(request_id,clock())
            if not claim:
                continue
            message_id=None
            try:
                message_id=telegram(claim["lead"])
            except Exception:
                pass
            confirmed=store.finish(request_id,claim["token"],clock(),claim["attempts"],message_id)
            if confirmed:
                counts["sent" if message_id is not None else "deferred"]+=1
        except Exception:
            counts["errors"]+=1
    return counts
