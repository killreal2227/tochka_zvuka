# Постоянные перенаправления юридических URL

Единственная полная страница: https://tzvuka.ru/documents/

| Старые пути | Новый раздел |
| --- | --- |
| /privacy, /privacy/, /privacy.html, /privacy/index.html | /documents/#privacy |
| /consent, /consent/, /consent.html, /consent/index.html | /documents/#consent |
| /details, /details/, /details.html, /details/index.html | /documents/#details |
| /requisites, /requisites/, /requisites.html, /requisites/index.html | /documents/#details |

GitHub Pages не исполняет Worker и не поддерживает пользовательские HTTP-редиректы из _redirects.
До активации Cloudflare в старых HTML остаётся только мгновенный переход и резервная ссылка, без копий текстов.
Это резерв браузера, а не HTTP 301.

## Активация на Cloudflare

Из корня репозитория сайта в учётной записи, управляющей зоной tzvuka.ru:

```powershell
npx wrangler@4 login
npx wrangler@4 deploy --config routing/wrangler.toml
```

Отдельный Worker обслуживает только префиксы старых юридических URL на tzvuka.ru и www.tzvuka.ru.
Существующий Worker Telegram, маршруты заявок и DNS-origin сайта не изменяются.
Для домена должна сохраняться текущая проксируемая DNS-запись Cloudflare.
Код пропускает прочие пути без перенаправления.

После применения проверить реальный ответ, а не только конечную страницу:

```powershell
curl.exe -I https://tzvuka.ru/privacy
curl.exe -I https://tzvuka.ru/consent.html
curl.exe -I https://tzvuka.ru/requisites/
curl.exe -I https://tzvuka.ru/details
```

Ожидается HTTP 301 и Location с нужным якорем. Автоматические проверки: node --test routing/legal-redirects.test.mjs.
