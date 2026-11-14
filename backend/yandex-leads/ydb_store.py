"""YDB Table SDK, SerializableReadWrite only. No SQLite or schema creation at runtime."""
import hashlib
import re
import uuid
import ydb
from storage_errors import RequestConflict

UTF8 = ydb.PrimitiveType.Utf8
U64 = ydb.PrimitiveType.Uint64
U32 = ydb.PrimitiveType.Uint32
BOOL = ydb.PrimitiveType.Bool
LEAD_TYPES = {k: UTF8 for k in (
    "request_id", "payload_hash", "lead_id", "branch", "name", "surname", "phone",
    "direction", "source", "status", "client_created_at", "consent_accepted_at",
    "consent_version", "consent_document_url", "privacy_url", "page_path",
    "telegram_message_id", "crm_state", "crm_external_id")}
LEAD_TYPES.update(created_at_ms=U64, telegram_sent=BOOL)

def shard_for(request_id):
    return hashlib.sha256(request_id.encode()).digest()[0] % 4

class YdbStore:
    def __init__(self, pool, prefix="tz_site_"):
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,40}_", prefix):
            raise ValueError("Invalid table prefix")
        self.pool, self.prefix = pool, prefix

    def _table(self, name):
        return "`" + self.prefix + name + "`"

    def _execute(self, tx, text, parameters=None, commit=False):
        parameters = parameters or {}
        declarations = "\n".join("DECLARE $" + k + " AS " + str(t) + ";" for k, (_, t) in parameters.items())
        query = ydb.DataQuery(declarations + "\n" + text,
                              {"$" + k: t for k, (_, t) in parameters.items()})
        return tx.execute(query, {"$" + k: v for k, (v, _) in parameters.items()}, commit_tx=commit)

    def _run(self, operation, idempotent=False):
        def callee(session):
            with session.transaction(ydb.SerializableReadWrite()) as tx:
                try:
                    return operation(tx)
                except Exception:
                    try:
                        tx.rollback()
                    except Exception:
                        pass
                    raise
        # Retry whole aborted transactions. Broader ambiguous retries are enabled only for safe operations.
        return self.pool.retry_operation_sync(callee, ydb.RetrySettings(max_retries=4, idempotent=idempotent))

    def rate_limit(self, key, now_ms, limit=5, global_limit=100):
        window = now_ms // 60000 * 60
        def operation(tx):
            rows = self._execute(tx,
                "SELECT bucket_key,hits FROM " + self._table("rate_limits") +
                " WHERE window_start=$window AND bucket_key IN ($ip,$global);",
                {"window": (window,U64), "ip": (key,UTF8), "global": ("all",UTF8)})[0].rows
            counts = {r.bucket_key:r.hits for r in rows}
            if counts.get(key,0) >= limit or counts.get("all",0) >= global_limit:
                tx.commit()
                return False
            self._execute(tx, "UPSERT INTO " + self._table("rate_limits") +
                " (bucket_key,window_start,hits) VALUES ($ip,$window,$ip_hits),($global,$window,$global_hits);",
                {"window":(window,U64),"ip":(key,UTF8),"global":("all",UTF8),
                 "ip_hits":(counts.get(key,0)+1,U64),"global_hits":(counts.get("all",0)+1,U64)}, True)
            return True
        return self._run(operation)

    def save(self, data, payload_hash, now_ms):
        request_id = data["requestId"]
        lead = dict(request_id=request_id,payload_hash=payload_hash,lead_id=str(uuid.uuid4()),
            branch=data["branch"],name=data["name"],surname=data["surname"],phone=data["phone"],
            direction=data["direction"],source="Сайт",status="new",created_at_ms=now_ms,
            client_created_at=data["createdAt"],consent_accepted_at=data["consent"]["acceptedAt"],
            consent_version=data["consent"]["version"],consent_document_url=data["consent"]["documentUrl"],
            privacy_url=data["consent"]["privacyUrl"],page_path=data["pagePath"],telegram_sent=False,
            telegram_message_id="",crm_state="pending",crm_external_id="")
        def operation(tx):
            rows = self._execute(tx,"SELECT payload_hash,lead_id FROM " + self._table("leads") +
                " WHERE request_id=$id;", {"id":(request_id,UTF8)})[0].rows
            if rows:
                if rows[0].payload_hash != payload_hash:
                    raise RequestConflict()
                tx.commit()
                return rows[0].lead_id
            self._execute(tx,"INSERT INTO " + self._table("leads") +
                " ("+",".join(lead)+") VALUES ("+",".join("$"+k for k in lead)+");",
                {k:(v,LEAD_TYPES[k]) for k,v in lead.items()})
            self._execute(tx,"INSERT INTO " + self._table("outbox") +
                " (shard,request_id,state,attempts,next_attempt_ms,lease_until_ms,lease_token,last_error_code)" +
                " VALUES ($shard,$id,'pending',0ul,$now,0ul,'','');",
                {"shard":(shard_for(request_id),U32),"id":(request_id,UTF8),"now":(now_ms,U64)},True)
            return lead["lead_id"]
        return self._run(operation, idempotent=True)

    def due(self, now_ms, limit=10):
        # Index is synchronously maintained; claim still rechecks the primary row transactionally.
        def operation(tx):
            found=[]
            for offset in range(4):
                shard=(now_ms//60000+offset)%4
                rows=self._execute(tx,"SELECT request_id FROM " + self._table("outbox") +
                    " VIEW due_idx WHERE shard=$shard AND state='pending' AND next_attempt_ms<=$now" +
                    " ORDER BY next_attempt_ms LIMIT $limit;",
                    {"shard":(shard,U32),"now":(now_ms,U64),"limit":(limit,U64)})[0].rows
                found.extend(r.request_id for r in rows)
            tx.commit()
            return found[:limit]
        return self._run(operation, idempotent=True)

    def claim(self, request_id, now_ms):
        token=str(uuid.uuid4())
        params={"shard":(shard_for(request_id),U32),"id":(request_id,UTF8)}
        def operation(tx):
            rows=self._execute(tx,"SELECT * FROM "+self._table("outbox")+
                " WHERE shard=$shard AND request_id=$id;",params)[0].rows
            if not rows or rows[0].state!="pending" or rows[0].next_attempt_ms>now_ms or rows[0].lease_until_ms>now_ms:
                tx.commit()
                return None
            entry=rows[0]
            leads=self._execute(tx,"SELECT * FROM "+self._table("leads")+
                " WHERE request_id=$id;",{"id":(request_id,UTF8)})[0].rows
            if not leads:
                raise RuntimeError("Outbox invariant")
            attempts=entry.attempts+1
            self._execute(tx,"UPDATE "+self._table("outbox")+
                " SET lease_token=$token,lease_until_ms=$until,next_attempt_ms=$until,attempts=$attempts"+
                " WHERE shard=$shard AND request_id=$id;",
                dict(params,token=(token,UTF8),until=(now_ms+90000,U64),attempts=(attempts,U64)),True)
            return {"token":token,"attempts":attempts,"lead":dict(leads[0])}
        return self._run(operation)

    def finish(self, request_id, token, now_ms, attempts, message_id=None, failure=None):
        params={"shard":(shard_for(request_id),U32),"id":(request_id,UTF8)}
        def operation(tx):
            rows=self._execute(tx,"SELECT lease_token FROM "+self._table("outbox")+
                " WHERE shard=$shard AND request_id=$id;",params)[0].rows
            if not rows or rows[0].lease_token!=token:
                tx.commit()
                return False
            delivered=message_id is not None
            next_ms=now_ms+min(3600000,30000*2**min(attempts,7))
            self._execute(tx,"UPDATE "+self._table("outbox")+
                " SET state=$state,next_attempt_ms=$next,lease_until_ms=0ul,lease_token='',last_error_code=$error"+
                " WHERE shard=$shard AND request_id=$id;",
                dict(params,state=("sent" if delivered else "pending",UTF8),next=(next_ms,U64),
                     error=("" if delivered else "delivery_unconfirmed",UTF8)))
            if delivered:
                self._execute(tx,"UPDATE "+self._table("leads")+
                    " SET telegram_sent=true,telegram_message_id=$message WHERE request_id=$id;",
                    {"id":(request_id,UTF8),"message":(str(message_id),UTF8)})
            tx.commit()
            return True
        return self._run(operation)
