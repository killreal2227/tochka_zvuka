# Verified backend launch (website not published)

Function: tochka-leads-api / d4ep7jlje5la3g8ohd70
Verified version: d4eabvvatt4s66eu3l6e
Named tag: bulk-telegram-r3-20261114
Lockbox: all five keys pinned to current approved version e6qgsu2vsjngmj83qal1.
Gateway: https://d5d2psrdhd0snl30t7b0.zj2i1qoy.apigw.yandexcloud.net/leads

Kaluga and Troitsk synthetic applications were saved and read back from YDB.
The Cloud Function delivered one notification for each application.
Existing messages were labelled SYNTHETIC TEST; Telegram editMessageText responses
confirmed the expected chat ID and application receipt for each branch.
The YDB sent markers were independently read and verified. Repeated invocation
of each receipt acknowledged the existing marker without sending another message.

Two release-blocking issues were fixed:
- YDB ReadRows returns 400070 for indexed outbox: sent markers now use reserved
  sent:<receipt> keys in the existing unindexed leads table. No schema change.
- The DNS-provided Telegram address times out from Cloud Functions. The verified
  alternative address 149.154.167.220 works with normal api.telegram.org SNI and
  certificate verification. No proxy, TLS bypass or new delivery service.

SmartCaptcha allows localhost, tzvuka.ru and www.tzvuka.ru. Invalid-token rejection
was verified. A positive browser token/form submission remains a publication check.
Public intake remains disabled. Gateway returns 503 disabled for the site Origin;
foreign Origin returns 403. IAM-private function invocation remains required.
The diagnostic versions are not referenced by Gateway; it uses the named main tag.

Local site configuration is prepared on home/Kaluga/Troitsk. Nothing pushed,
merged or published. Cloudflare, DNS, main and learning resources were not changed.
Only a dedicated necessary leads Gateway was created; existing function versions
and the existing DB/SmartCaptcha were used. No new database or runtime SA.

Remaining: separate approval to enable HTTP intake and publish the website,
then a real-browser synthetic form submission (including positive SmartCaptcha).
MVP limitations remain: duplicate notifications after ambiguous results are possible;
no autonomous background retry. Production privacy/localization review is required.

Evidence (no secrets): LAUNCH-VERIFIED.json. Offline tests: 25 backend + 5 client passed.
