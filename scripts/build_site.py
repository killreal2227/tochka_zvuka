"""Build the static website from shared templates. No dependencies."""
from pathlib import Path
import re
import hashlib
import json
from html import escape

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
PUBLIC_BASE_URL = json.loads((ROOT / 'site-config.json').read_text(encoding='utf-8'))['public_base_url'].rstrip('/')
CITIES = {
    'troitsk': dict(name='Троицк', loc='Троицке', address='ул. 3-ая Нововатутинская, 2', full='г. Троицк, ул. 3-ая Нововатутинская, д. 2'),
    'kaluga': dict(name='Калуга', loc='Калуге', address='ул. Ленина, 79', full='г. Калуга, ул. Ленина, д. 79'),
}

def write(path, content):
    if path.suffix == '.html':
        head, separator, body = content.partition('</head>')
        for old_base in ('https://tzvuka.ru', 'https://killreal2227.github.io/tochka_zvuka'):
            head = head.replace(old_base + '/', PUBLIC_BASE_URL + '/')
        content = head + separator + body
        def versioned(match):
            asset = (path.parent / match[2]).resolve()
            revision = hashlib.sha256(asset.read_bytes()).hexdigest()[:10]
            return f'{match[1]}{match[2]}?v={revision}"'
        content = re.sub(r'((?:href|src)=")([^"?]*(?:experience\.css|responsive\.css|form\.css|home\.css|narrow-header\.css|troitsk-enrolment\.css|troitsk-enrolment\.js|home-motion\.js|home-branches\.js|lead-form\.js|city-ui\.css|city-ui\.js|direction-player\.js|direction-scroll\.js|button-labels\.js|icons/ic_[a-z]+\.svg))"', versioned, content)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')

def read(name):
    return (ROOT / 'templates' / name).read_text(encoding='utf-8')

def compose(page, root):
    for part, filename in [('footer', 'footer.html'), ('dialog', 'lead-dialog.html'), ('nudge', 'lesson-nudge.html')]:
        page = page.replace('{{' + part + '}}', read(filename).replace('{{root}}', root))
    return page

def build():
    template = read('city.html')
    for slug, city in CITIES.items():
        source = template
        if slug == 'troitsk':
            source = re.sub(r'<header class="top".*?</header>', lambda _: read('troitsk-header.html'), source, count=1, flags=re.S)
            source = re.sub(r'<span class="kicker hero-copy">.*?</span></span>', '<span class="kicker hero-copy">музыкальное проство · <span class="hero-branch-line">филиал Троицк</span></span>', source, count=1)
        source = source.replace('</head>', '<link rel="stylesheet" href="../troitsk-enrolment.css"><script src="../troitsk-enrolment.js" defer></script>\n</head>')
        page = compose(source, '../')
        if slug == 'troitsk':
            page = re.sub(r'(<button class="footer-enrol openForm"[^>]*>).*?(<svg)', r'\1Записаться \2', page, count=1)
        for key, value in dict(city, slug=slug).items():
            page = page.replace('{{' + key + '}}', escape(value))
        write(SITE / slug / 'index.html', page)
    logo = re.search(r'<body[^>]*>\s*(<svg.*?</svg>)', template, re.S)[1]
    pattern = (SITE / 'patterns' / 'home-orbits.svg').read_text(encoding='utf-8')
    pattern = re.sub(r'<\?xml.*?\?>', '', pattern).strip()
    # Distinct transparent home artwork; the form retains its original pattern.
    home_template = read('home.html').replace('{{logo}}', logo).replace('{{home_pattern}}', pattern)
    # The original form uses the same arrow/close symbols on all pages.
    symbols = re.findall(r'<svg width="0".*?</svg>', template, re.S)
    if len(symbols)>1:
        home_template = home_template.replace(logo, logo + '\n' + symbols[1], 1)
    home = compose(home_template, './')
    write(SITE / 'index.html', home)
    for name in ('privacy', 'consent'):
        document = SITE / name / 'index.html'
        head = document.read_text(encoding='utf-8').split('<body>', 1)[0]
        write(document, head + read(name + '-body.html'))
        write(SITE / f'{name}.html', f'<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Точка звука — переход к документу</title><link rel="canonical" href="https://tzvuka.ru/{name}/"><meta http-equiv="refresh" content="0;url={name}/"></head><body><a href="{name}/">Перейти к актуальной редакции документа</a></body></html>\n')
    combined = read('documents.html').replace('{{public_base_url}}', PUBLIC_BASE_URL)
    for name in ('privacy', 'consent'):
        module = read(name + '-body.html').split('<h1>', 1)[1]
        module = '<h1>' + module.split('<footer>', 1)[0]
        module = re.sub(r'<(/?)h2>', r'<\1h3>', module)
        module = re.sub(r'<(/?)h1>', r'<\1h2>', module)
        module = module.replace('../privacy/', '#privacy').replace('../consent/', '#consent')
        combined = combined.replace('{{' + name + '}}', module)
    write(SITE / 'documents' / 'index.html', combined)
    urls = ['', 'troitsk/', 'kaluga/', 'privacy/', 'consent/', 'documents/']
    write(SITE / 'sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + ''.join(f'<url><loc>{PUBLIC_BASE_URL}/{url}</loc></url>' for url in urls) + '</urlset>\n')
    write(SITE / 'robots.txt', f'User-agent: *\nAllow: /\nSitemap: {PUBLIC_BASE_URL}/sitemap.xml\n')
    print('Built home, city pages and shared footer/form.')

if __name__ == '__main__':
    build()
