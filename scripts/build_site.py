"""Build the static city pages from a shared template. No dependencies."""
from pathlib import Path
import re
from html import escape

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
CITIES = {
    'troitsk': dict(name='Троицк', loc='Троицке', address='3-я Нововатутинская, 2', full='г. Троицк, ул. 3-я Нововатутинская, д. 2'),
    'kaluga': dict(name='Калуга', loc='Калуге', address='Ленина, 79', full='г. Калуга, ул. Ленина, д. 79'),
}

def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')

def build():
    template = (ROOT / 'templates/city.html').read_text(encoding='utf-8')
    for slug, city in CITIES.items():
        page = template
        for key, value in dict(city, slug=slug).items():
            page = page.replace('{{' + key + '}}', escape(value))
        write(SITE / slug / 'index.html', page)
    # The city template also supplies the existing brand font and logo.
    css = re.search(r'<style>(.*?)</style>', template, re.S)[1]
    logo = re.search(r'<body[^>]*>\s*(<svg.*?</svg>)', template, re.S)[1]
    home = f'''<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Точка звука — музыка и сцена в Троицке и Калуге</title>
<meta name="description" content="Выбери своё пространство Точки звука: Троицк или Калуга. Музыка, сцена и люди, с которыми хочется пробовать новое.">
<meta name="theme-color" content="#FFF5EA"><link rel="canonical" href="https://tzvuka.ru/">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<meta property="og:title" content="Точка звука — Троицк и Калуга"><meta property="og:type" content="website">
<meta property="og:url" content="https://tzvuka.ru/"><meta property="og:description" content="Музыка, сцена и твой город. Выбери пространство рядом.">
<style>{css.replace('../fonts/', 'fonts/').replace('../patterns/', 'patterns/')}
.home{{min-height:100svh;display:flex;flex-direction:column}}
.home .top{{position:relative;background:var(--cream)}}
.home-main{{width:100%;max-width:1480px;margin:auto;padding:48px var(--gutter) 64px}}
.home-main h1{{font-size:clamp(48px,7.7vw,112px);line-height:1.03;letter-spacing:-.055em;margin:20px 0 24px;max-width:11em}}
.home-main h1 em{{font-style:normal;color:var(--bord)}}
.home-intro{{font-size:clamp(18px,2vw,24px);max-width:30em;margin-bottom:40px}}
.cities{{display:grid;grid-template-columns:1fr 1fr;gap:24px}}
.city-card{{position:relative;padding:32px;border:2px solid var(--ink);border-radius:28px;min-height:240px;display:flex;flex-direction:column;align-items:flex-start;transition:transform .2s,box-shadow .2s}}
.city-card:first-child{{background:var(--piano)}}.city-card:last-child{{background:var(--vocal)}}
.city-card:hover{{transform:translateY(-4px);box-shadow:6px 6px 0 var(--bord)}}
.city-card h2{{font-size:clamp(40px,5vw,64px);letter-spacing:-.04em;line-height:1.1;margin:0 0 16px}}
.city-card p{{font-size:18px;margin-bottom:30px}}.city-card .enter{{margin-top:auto;border-bottom:1px solid;line-height:1.5}}
.home-footer{{padding:24px var(--gutter);border-top:1px solid rgba(26,26,26,.2);display:flex;flex-wrap:wrap;gap:12px 28px;font-size:14px}}
.home .header-phone{{font-size:16px}}.home .brand{{max-width:52vw}}
@media(max-width:680px){{.cities{{grid-template-columns:1fr}}.city-card{{min-height:210px;padding:26px}}.home-main{{padding-top:24px}}.home .header-phone{{font-size:13px}}}}
</style></head><body class="home">{logo}
<header class="top"><a class="brand" href="./" aria-label="Точка звука — на главную"><svg><use href="#logo-full"/></svg></a><a class="header-phone" href="tel:+79957907670">+7 995 790-76-70</a></header>
<main class="home-main"><span class="kicker">музыка · сцена · люди</span><h1>твоя точка.<br><em>в твоём городе.</em></h1>
<p class="home-intro">Место, где можно начать с нуля, найти свой звук и выйти на сцену. Выбери, где будем знакомиться.</p>
<nav class="cities" aria-label="Выбрать город">
<a class="city-card" href="troitsk/"><h2>Троицк</h2><p>ул. 3-я Нововатутинская, 2</p><span class="enter">В пространство Троицка ↗</span></a>
<a class="city-card" href="kaluga/"><h2>Калуга</h2><p>ул. Ленина, 79</p><span class="enter">В пространство Калуги ↗</span></a>
</nav></main>
<footer class="home-footer"><span>© 2026 Точка звука</span><a href="mailto:tzvuka@yandex.ru">tzvuka@yandex.ru</a><a href="privacy/">Политика обработки данных</a><a href="consent/">Согласие на обработку данных</a><span>ИП Степанов Кирилл Алексеевич · ИНН 732595555858 · ОГРНИП 326774600083329</span></footer>
<script>if(location.hash==='#kaluga'||location.hash==='#troitsk')location.replace(location.hash.slice(1)+'/'+location.search);</script>
</body></html>'''
    write(SITE / 'index.html', home)
    for name in ('privacy', 'consent'):
        write(SITE / f'{name}.html', f'<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Точка звука — переход к документу</title><link rel="canonical" href="https://tzvuka.ru/{name}/"><meta http-equiv="refresh" content="0;url={name}/"></head><body><a href="{name}/">Перейти к актуальной редакции документа</a></body></html>\n')
    urls = ['', 'troitsk/', 'kaluga/', 'privacy/', 'consent/']
    write(SITE / 'sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + ''.join(f'<url><loc>https://tzvuka.ru/{url}</loc></url>' for url in urls) + '</urlset>\n')
    write(SITE / 'robots.txt', 'User-agent: *\nAllow: /\nSitemap: https://tzvuka.ru/sitemap.xml\n')
    print('Built home and two city pages.')

if __name__ == '__main__':
    build()
