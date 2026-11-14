# Yandex lead intake — кандидат к проверке, НЕ развёрнут

Ветка: prepare/yandex-leads. Отдельная рабочая копия сайт-yandex-prep.
main и его локальные незакоммиченные файлы сохранены без изменений.
Существующие облачные ресурсы не читались через API и не изменялись; миграции не выполнялись.

Со слов владельца: YDB tochka-learning, Serverless, ru-central1, Running.
Также есть одна Function, один API Gateway и сервисный аккаунт, их назначение не проверено.
Название базы НЕ заменяет её реальный endpoint и полный database path.
Не угадывать ID, ключи, роли и текущее назначение ресурсов.

## Архитектура

Браузер → SmartCaptcha → API Gateway POST /public/lead → Python Cloud Function → YDB.
Одна SerializableReadWrite транзакция сохраняет заявку и запись outbox.
Ответ сохранения возвращается после commit. Отправка Telegram не выполняется в HTTP-запросе.
Таймер запускает ту же функцию: outbox → lease → нужная Telegram-группа → отметка доставки.
В одном ZIP два пути обработки: доверенный HTTP event либо таймер с проверенным trigger_id.
Публичного HTTP-маршрута запуска доставки нет. Вызовы Function должны оставаться приватными через IAM.

Таблицы только нового пространства имён:
- tz_site_leads: request_id — первичный ключ, хеш содержимого, фамилия, согласие,
  серверное время, статус Telegram и поля-заготовки CRM.
- tz_site_outbox: request_id + shard, синхронный индекс due_idx, attempts,
  время следующей попытки, lease_until_ms и lease_token.
- tz_site_rate_limits: HMAC-ключ, минутное окно и счётчик; TTL 24 часа.
Это новые таблицы внутри уже существующей базы, НЕ новая база.
Их создание тоже требует отдельного разрешения и проверки имён/прав.

При одинаковом requestId и содержимом возвращается прежний leadId.
Изменённое содержимое с тем же ID получает 409.
CAPTCHA не входит в хеш и не сохраняется: повтор использует новый одноразовый токен.
Хешированный IP не сохраняется в заявке; ключ ограничения ежедневно меняется.
Начальные технические лимиты: 5 запросов/IP/мин и 100 суммарно/мин;
это параметры кандидата, а не согласованные эксплуатационные нормативы.
Счётчики обновляются атомарно в YDB. Фиксированное окно допускает всплеск на границе минуты.
Защита сети/расходов до функции — отдельный SWS/ARL-профиль после аудита Gateway.
Старые x-yc-apigateway-rate-limit расширения не использовать: документация помечает их устаревшими.

Очередь: до 10 отправок за запуск, timeout Telegram 8с, lease 90с.
Ошибки возвращают запись в pending с нарастающей задержкой до 1 часа.
После падения lease истекает, следующая попытка снова доступна.
Устаревший обработчик не может отметить результат после нового lease.
При подтверждённом message_id отметка telegram_sent и состояние outbox обновляются одной транзакцией.
При неоднозначном ответе Telegram возможен повтор уведомления:
Bot API не даёт идемпотентный sendMessage. В сообщении есть requestId.
Уникальность заявки в YDB и exactly-once Telegram — разные гарантии.
На этапе нагрузочной проверки согласовать размер batch, период таймера и пропускную способность;
следить за backlog, oldest_pending и долей ошибок агрегатами без контактов/текстов.

## Контракт и фронтенд

Все бизнес-поля, schemaVersion=1, маска, валидация, выбранный филиал,
requestId и формат ответа {ok:true,saved:true,requestId,leadId} сохранены.
Единственное изменение поля защиты: turnstileToken заменён на captchaToken.
Turnstile и Cloudflare endpoint исключены из подготовленного клиента.
По умолчанию в site/lead-client.js: enabled:false, endpoint:null, siteKey:''.
Прямой HTTPS endpoint Gateway и публичный ключ SmartCaptcha указываются только после аудита и разрешения.
Серверные ключи браузеру не передаются.

Использованы официальные render/execute/reset/destroy/subscribe SmartCaptcha, invisible=true.
Системный shield оставлен видимым: hideShield=false. Его нельзя прятать без согласованного уведомления.
Во время challenge форма уступает управление клавиатурой окну CAPTCHA.
Фиксация фона и visualViewport остаются существующим контроллером lead-viewport.js.
CSS, размеры и поля формы не изменены.
При сетевой ошибке неизменённые данные сохраняют requestId, включая повторное автозаполнение.
Успех не показывается без подтверждения сохранения.

Серверная SmartCaptcha: POST /validate, x-www-form-urlencoded, status=ok,
host строго соответствует Origin (tzvuka.ru или www.tzvuka.ru).
Пустой host, не-200, сеть, невалидный ответ и просроченный токен отклоняются.
Рекомендованный документацией fail-open при HTTP-ошибке здесь намеренно НЕ используется.
У SmartCaptcha нет Turnstile-полей action/success; выдуманной проверки action нет.
IP берётся только из requestContext.identity.sourceIp, не из клиентских X-Forwarded-For/cf-connecting-ip.
operationContext.route — проверка маршрута, а НЕ замена IAM.
Функция не должна быть доступна allUsers/allAuthenticatedUsers: иначе контекст можно подделать прямым invoke.

## Файлы

- schema.yql — YDB YQL DDL, не SQLite, без автоприменения.
- ydb_store.py — официальный ydb SDK, явные типы, SerializableReadWrite и повтор всей транзакции.
- service.py — контракт, размер/Origin/CORS, SmartCaptcha результат, идемпотентное сохранение, очередь.
- index.py — entrypoint index.handler, metadata credentials, HTTPS, ветвление HTTP/таймер.
- requirements.txt / requirements.lock — SDK 3.35.0 и зафиксированные зависимости.
- environment.example — имена переменных без значений ресурсов/секретов.
- api-gateway.fragment.yaml — фрагмент для объединения, НЕ замена текущей спецификации.
- prepare_schema.py — печатает DDL с выбранным префиксом, никуда не подключается.
- package_function.py — собирает локальный ZIP по allowlist, без .env/ключей/DDL/тестов.
- tests/ — unit + официальная сериализация SDK; отдельные opt-in настоящие YDB проверки.
- ../../scripts/yandex-leads-browser.cjs — только фронтенд с mock SmartCaptcha/API.

## Последовательность после проверки ресурсов

1. Сначала только инвентаризация.
   В консоли проверить folder/cloud ID, назначение Function и все её версии/entrypoints,
   теги, триггеры, переменные по именам, Lockbox-ссылки, IAM и текущий трафик.
   Получить полную спецификацию Gateway, маршруты, домены, авторизацию и SWS.
   Проверить, кто использует сервисный аккаунт и какие у него права.
   Уточнить полный endpoint/path YDB, список таблиц/директорий, ACL и резервирование.
   Не выгружать содержимое заявок/учебных таблиц и секреты.
   Допустимые read-only команды при установленном yc:
   yc serverless function list
   yc serverless api-gateway list
   yc iam service-account list
   yc ydb database list
   Дальше get конкретных ID из инвентаризации; не угадывать их по названию.

2. Принять решение о размещении.
   Если Function/Gateway/SA используются учебным ботом или другим сервисом,
   НЕ заменять их код, runtime, роли или спецификацию.
   Сначала согласовать отдельные ресурсы либо безопасное расширение.
   Наличие одной Function не означает, что она свободна.
   Старый Worker /lead не нужен для нового маршрута, его не изменять.

3. Получить отдельное разрешение на тестовую инфраструктуру/таблицы и конфигурацию.
   Только после него создать SmartCaptcha с разрешёнными доменами, получить публичный ключ.
   Секрет SmartCaptcha, RATE_HMAC_KEY и Telegram token хранить в Lockbox.
   Telegram-получатели задаются сервером, по одному на филиал.
   Функции — metadata credentials привязанного SA с минимумом доступа к ТРЁМ новым таблицам,
   без изменения учебных таблиц; секретам — только чтение нужных версий.
   Gateway/таймеру — право invoke конкретной функции; не открывать прямой публичный invoke.

4. Реальная проверка YDB ДО включения.
   На изолированных согласованных тестовых таблицах применить DDL с префиксом tz_site_test_<суффикс>_.
   Скрипт prepare_schema.py только выводит SQL:
   python backend/yandex-leads/prepare_schema.py --prefix tz_site_test_review_
   Тесты НЕ создают и НЕ удаляют таблицы автоматически.
   После отдельного разрешения и подготовки тестовых таблиц задать:
   YDB_TEST_ENDPOINT, YDB_TEST_DATABASE, YDB_TEST_PREFIX,
   YDB_TEST_ALLOW_WRITES=I_APPROVE_ISOLATED_TEST_TABLES
   Затем:
   python -m unittest discover -s backend/yandex-leads/tests -v
   Проверить конкурентный INSERT, конфликт хеша, типы/индекс/TTL, лимит,
   atomic lead+outbox, восстановление lease, атомарное подтверждение доставки.
   Фикстуры полностью вымышленные; после тестов остаются только в тестовых таблицах.
   Удаление тестовых таблиц — отдельное согласованное действие.
   До этого шага совместимость с движком YDB считается НЕ ПОДТВЕРЖДЁННОЙ.

5. После успешной проверки и разрешения подготовить production-таблицы.
   Только в существующей tochka-learning, после проверки отсутствия конфликтов tz_site_*.
   Не выполнять DROP/REPLACE таблиц, не создавать вторую БД.
   D1 не мигрировать автоматически. Перенос исторических заявок — отдельная задача,
   не требующая сохранения маршрута /lead; не выдумывать фамилии/даты/согласия.

6. Собрать ZIP и выпустить проверенную версию функции без переключения рабочего трафика.
   Runtime Python 3.12, entrypoint index.handler, зависимости из requirements.lock.
   python backend/yandex-leads/package_function.py
   ZIP не содержит секретов. Deployment/выбор Function ID — только после аудита.
   PUBLIC_LEADS_ENABLED=false, DELIVERY_ENABLED=false.
   Добавить фрагмент /public/lead в согласованный Gateway, сохранить все прежние маршруты.
   Использовать тег проверенной версии leads-candidate, не $latest.
   Проверить, что формат event 0.1 даёт identity.sourceIp и operationContext.
   Для edge-защиты согласовать SWS/ARL, оценив влияние на ВСЕ маршруты Gateway.

7. Тесты перед включением: отдельное разрешение на тестовый приём и сообщения.
   Реальный SmartCaptcha, обе школы, одна строка на requestId, сохранение при отказе Telegram,
   периодический повтор, отсутствие секретов/персональных данных в логах.
   Новый timer с согласованным расписанием и его точный ID внести в DELIVERY_TRIGGER_ID;
   существующие триггеры не менять. Доставка остаётся выключенной до согласованного теста.
   Проверить challenge, shield, отмену, сеть и форму на физическом iPhone.
   Локальный WebKit не заменяет реальную клавиатуру/SmartCaptcha.

8. Отдельно согласовать включение и публикацию фронтенда.
   Только тогда переключать флаги, публичный ключ и endpoint.
   Не push/merge в main до разрешения: его Pages workflow автоматически публикует сайт.
   План отката: отключить PUBLIC_LEADS_ENABLED/DELIVERY_ENABLED и клиент,
   вернуть тег проверенной версии; данные и outbox не удалять.

Перед реальными данными требуется юридическая проверка согласия, локализации,
сроков хранения и передачи в Telegram. Российское основное хранилище само по себе
не решает все вопросы обработки/трансграничной передачи.
Юридическое заключение не выполнялось.

## Выполненные и невыполненные проверки

Unit/SDK: python -m unittest discover -s backend/yandex-leads/tests -v
JavaScript/site: команды из .github/workflows/pages.yml + scripts/check_site.py.
Браузеры: node scripts/yandex-leads-browser.cjs (Playwright Chrome/WebKit).
TZ_PLAYWRIGHT_MODULE можно указать для уже установленного модуля.
Все внешние запросы в browser test перехватываются; SQLite нигде не используется.

Настоящий YDB, реальная SmartCaptcha, облачные IAM/триггеры/Gateway/Lockbox,
Telegram-группы и физический iPhone пока НЕ проверены.
Не считать mock/SDK serialization доказательством выполнения YQL или конкурентных гарантий сервера.

## Официальные источники

https://ydb-platform.github.io/ydb-python-sdk/quickstart.html
https://ydb-platform.github.io/ydb-python-sdk/apireference.html
https://yandex.cloud/en/docs/smartcaptcha/concepts/validation
https://yandex.cloud/en/docs/smartcaptcha/concepts/widget-methods
https://yandex.cloud/en/docs/api-gateway/concepts/extensions/cloud-functions
https://yandex.cloud/en/docs/api-gateway/concepts/extensions/sws
https://yandex.cloud/en/docs/api-gateway/concepts/extensions/rate-limit
https://yandex.cloud/en/docs/functions/lang/python/handler
