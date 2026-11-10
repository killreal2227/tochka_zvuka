"""Check published pages, local links/assets and JavaScript syntax."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
PAGES = ['index.html', 'troitsk/index.html', 'kaluga/index.html', 'privacy/index.html', 'consent/index.html', 'privacy.html', 'consent.html']

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
            assert f'https://tzvuka.ru/{slug}/' in text
            assert 'tel:+79957907670' in text and 'mailto:tzvuka@yandex.ru' in text
            assert 'id="leadForm"' in text and 'localStorage' not in text
            assert re.search(r'<input(?=[^>]*name="consent")(?=[^>]*\brequired\b)',text)
            assert 'site-footer' in text
        print('OK', name)
    assert (SITE/'CNAME').read_text().strip() == 'tzvuka.ru'
    for asset in ('lead-form.js',):
        subprocess.run(['node','--check',str(SITE/asset)],check=True,capture_output=True)
    print('All static checks passed.')

if __name__ == '__main__':
    check()
