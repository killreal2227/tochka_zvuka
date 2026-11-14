# Prepared website publication - separate approval required

The local candidate loads site/lead-config.js before lead-client.js on home,
Kaluga and Troitsk. Both source templates and generated pages are updated;
build_site.py includes the new configuration in cache-busting. The client waits
65 seconds for the 60-second function. No design/keyboard/modal changes.

API: https://d5d2psrdhd0snl30t7b0.zj2i1qoy.apigw.yandexcloud.net/leads
Function tag: bulk-telegram-r3-20261114 (never use $latest diagnostic versions).
The prepared client is enabled locally; the published website is unchanged and
backend PUBLIC_LEADS_ENABLED remains false, so public requests cannot save leads.

After separate approval:
1. Publish a main index.handler version with PUBLIC_LEADS_ENABLED=true,
   DELIVERY_ENABLED=true, TELEGRAM_CONNECT_IPV4=149.154.167.220, same DB and
   approved Lockbox version. Preserve all existing named diagnostic tags.
2. Point the leads Gateway at that explicit approved version tag.
3. Publish the prepared site files and cache versions; no Cloudflare Worker/DNS change.
4. Verify positive SmartCaptcha and one synthetic form submission in a browser,
   mobile keyboard/modal operation, branch routing, YDB persistence and Telegram.
5. If the check fails, disable public intake and revert the website configuration;
   retain the old Cloudflare Worker for rollback. Never expose a server secret.

SmartCaptcha already permits tzvuka.ru and www.tzvuka.ru (and localhost for testing).
The current application permits canonical Origin https://tzvuka.ru; www must redirect
there before form use. Do not publish a second Origin without checking the contract.
Existing tz_site_test_20261114_leads is the only approved table namespace in code;
this MVP reuses it. Exclude sent: service-marker rows from application exports.
Before real personal data, complete legal/privacy/localization review.
No guaranteed delivery or automatic background retry is claimed.
