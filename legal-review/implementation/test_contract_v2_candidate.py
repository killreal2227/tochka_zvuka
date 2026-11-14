"""Narrow offline checks; no cloud, SQLite, Telegram, or real contacts."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend" / "yandex-leads"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import service
from contract_v2_candidate import prepare, valid

NOW = 1800000000000
STAMP = "2027-01-15T08:00:00.000Z"
# Generate the timestamp from the fixture clock; it is not a real lead.
from datetime import datetime, timezone
STAMP = datetime.fromtimestamp(NOW / 1000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
ORIGIN = "https://tzvuka.ru"
NOTICES = {"fixture-notice-v2": ORIGIN + "/documents/#privacy"}


def payload(version=2):
    data = {
        "schemaVersion": version,
        "requestId": "31ed708f-b76c-4f5b-95bb-67eefb5b5ec4",
        "createdAt": STAMP,
        "name": "Synthetic",
        "surname": "",
        "phone": "+79990000000",
        "branch": "kaluga",
        "direction": "vocal",
        "website": "",
        "pagePath": "/kaluga/",
        "captchaToken": "fixture-token",
    }
    if version == 1:
        data["surname"] = "Fixture"
        data["consent"] = {
            "accepted": True,
            "acceptedAt": STAMP,
            "version": "2026-11-10-v3",
            "documentUrl": ORIGIN + "/documents/#consent",
            "privacyUrl": ORIGIN + "/documents/#privacy",
        }
    else:
        data["privacyNoticeVersion"] = "fixture-notice-v2"
    return data


class ContractCandidateTests(unittest.TestCase):
    def prepare(self, data, now=NOW):
        return prepare(data, ORIGIN, now, NOTICES, "fixture-purpose-matrix")

    def test_v1_validator_and_exact_digest_unchanged(self):
        data = payload(1)
        self.assertTrue(service.valid(data, ORIGIN, NOW))
        self.assertTrue(valid(data, ORIGIN, NOW, NOTICES))
        old = {k: v for k, v in data.items() if k != "captchaToken"}
        digest = hashlib.sha256(json.dumps(old, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
        result = self.prepare(data)
        self.assertEqual(result["digest"], digest)
        self.assertEqual(result["receipt"], data["requestId"] + ":" + digest)
        self.assertEqual(result["metadata"]["legacy_consent_status"], "legacy_unverified")

    def test_v2_empty_surname_without_consent(self):
        result = self.prepare(payload())
        self.assertEqual(result["business"]["surname"], "")
        self.assertNotIn("consent", result["business"])
        self.assertEqual(result["metadata"]["legal_basis"], "152-FZ:6:1:5")
        self.assertEqual(result["metadata"]["legacy_consent_status"], "not_applicable")

    def test_v2_filled_surname(self):
        data = payload()
        data["surname"] = "Fixture"
        self.assertTrue(valid(data, ORIGIN, NOW, NOTICES))

    def test_v1_still_requires_surname(self):
        data = payload(1)
        data["surname"] = ""
        self.assertFalse(valid(data, ORIGIN, NOW, NOTICES))

    def test_unknown_fields_and_fake_consent_rejected(self):
        for key, value in [("consent", {"accepted": True}), ("legalBasis", "anything"), ("advertising", True)]:
            data = payload()
            data[key] = value
            self.assertFalse(valid(data, ORIGIN, NOW, NOTICES))

    def test_captcha_and_server_time_do_not_change_receipt(self):
        data = payload()
        before = self.prepare(data)
        data["captchaToken"] = "new-fixture-token"
        after = self.prepare(data, NOW + 1)
        self.assertEqual(before["receipt"], after["receipt"])
        self.assertNotEqual(before["metadata"]["received_attempt_at_ms"], after["metadata"]["received_attempt_at_ms"])

    def test_input_not_mutated_or_aliased(self):
        data = payload(1)
        before = copy.deepcopy(data)
        result = self.prepare(data)
        result["business"]["consent"]["version"] = "changed"
        self.assertEqual(data, before)

    def test_changed_business_keeps_existing_versioned_semantics(self):
        data = payload()
        before = self.prepare(data)
        data["direction"] = "guitar"
        self.assertNotEqual(before["receipt"], self.prepare(data)["receipt"])

    def test_unknown_notice_and_schema_rejected(self):
        for key, value in [("privacyNoticeVersion", "unpublished"), ("schemaVersion", 3), ("schemaVersion", True)]:
            data = payload()
            data[key] = value
            self.assertFalse(valid(data, ORIGIN, NOW, NOTICES))

    def test_captcha_and_person_validation(self):
        for key, value in [("captchaToken", ""), ("surname", "X"), ("phone", "+123"), ("surname", None)]:
            data = payload()
            data[key] = value
            self.assertFalse(valid(data, ORIGIN, NOW, NOTICES))

    def test_both_branches_and_path_mismatch(self):
        for branch in service.BRANCHES:
            data = payload()
            data["branch"] = branch
            data["pagePath"] = "/" + branch + "/"
            self.assertTrue(valid(data, ORIGIN, NOW, NOTICES))
        data["pagePath"] = "/kaluga/" if branch == "troitsk" else "/troitsk/"
        self.assertFalse(valid(data, ORIGIN, NOW, NOTICES))

    def test_time_bounds_and_unapproved_origin(self):
        self.assertTrue(valid(payload(), ORIGIN, NOW + 86400000, NOTICES))
        self.assertFalse(valid(payload(), ORIGIN, NOW + 86400001, NOTICES))
        self.assertFalse(valid(payload(), "https://evil.example", NOW, NOTICES))

    def test_purpose_matrix_required(self):
        with self.assertRaises(ValueError):
            prepare(payload(), ORIGIN, NOW, NOTICES, "")


if __name__ == "__main__":
    unittest.main()
