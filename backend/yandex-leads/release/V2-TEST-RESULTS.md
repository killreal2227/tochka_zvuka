# Проверки реализации v2

Все результаты локальные. Облачные записи, миграции, реальные CAPTCHA-токены и сообщения в рабочие Telegram-группы не выполнялись.

- Python: **86 тестов, 80 прошли, 6 cloud/live пропущены**. Включены действующие проверки и новые v1/v2, оба филиала, пустая/заполненная фамилия, строгие поля, ошибки CAPTCHA, YDB и Telegram, повтор после неопределённого исхода, стабильность серверных метаданных/срока, удаление и его частичный исход, stale/oversized plan, maintenance/drain, минимальный журнал, миграция и release ZIP.
- Дополнительно сохранённая review-заготовка: **13 тестов прошли**.
- Обязательный Node-набор существующего CI: **97 тестов прошли**.
- Статическая сборка, ссылки, юридические URL, синтаксис JS: **прошли**.
- Реальный локальный Chrome и WebKit: **12 профилей**, ширины 320, 390, 430, 768, 1024, 1440 px. Калуга/Троицк, пустая фамилия на мобильном, заполненная на desktop, v2 без consent, double submit, первая потерянная сетевая попытка и тот же requestId, один mock lead, успешное окно, автокапитализация, visualViewport/поле/крестик, внутренний скролл и восстановление фоновой позиции. Все запросы перехвачены; SmartCaptcha/API заменены заглушками. Это не проверка на физическом iPhone.
- Показано разделение очистки и физического уничтожения: пока есть payload или временный replay-guard, `check` не возвращает финальный успех. Поведение TTL моделировалось, не выдаётся за выполненное удаление в облаке.
- Официальный установленный YDB SDK сериализует реальные BulkUpsert protobuf для новой и очищенной строки; nullable-типы и TTL enum проверены. Это не заменяет smoke реального YDB.

## Воспроизводимые команды

```text
pip install -r backend/yandex-leads/requirements-admin.txt
python -m unittest discover -s backend/yandex-leads/tests -v
python scripts/build_site.py
python scripts/check_site.py
node --test scripts/home-regression.test.mjs scripts/city-interactions.test.mjs backend/leads.test.mjs routing/legal-redirects.test.mjs scripts/scroll-reveal.test.mjs scripts/lead-viewport.test.mjs scripts/lead-client.test.mjs scripts/branch-picker.test.mjs
node scripts/yandex-leads-browser.cjs
```

Для браузерной проверки нужен локальный Playwright с Chrome/WebKit; путь к модулю при необходимости задаётся `TZ_PLAYWRIGHT_MODULE`. Обычный запуск скрипта не обращается к внешним API.

## Что проверяется только после разрешения на облачные операции

Добавлен отдельный `tests/test_v2_native_live.py`, выключенный по умолчанию. После согласованной миграции и разрешения на **четыре синтетические записи** в существующей tochka-leads оператор устанавливает `TZ_V2_NATIVE_WRITE_APPROVED=etntmjbnguvsu5l8bv3s:four-synthetic` и запускает только этот тест. Он использует существующий yc/IAM, проверяет реальный native save/read/retry v1/v2 обеих школ, не вызывает Telegram и не фабрикует успешные sent:-маркеры. Это тест хранения, не живой SmartCaptcha. Он оставляет четыре ясно помеченные synthetic-записи для последующего согласованного удаления.

Приватный smoke функции/настоящей SmartCaptcha и фактическое TTL-удаление выполняются отдельно по разрешению, без тестовых сообщений рабочим группам. Не включать live-флаги в CI. До этих проверок облачная совместимость новой миграции/TTL не объявляется подтверждённой.
