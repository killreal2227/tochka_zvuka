# Ручной тестовый запуск — только после отдельного разрешения

Сейчас: offline-кандидат. Deploy, миграции, push, реальные заявки и Telegram не выполнялись.
Источник сведений: C:/Users/stepk/Documents/tochka-leads-infra-backup/docs/yandex-leads-infra.
Факты ресурсов в аудите сообщены владельцем, не подтверждены cloud API.
Изменение к плану: выбран Python 3.12, а не предложенный Node.js 22. Портирования на Node нет.

1. Подтвердить ресурсные ID: именно БД tochka-leads в ru-central1 и функцию tochka-leads-api.
   Заполнить null/placeholder поля manifest.json. Никаких ссылок на tochka-learning.
   Сверить фактические IAM/ACL: runtime SA только leads DB/нужные Lockbox secrets;
   Gateway invoker — functions.functionInvoker только на выбранную Function.
   Прямой публичный invoke Function закрыт. Строка operationContext не заменяет IAM.
2. Подтвердить Python runtime. Для ZIP нужна новая согласованная версия python312,
   entrypoint index.handler. Node.js 22 этот ZIP не исполнит.
   Проверить SDK/холодный запуск на тестовом контуре и выбрать timeout, не копировать
   предложение 10 секунд без проверки: есть вызов CAPTCHA, YDB и повторы транзакций.
3. После отдельного разрешения на таблицы: выполнить schema.yql только в согласованной
   изолированной тестовой области leads DB. Сначала проверить отсутствие конфликтов имён.
   Требуются реальные проверки YQL, индекса, TTL, конкурентных save и lease.
   Unit-тесты/кодек SDK не подтверждают исполнение на движке YDB.
   test_ydb_integration.py запускается отдельно с явным разрешением на запись и test prefix;
   никакие таблицы он автоматически не создаёт и не удаляет.
4. Проверить SHA256SUMS и ZIP (index.py, service.py, ydb_store.py, requirements.txt).
   Указать YDB_DATABASE_LABEL=tochka-leads, реальную пару YDB_ENDPOINT (grpcs) / YDB_DATABASE,
   правильный тестовый префикс. Секрет SmartCaptcha и RATE_HMAC_KEY — из конкретных версий Lockbox.
   Флаги PUBLIC_LEADS_ENABLED=false, DELIVERY_ENABLED=false. Telegram secret для intake не нужен.
5. После разрешения выпустить приватную тестовую версию, закрепить одобренный тег.
   В release/api-gateway.openapi.json заполнить ID/tag/SWS, сохранить существующие маршруты:
   файл — проект для слияния, не разрешение заменить текущий Gateway.
   POST /leads, payload 1.0, context.route=website-leads-v1 обязательны.
   OPTIONS обрабатывает Gateway; backend возвращает CORS на фактических ответах.
   Проверить блокирующие SWS/ARL-правила, квоты, billing и получение безопасной телеметрии.
   Не подключать необследованное логирование тел/секретов. Не оставлять $latest.
6. Только после отдельного допуска тестового приёма: включить intake на изолированном стенде,
   использовать исключительно вымышленные данные, проверить реальный SmartCaptcha и YDB.
   Проверить повторы requestId, 409 при другом содержимом, отказ CAPTCHA/БД и CORS.
   DELIVERY_ENABLED оставить false: из outbox ничего не отправляется.
7. До production остаются: подтверждение IAM/изоляции и работающего наблюдения,
   реальные YDB/Gateway/SmartCaptcha испытания, отдельный допуск Telegram, проверка iPhone
   и юридическое решение по ПДн/передаче в Telegram. Frontend сейчас не переключать.
   Откат: выключить intake, сохранить заявки/outbox; не включать автоматически старый backend.

Ни один шаг изменения ресурсов этим документом или сборщиком автоматически не выполняется.
