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

def cta_components(content):
    """Render burgundy actions through the same label/icon markup."""
    def render(match):
        tag, attrs, classes, inner = match.groups()
        tokens = classes.split()
        if not (('btn' in tokens and not {'light', 'lead-call'} & set(tokens)) or 'header-cta' in tokens):
            return match[0]
        is_header = bool({'header-enrol', 'header-cta'} & set(tokens))
        compact = is_header or 'data-cta-size="compact"' in attrs
        label = re.split(r'<(?:i|svg)\b', inner, maxsplit=1)[0].strip()
        if label.startswith('<span'):
            first = re.match(r'<span([^>]*)>', label)
            span_attrs = first[1]
            if 'class="' in span_attrs:
                span_attrs = span_attrs.replace('class="', 'class="tz-cta-label ', 1)
            else:
                span_attrs += ' class="tz-cta-label"'
            label = '<span' + span_attrs + '>' + label[first.end():]
        else:
            label = '<span class="tz-cta-label">' + label + '</span>'
        size = 'compact' if compact else 'standard'
        attrs = attrs.replace('class="' + classes + '"', 'class="' + classes + ' tz-cta tz-cta--' + size + '"', 1)
        path = 'M12 5v14m-6-6 6 6 6-6' if is_header else 'M6 18 18 6M6 6h12v12'
        icon = '<i class="tz-cta-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="' + path + '"/></svg></i>'
        return '<' + tag + attrs + '>' + label + icon + '</' + tag + '>'
    return re.sub(r'<(button|a)\b([^>]*\bclass="([^"]*)"[^>]*)>(.*?)</\1>', render, content, flags=re.S)

def troitsk_directions(content):
    def section(match):
        body = match[0]
        body = body.replace('<div class="grid"', '<div class="grid" data-interaction="disclosure"', 1)
        body = re.sub(r'(<span class="kicker">).*?(</span>)', lambda m: m[1] + 'НАПРАВЛЕНИЯ' + m[2], body, count=1)
        body = re.sub(r'(<p class="lead rv d1">).*?(</p>)', lambda m: m[1] + 'Выбирай то, что откликается. В пути всегда можно сменить направление.' + m[2], body, count=1)
        def card(m):
            classes, direction, inner = m.groups()
            inner = re.sub(r'<span class="go">.*?</span>$', '', inner, flags=re.S)
            inner = inner.replace('<span><span class="name">', '<span class="direction-copy"><span class="name" id="direction-name-' + direction + '">', 1)
            inner = inner.replace('class="desc"', 'class="desc" id="direction-description-' + direction + '"', 1)
            toggle = '<button class="direction-toggle" type="button" aria-expanded="false" aria-controls="direction-description-' + direction + '" aria-labelledby="direction-name-' + direction + '"></button>'
            plus = '<span class="go direction-indicator" aria-hidden="true">+</span>'
            signup = '<button class="btn direction-signup" data-cta-size="compact" type="button" hidden><span>Записаться</span><i><svg><use href="#i-arrow"/></svg></i></button>'
            return '<article class="card' + classes + '" data-dir="' + direction + '" data-disclosure="true">' + inner + toggle + plus + signup + '</article>'
        body, count = re.subn(r'<button class="card([^"]*)" type="button" data-dir="([^"]*)">(.*?)</button>', card, body, flags=re.S)
        assert count == 6, 'Expected six Troitsk direction cards'
        return body
    return re.sub(r'<section class="dirs" id="dirs">.*?</section>', section, content, count=1, flags=re.S)

def write(path, content):
    if path.suffix == '.html':
        content = cta_components(content)
        if 'tz-cta--' in content:
            root = '../' * len(path.parent.relative_to(SITE).parts)
            content = content.replace('</head>', '<link rel="stylesheet" href="' + root + 'cta.css">\n</head>')
        head, separator, body = content.partition('</head>')
        for old_base in ('https://tzvuka.ru', 'https://killreal2227.github.io/tochka_zvuka'):
            head = head.replace(old_base + '/', PUBLIC_BASE_URL + '/')
        content = head + separator + body
        def versioned(match):
            asset = (path.parent / match[2]).resolve()
            revision = hashlib.sha256(asset.read_bytes()).hexdigest()[:10]
            return f'{match[1]}{match[2]}?v={revision}"'
        content = re.sub(r'((?:href|src)=")([^"?]*(?:cta\.css|experience\.css|responsive\.css|form\.css|home\.css|narrow-header\.css|troitsk-enrolment\.css|troitsk-enrolment\.js|troitsk-page\.js|home-motion\.js|home-branches\.js|lead-form\.js|city-ui\.css|city-ui\.js|direction-player\.js|direction-scroll\.js|button-labels\.js|viewport-scale\.js|icons/ic_[a-z]+\.svg))"', versioned, content)
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
            source = source.replace('{{nudge}}', read('troitsk-nudge.html'))
            source = troitsk_directions(source)
            source = re.sub(r'(<a class="link" href="#dirs">)([^<]+)(<svg)', lambda m: m[1] + '<span class="hero-direction-label">' + m[2] + '</span>' + m[3], source, count=1)

            source = source.replace('</head>', '<script src="../troitsk-page.js" defer></script>\n</head>')
            source = re.sub(r'(<p class="lead hero-copy">).*?(</p>)', lambda m: m[1] + 'Музыка, сцена и люди, с которыми хочется пробовать новое. Для детей и взрослых — независимо от опыта. Без экзаменов и ожидания «подходящего момента».' + m[2], source, count=1, flags=re.S)

            source = re.sub(r'<span class="kicker hero-copy">.*?</span></span>', '<span class="kicker hero-copy">музыкальное пространство · <span class="hero-branch-line">филиал Троицк</span></span>', source, count=1)
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
    home_template = home_template.replace('{{footer}}', read('home-footer.html'))
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
    write(SITE / 'requisites' / 'index.html', read('requisites.html').replace('{{public_base_url}}', PUBLIC_BASE_URL))
    urls = ['requisites/', '', 'troitsk/', 'kaluga/', 'privacy/', 'consent/', 'documents/']
    write(SITE / 'sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + ''.join(f'<url><loc>{PUBLIC_BASE_URL}/{url}</loc></url>' for url in urls) + '</urlset>\n')
    write(SITE / 'robots.txt', f'User-agent: *\nAllow: /\nSitemap: {PUBLIC_BASE_URL}/sitemap.xml\n')
    print('Built home, city pages and shared footer/form.')

if __name__ == '__main__':
    build()
