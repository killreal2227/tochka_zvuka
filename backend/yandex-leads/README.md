# Backend заявок: тестовый кандидат
Актуальная цель по инфраструктурному плану: **tochka-leads**, не tochka-learning.
Старая инструкция подготовки с использованием базы учебного бота отменена.
Порядок ручного запуска и оставшиеся блокеры: [release/MANUAL.md](release/MANUAL.md).

- Python 3.12, entrypoint index.handler; ZIP не работает в Node.js 22.
- Публичный маршрут /leads, Gateway payload 1.0, canonical Origin https://tzvuka.ru.
- Сохранены бизнес-поля, captchaToken, ответ {ok:true,saved:true,requestId,leadId}.
- YDB SDK 3.35.0; SerializableReadWrite; атомарная заявка + outbox.
- SmartCaptcha проверяется сервером; пустой/неверный host и сетевой сбой отклоняются.
- PUBLIC_LEADS_ENABLED=false и DELIVERY_ENABLED=false.
- Runtime требует YDB_DATABASE_LABEL=tochka-leads и TLS endpoint; label не доказывает фактическую идентичность БД — сверять ID/path.
- Ресурсы, реальные YQL-транзакции, Gateway, IAM и CAPTCHA в облаке не проверены.
- Telegram-доставка до отдельной проверки retry_after/attention и операционного допуска остаётся выключенной.
- schema.yql не запускался; никаких автоматических миграций или совместимости со старым /lead не требуется.

Сборка: python backend/yandex-leads/package_function.py
Артефакты: release/function-python312.zip, manifest.json, SHA256SUMS,
api-gateway.openapi.json, environment.example и ../schema.yql.
ZIP содержит только код и зависимости, без секретов.
