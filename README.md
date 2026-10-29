# Точка звука — сайт школы музыки

Одностраничный статический сайт: один `site/index.html` (HTML + CSS + JS без фреймворков и сборки), шрифт, иконки и паттерны рядом.

```
site/
  index.html     — вся страница: разметка, стили, скрипты
  favicon.svg
  fonts/         — Architexture-v2.ttf
  icons/         — иконки направлений
  img/           — фирменные паттерны
```

## Запуск локально

Сборки нет — достаточно любого статического сервера:

```
cd site
python -m http.server 8000
```

и открыть http://localhost:8000.

## Деплой

`.github/workflows/pages.yml` публикует папку `site/` на GitHub Pages при пуше в `main`.
Один раз включить: **Settings → Pages → Source: GitHub Actions**.
Адрес по умолчанию: `https://killreal2227.github.io/tochka_zvuka/`.
Свой домен — там же, в поле **Custom domain** (плюс DNS-запись у регистратора).

Подойдёт и любой другой статический хостинг (Netlify, Vercel, Яндекс Object Storage и т. п.) — корнем сайта указать `site/`.

## Заявки с формы

Все настройки — в объекте `CONFIG` в начале `<script>` в `site/index.html`.

- `leadEndpoint: null` — **демо-режим**: заявка выводится только в консоль браузера и никуда не отправляется, посетитель видит пометку «демо».
- Чтобы заявки доходили, укажите URL, принимающий `POST` с JSON:
  `{ name, phone, direction, directionLabel, branch, branchLabel, page, createdAt, utm_* }`.
  Это может быть свой backend, вебхук CRM или сервис форм.

Филиалы и их адреса — `CONFIG.branches`, направления — `CONFIG.directions`.
