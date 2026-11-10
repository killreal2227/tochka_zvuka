"""Build the static website from shared templates. No dependencies."""
from pathlib import Path
import re
import hashlib
from html import escape

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
CITIES = {
    'troitsk': dict(name='Троицк', loc='Троицке', address='3-ая Нововатутинская, 2', full='г. Троицк, ул. 3-ая Нововатутинская, д. 2'),
    'kaluga': dict(name='Калуга', loc='Калуге', address='Ленина, 79', full='г. Калуга, ул. Ленина, д. 79'),
}

def write(path, content):
    if path.suffix == '.html':
        def versioned(match):
            asset = SITE / Path(match[2]).name
            revision = hashlib.sha256(asset.read_bytes()).hexdigest()[:10]
            return f'{match[1]}{match[2]}?v={revision}"'
        content = re.sub(r'((?:href|src)=")([^"?]*(?:experience\.css|form\.css|lead-form\.js))"', versioned, content)
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
    mark_paths = re.search(r'<symbol id="logo-mark"[^>]*>(.*?)</symbol>', logo, re.S)[1]
    mark = '<svg class="home-mark" viewBox="428 383 104 94" aria-hidden="true"><defs><clipPath id="homePatternDisc"><circle cx="475.8" cy="430" r="35.6"/></clipPath></defs><g clip-path="url(#homePatternDisc)"><image href="patterns/brand.svg" x="439" y="393" width="74" height="74" preserveAspectRatio="xMidYMid slice" opacity=".72"/></g>' + mark_paths + '</svg>'
    pattern = (SITE / 'patterns' / 'brand.svg').read_text(encoding='utf-8')
    pattern = re.sub(r'<\?xml.*?\?>', '', pattern).strip()
    # Home artwork has a transparent canvas and room for its moving edge shapes.
    # Keep the source asset unchanged: the form uses its original crop.
    pattern = re.sub(r'[ \t]*<rect\b[^>]*/>[ \t]*\n?', '', pattern, count=1)
    pattern = pattern.replace('viewBox="0 0 706.05 366.67"', 'viewBox="-40 -40 786.05 446.67"')
    pattern = pattern.replace('preserveAspectRatio="xMidYMid slice"', 'preserveAspectRatio="xMidYMid meet"')
    home_template = read('home.html').replace('{{logo}}', logo).replace('{{home_pattern}}', pattern)
    # The original form uses the same arrow/close symbols on all pages.
    symbols = re.findall(r'<svg width="0".*?</svg>', template, re.S)
    if len(symbols)>1:
        home_template = home_template.replace(logo, logo + '\n' + symbols[1], 1)
    home = compose(home_template, './')
    write(SITE / 'index.html', home)
    for name in ('privacy', 'consent'):
        write(SITE / f'{name}.html', f'<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Точка звука — переход к документу</title><link rel="canonical" href="https://tzvuka.ru/{name}/"><meta http-equiv="refresh" content="0;url={name}/"></head><body><a href="{name}/">Перейти к актуальной редакции документа</a></body></html>\n')
    urls = ['', 'troitsk/', 'kaluga/', 'privacy/', 'consent/']
    write(SITE / 'sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + ''.join(f'<url><loc>https://tzvuka.ru/{url}</loc></url>' for url in urls) + '</urlset>\n')
    write(SITE / 'robots.txt', 'User-agent: *\nAllow: /\nSitemap: https://tzvuka.ru/sitemap.xml\n')
    print('Built home, city pages and shared footer/form.')

if __name__ == '__main__':
    build()
