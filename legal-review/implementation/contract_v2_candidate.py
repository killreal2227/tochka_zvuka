"""Offline review candidate; not imported by the deployed function.

Requires the existing backend/yandex-leads/service.py on sys.path.
No persistence, network calls, secrets, or consent fabrication.
"""
import hashlib
import json
import re
import uuid

import service as legacy

V2_FIELDS = (legacy.FIELDS - {"consent"}) | {"privacyNoticeVersion"}


def valid(data, origin, now_ms, notice_versions):
    if not isinstance(data, dict):
        return False
    if type(data.get("schemaVersion")) is not int:
        return False
    if data["schemaVersion"] == 1:
        try:
            return legacy.valid(data, origin, now_ms)
        except (TypeError, ValueError):
            return False
    if data["schemaVersion"] != 2 or set(data) != V2_FIELDS:
        return False
    try:
        request_id = uuid.UUID(data["requestId"])
        id_ok = request_id.version == 4 and str(request_id) == data["requestId"]
    except (ValueError, TypeError, AttributeError):
        return False
    branch = data["branch"]
    notice = data["privacyNoticeVersion"]
    return bool(
        origin in legacy.ORIGINS
        and id_ok
        and legacy.timestamp(data["createdAt"], now_ms)
        and legacy.person(data["name"])
        and (data["surname"] == "" or legacy.person(data["surname"]))
        and isinstance(data["phone"], str)
        and re.fullmatch(r"\+7\d{10}", data["phone"], re.ASCII)
        and isinstance(branch, str) and branch in legacy.BRANCHES
        and isinstance(data["direction"], str)
        and data["direction"] in legacy.DIRECTIONS
        and data["website"] == ""
        and data["pagePath"] in ("/", "/" + branch + "/")
        and isinstance(data["captchaToken"], str)
        and 0 < len(data["captchaToken"]) <= 8192
        and isinstance(notice, str) and notice in notice_versions
    )


def prepare(data, origin, now_ms, notice_versions, basis_policy_version):
    """Call after independent server CAPTCHA verification and purpose approval.

    Returns data for an adapter, not a save acknowledgement.
    received_attempt_at_ms is deliberately NOT a first-received guarantee.
    """
    if not valid(data, origin, now_ms, notice_versions):
        raise ValueError("invalid_request")
    if not isinstance(basis_policy_version, str) or not basis_policy_version.strip():
        raise ValueError("basis_policy_version_required")
    business = {key: value for key, value in data.items() if key != "captchaToken"}
    canonical = json.dumps(business, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    version = data["schemaVersion"]
    notice = data.get("privacyNoticeVersion")
    # The mapping is supplied by approved server configuration, never the client.
    metadata = {
        "processing_purpose": "trial_lesson_request",
        "legal_basis": "152-FZ:6:1:5",
        "basis_policy_version": basis_policy_version,
        "received_attempt_at_ms": now_ms,
        "request_schema_version": version,
        "notice_version": notice if version == 2 else "",
        "notice_url": notice_versions[notice] if version == 2 else data["consent"]["privacyUrl"],
        "legacy_consent_status": "legacy_unverified" if version == 1 else "not_applicable",
    }
    # A JSON round-trip separates the returned package from mutable pending input.
    return {
        "business": json.loads(canonical),
        "digest": digest,
        "receipt": data["requestId"] + ":" + digest,
        "metadata": metadata,
    }
