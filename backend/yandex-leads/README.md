# Backend заявок

Рабочие модули: index.py, service.py, bulk_store.py.
Нативный BulkUpsert с подтверждением ReadRows, затем Telegram выбранного филиала.
Отметки доставки хранятся в leads по ключам sent:<receipt>; индексированная outbox не используется.

- [Результаты облачной проверки](release/LAUNCH-RESULT.local.md).
- [Инструкция и ограничения MVP](release/BULK-MVP.md).
- [Подготовленная публикация сайта](release/WEBSITE-PUBLICATION.md).

Сборка: `python package_function.py`. Эта команда только создаёт ZIP.
Старые Document API и YQL-адаптеры в ZIP не входят.
