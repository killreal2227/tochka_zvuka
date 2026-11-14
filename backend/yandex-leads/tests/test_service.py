import copy
import json
import sys
import unittest
import uuid
from datetime import datetime,timezone
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from service import receive, deliver_due
from ydb_store import RequestConflict
import index

NOW=1800000000000
STAMP=datetime.fromtimestamp(NOW/1000,timezone.utc).isoformat(timespec="milliseconds").replace("+00:00","Z")
def payload():
    return dict(schemaVersion=1,requestId=str(uuid.uuid4()),createdAt=STAMP,name="Тест",
        surname="Вымышленный",phone="+79990000000",branch="kaluga",direction="vocal",website="",
        pagePath="/kaluga/",captchaToken="fixture-proof",
        consent=dict(accepted=True,acceptedAt=STAMP,version="2026-11-10-v3",
        documentUrl="https://tzvuka.ru/documents/#consent",privacyUrl="https://tzvuka.ru/documents/#privacy"))
def event(data=None):
    return {"path":"/public/lead","httpMethod":"POST","body":json.dumps(data or payload()),
        "headers":{"origin":"https://tzvuka.ru","content-type":"application/json"},
        "requestContext":{"identity":{"sourceIp":"192.0.2.1"},
        "apiGateway":{"operationContext":{"route":"website-leads-v1"}}}}
ENV={"PUBLIC_LEADS_ENABLED":"true","RATE_HMAC_KEY":"fixture-secret"}
class FakeStore:
    def __init__(self):
        self.rows={};self.allowed=True;self.rate_keys=[];self.finishes=[]
    def rate_limit(self,key,now): self.rate_keys.append(key);return self.allowed
    def save(self,data,digest,now):
        old=self.rows.get(data["requestId"])
        if old and old[0]!=digest: raise RequestConflict()
        self.rows.setdefault(data["requestId"],(digest,str(uuid.uuid4()),data))
        return self.rows[data["requestId"]][1]
    def due(self,now,limit): return ["fixture-request"]
    def claim(self,id,now): return {"token":"fixture-lease","attempts":1,"lead":{"branch":"kaluga"}}
    def finish(self,*args): self.finishes.append(args);return True
class ServiceTests(unittest.TestCase):
    def call(self,e=None,env=None,proof=None,store=None):
        return receive(e or event(),env or ENV,store or self.store,
            lambda token,ip: proof if proof is not None else {"status":"ok","host":"tzvuka.ru"},NOW)
    def setUp(self): self.store=FakeStore()
    def test_both_branches_contract_and_idempotent_retry(self):
        for branch in ("kaluga","troitsk"):
            p=payload();p["branch"]=branch;p["pagePath"]="/"+branch+"/"
            a=self.call(event(p));p["captchaToken"]="new-proof";b=self.call(event(p))
            self.assertEqual(a["statusCode"],200);self.assertEqual(json.loads(a["body"]),json.loads(b["body"]))
            self.assertTrue(json.loads(a["body"])["saved"])
        self.assertEqual(len(self.store.rows),2)
        self.assertNotIn("captchaToken",next(iter(self.store.rows.values()))[2])
        self.assertRegex(self.store.rate_keys[0],r"^[0-9a-f]{64}$")
    def test_conflict(self):
        p=payload();self.call(event(p));p["name"]="Другое"
        self.assertEqual(self.call(event(p))["statusCode"],409)
    def test_captcha_failures_and_empty_host_fail_closed(self):
        for p in ({},{"status":"failed"},{"status":"ok","host":""},{"status":"ok","host":"evil.example"},{"success":True,"hostname":"tzvuka.ru"}):
            self.assertEqual(self.call(proof=p)["statusCode"],403)
        self.assertEqual(self.store.rows,{})
    def test_validation(self):
        for change in ({"captchaToken":""},{"captchaToken":None},{"surname":""},{"branch":"other"},
            {"direction":"other"},{"phone":"123"},{"extra":1},{"consent":{"accepted":False}},
            {"createdAt":"2000-01-01"},{"name":"A\nB"},{"pagePath":"/troitsk/"},{"schemaVersion":True}):
            p=payload();p.update(change)
            self.assertEqual(self.call(event(p))["statusCode"],400,str(change))
    def test_origin_cors_methods_size_json_and_gateway(self):
        e=event();e["headers"]["origin"]="https://evil.example";r=self.call(e)
        self.assertEqual(r["statusCode"],403);self.assertNotIn("Access-Control-Allow-Origin",r["headers"])
        e=event();e["httpMethod"]="OPTIONS";e["headers"]["access-control-request-method"]="POST"
        self.assertEqual(self.call(e)["statusCode"],204)
        e["headers"]["access-control-request-headers"]="X-Api-Key";self.assertEqual(self.call(e)["statusCode"],403)
        e=event();e["httpMethod"]="GET";self.assertEqual(self.call(e)["statusCode"],405)
        e=event();e["headers"]["content-type"]="text/plain";self.assertEqual(self.call(e)["statusCode"],415)
        e=event();e["body"]="x"*17000;self.assertEqual(self.call(e)["statusCode"],413)
        e=event();e["body"]='{"a":1,"a":2}';self.assertEqual(self.call(e)["statusCode"],400)
        e=event();e["requestContext"]={};e["headers"]["cf-connecting-ip"]="192.0.2.1"
        self.assertEqual(self.call(e)["statusCode"],403)
    def test_rate_and_database_failure_never_ack(self):
        self.store.allowed=False;self.assertEqual(self.call()["statusCode"],429)
        self.store.allowed=True
        with patch.object(self.store,"save",side_effect=RuntimeError("secret data")):
            r=self.call();self.assertEqual(r["statusCode"],503);self.assertNotIn("secret",r["body"])
    def test_disabled_without_store_and_no_external_calls(self):
        self.assertEqual(receive(event(),{},None,None,NOW)["statusCode"],503)
        with patch.dict(index.os.environ,{},clear=True),patch.object(index,"get_store") as get:
            self.assertEqual(index.handler(event(),None)["statusCode"],503);get.assert_not_called()
    def test_telegram_failure_persists_retry_and_only_confirmation_marks_sent(self):
        def fail(lead): raise RuntimeError("fixture failure")
        counts=deliver_due(self.store,fail,NOW)
        self.assertEqual(counts["deferred"],1);self.assertIsNone(self.store.finishes[-1][-1])
        counts=deliver_due(self.store,lambda lead:42,NOW)
        self.assertEqual(counts["sent"],1);self.assertEqual(self.store.finishes[-1][-1],42)
    def test_timer_id_and_type_are_required(self):
        e={"messages":[{"event_metadata":{"event_type":"yandex.cloud.events.serverless.triggers.TimerMessage","trigger_id":"fixture-trigger"}}]}
        with patch.dict(index.os.environ,{"DELIVERY_TRIGGER_ID":"fixture-trigger"}):
            self.assertTrue(index.timer_allowed(e));e["messages"][0]["event_metadata"]["trigger_id"]="other"
            self.assertFalse(index.timer_allowed(e))
    def test_server_telegram_routes_by_branch_and_requires_ack(self):
        for branch in ("kaluga","troitsk"):
            lead=dict(request_id="fixture",name="Fixture",surname="Example",phone="+79990000000",branch=branch,direction="vocal")
            env={"TELEGRAM_BOT_TOKEN":"fixture-token","TELEGRAM_CHAT_"+branch.upper():"fixture-"+branch}
            with patch.dict(index.os.environ,env,clear=True),patch.object(index,"post",return_value={"ok":True,"result":{"message_id":42}}) as post:
                self.assertEqual(index.telegram(lead),42)
                self.assertEqual(json.loads(post.call_args.args[1])["chat_id"],"fixture-"+branch)
            with patch.dict(index.os.environ,env,clear=True),patch.object(index,"post",return_value={"ok":True}):
                with self.assertRaises(RuntimeError): index.telegram(lead)
