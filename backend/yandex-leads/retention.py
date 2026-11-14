"""Retention events are independent of Telegram retries and technical writes."""
from datetime import datetime, timezone


def three_years_after(milliseconds):
    value = datetime.fromtimestamp(milliseconds / 1000, timezone.utc)
    try:
        deadline = value.replace(year=value.year + 3)
    except ValueError:  # February 29: last day of that month, not an extra day.
        deadline = value.replace(year=value.year + 3, day=28)
    return int(deadline.timestamp() * 1000)


META_TEXT = ('legal_basis', 'processing_purpose', 'basis_policy_version',
             'notice_version', 'legacy_consent_status', 'retention_reason')
META_NUMBER = ('received_at_ms', 'request_schema_version', 'retention_anchor_ms',
               'retention_due_ms', 'purge_at_ms')


def evidence(data, now_ms):
    version = data['schemaVersion']
    return dict(legal_basis='152-FZ:6:1:5', processing_purpose='trial_lesson_request',
                basis_policy_version='trial-lesson-2026-11-14',
                notice_version=data.get('privacyNoticeVersion', ''),
                legacy_consent_status='legacy_unverified' if version == 1 else 'not_applicable',
                received_at_ms=now_ms, request_schema_version=version,
                retention_anchor_ms=now_ms, retention_due_ms=three_years_after(now_ms),
                retention_reason='received', purge_at_ms=three_years_after(now_ms))
