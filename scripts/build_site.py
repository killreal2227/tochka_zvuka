"""Build the static website from shared templates. No dependencies."""
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

def read(name):
    return (ROOT / 'templates' / name).read_text(encoding='utf-8')

def compose(page, root):
    for part, filename in [('footer', 'footer.html'), ('dialog', 'lead-dialog.html')]:
        page = page.replace('{{' + part + '}}', read(filename).replace('{{root}}', root))
    return page

def build():
    template = read('city.html')
    for slug, city in CITIES.items():
        page = compose(template, '../')
        for key, value in dict(city, slug=slug).items():
            page = page.replace('{{' + key + '}}', escape(value))
        write(SITE / slug / 'index.html', page)
    logo = re.search(r'<body[^>]*>\s*(<svg.*?</svg>)', template, re.S)[1]
    home = compose(read('home.html').replace('{{logo}}', logo), './')
    write(SITE / 'index.html', home)
    for name in ('privacy', 'consent'):
        write(SITE / f'{name}.html', f'<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Точка звука — переход к документу</title><link rel="canonical" href="https://tzvuka.ru/{name}/"><meta http-equiv="refresh" content="0;url={name}/"></head><body><a href="{name}/">Перейти к актуальной редакции документа</a></body></html>\n')
    urls = ['', 'troitsk/', 'kaluga/', 'privacy/', 'consent/']
    write(SITE / 'sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + ''.join(f'<url><loc>https://tzvuka.ru/{url}</loc></url>' for url in urls) + '</urlset>\n')
    write(SITE / 'robots.txt', 'User-agent: *\nAllow: /\nSitemap: https://tzvuka.ru/sitemap.xml\n')
    print('Built home, city pages and shared footer/form.')

if __name__ == '__main__':
    build()
