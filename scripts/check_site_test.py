"""Regression checks for the static resource validator; standard library only."""
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
import check_site


class CssAssetsTest(unittest.TestCase):
    def test_url_forms_and_comments(self):
        self.assertEqual(check_site.css_urls(
            "/* url(missing.svg) */ a{background:URL( 'a b.svg' );"
            'mask:url("icons/a.svg?v=2");src:url(font.ttf)}'),
            ['a b.svg', 'icons/a.svg?v=2', 'font.ttf'])

    def validate(self, url, exists=False):
        site = Path(__file__).resolve().parent / 'fixture-site'
        stylesheet = MagicMock()
        stylesheet.name = 'test.css'
        stylesheet.parent = site / 'styles'
        stylesheet.read_text.return_value = f'a{{background:url("{url}")}}'
        with patch.object(check_site, 'SITE') as root:
            root.resolve.return_value = site
            root.rglob.return_value = [stylesheet]
            root.__truediv__.side_effect = lambda part: site / part
            with patch.object(Path, 'is_file', return_value=exists):
                check_site.check_css_assets()

    def test_relative_and_root_urls_with_revision(self):
        self.validate('../asset.svg?v=1', exists=True)
        self.validate('/asset.svg?v=1', exists=True)

    def test_missing_asset_fails(self):
        with self.assertRaisesRegex(AssertionError, 'missing CSS asset'):
            self.validate('../missing.svg')

    def test_traversal_fails(self):
        with self.assertRaisesRegex(AssertionError, 'outside site'):
            self.validate('../../outside.svg')

    def test_external_data_and_fragment_urls_are_ignored(self):
        for url in ('https://example.test/a.svg', '//example.test/a.svg',
                    'data:image/svg+xml;base64,PHN2Zy8+', '#clip'):
            self.validate(url)


if __name__ == '__main__':
    unittest.main()
