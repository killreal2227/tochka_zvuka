"""Check published pages, local links/assets and JavaScript syntax."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import re
import subprocess
import json
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
PUBLIC_BASE_URL = json.loads((ROOT/'site-config.json').read_text(encoding='utf-8'))['public_base_url'].rstrip('/')
PAGES = ['index.html', 'troitsk/index.html', 'kaluga/index.html', 'privacy/index.html', 'consent/index.html', 'documents/index.html', 'privacy.html', 'consent.html']

class Page(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.ids = set()
        self.links = []
        self.feed(text)
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            assert attrs['id'] not in self.ids, f'Duplicate ID: {attrs["id"]}'
            self.ids.add(attrs['id'])
        for key in ('href', 'src'):
            if key in attrs:
                self.links.append(attrs[key])

def check():
    for name in PAGES:
        path = SITE / name
        text = path.read_text(encoding='utf-8')
        assert not re.search(r'\[EMAIL\]|\[ТЕЛЕФОН\]|\[ДОМЕН\]|\[ДАТА\]|\{\{\w+\}\}', text), name
        page = Page(text)
        expected_path = name.removesuffix('index.html') if name.endswith('index.html') else name.removesuffix('.html') + '/'
        expected_canonical = PUBLIC_BASE_URL + '/' + expected_path
        assert f'rel="canonical" href="{expected_canonical}"' in text, (name, 'canonical')
        refs = page.links + re.findall(r'url\([\"\']?([^\)\"\']+)', text)
        for href in refs:
            link = urlsplit(href)
            if link.scheme or link.netloc:
                continue
            target = (path.parent / unquote(link.path)).resolve() if link.path else path
            assert target.is_relative_to(SITE.resolve()), (name, href)
            if target.is_dir():
                target = target / 'index.html'
            assert target.is_file(), (name, href, 'missing file')
            if link.fragment and target.suffix == '.html':
                ids = page.ids if target == path else Page(target.read_text(encoding='utf-8')).ids
                assert link.fragment in ids, (name, href, 'missing anchor')
        for script in re.findall(r'<script[^>]*>(.*?)</script>', text, re.S):
            subprocess.run(['node', '--check'], input=script, encoding='utf-8', check=True, capture_output=True)
        if name.startswith(('troitsk/', 'kaluga/')):
            slug = name.split('/')[0]
            assert f'data-city="{slug}"' in text
            assert f'{PUBLIC_BASE_URL}/{slug}/' in text
            contact_phone = '+74951280448' if slug == 'troitsk' else '+79200988003'
            assert 'tel:' + contact_phone in text
            assert set(re.findall(r'href="tel:([^"]+)"', text)) == {contact_phone}
            assert 'data-interaction="disclosure"' in text and text.count('data-disclosure="true"') == 6
            assert 'home-footer' in text and 'troitsk-page.js' in text
            assert 'филиал ' + ('Троицк' if slug == 'troitsk' else 'Калуга') in text
            assert 'mailto:tzvuka@yandex.ru' in text or 'href="../requisites/"' in text
            assert 'id="leadForm"' in text and 'localStorage' not in text
            assert 'lessonNudge' in text and 'direction-player.js' in text
            assert 'name="consent"' not in text
            assert 'class="lead-consent"' in text
            assert 'site-footer' in text
        print('OK', name)
    assert (SITE/'CNAME').read_text().strip() == 'tzvuka.ru'
    assert PUBLIC_BASE_URL + '/sitemap.xml' in (SITE/'robots.txt').read_text()
    sitemap = ET.parse(SITE/'sitemap.xml')
    assert all(node.text.startswith(PUBLIC_BASE_URL + '/') for node in sitemap.findall('.//{*}loc'))
    home = (SITE/'index.html').read_text(encoding='utf-8')
    assert home.index('experience.css') < home.index('form.css') < home.index('home.css')
    assert 'id="leadForm"' in home and 'id="leadModal"' in home
    assert 'name="consent"' not in home
    assert 'class="lead-consent"' in home
    assert 'href="./documents/"' in home and 'href="./requisites/"' in home
    requisites = (SITE/'requisites/index.html').read_text(encoding='utf-8')
    assert '732595555858' in requisites and '326774600083329' in requisites
    troitsk = (SITE/'troitsk/index.html').read_text(encoding='utf-8')
    city_template = (ROOT/'templates/city.html').read_text(encoding='utf-8')
    descriptions = re.findall(r'data-dir="([^"]+)">.*?<span class="desc-copy">(.*?)</span>', city_template, re.S)
    assert len(descriptions) == 6
    for direction, description in descriptions:
        if direction == 'actor': description = 'Сцена, эмоции и свобода самовыражения'
        assert '<span class="desc-copy">' + description + '</span>' in troitsk, 'Incomplete description: ' + direction
    for slug in ('troitsk', 'kaluga'):
        assert 'home.css' not in (SITE/slug/'index.html').read_text(encoding='utf-8')
    for asset in ('lead-form.js', 'home-motion.js', 'direction-player.js', 'city-ui.js', 'button-labels.js', 'troitsk-enrolment.js', 'troitsk-page.js'):
        subprocess.run(['node','--check',str(SITE/asset)],check=True,capture_output=True)
    print('All static checks passed.')

if __name__ == '__main__':
    check()
