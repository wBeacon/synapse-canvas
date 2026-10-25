import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
from package_buddy_page import package_page


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.page = self.root / 'page'
        self.page.mkdir()
        (self.page / 'index.html').write_text('<p>synthetic demo</p>')
        self.manifest = {'pages': [{'id': 'canvas', 'entry': 'index.html', 'assets': []}]}

    def write_manifest(self):
        (self.page / 'manifest.json').write_text(json.dumps(self.manifest))

    def test_packages_only_declared_files(self):
        self.write_manifest()
        (self.page / 'private-history.jsonl').write_text('PRIVATE_SYNTHETIC_SENTINEL')
        output = self.root / 'demo.zip'
        package_page(self.page, output)
        with ZipFile(output) as archive:
            self.assertEqual(set(archive.namelist()), {'manifest.json', 'index.html'})
            self.assertNotIn(b'PRIVATE_SYNTHETIC_SENTINEL', b''.join(archive.read(n) for n in archive.namelist()))

    def test_rejects_escape_and_symlink_assets(self):
        outside = self.root / 'outside.txt'
        outside.write_text('outside')
        (self.page / 'link').symlink_to(outside)
        for name in ['../outside.txt', str(outside), 'link']:
            with self.subTest(name=name):
                self.manifest['pages'][0]['assets'] = [name]
                self.write_manifest()
                with self.assertRaises(ValueError):
                    package_page(self.page, self.root / 'bad.zip')

    def test_rejects_invalid_page_ids(self):
        for value in ['', 'workbench', 'a/b', 'a\\b']:
            with self.subTest(value=value):
                self.manifest['pages'][0]['id'] = value
                self.write_manifest()
                with self.assertRaises(ValueError):
                    package_page(self.page, self.root / 'bad.zip')


if __name__ == '__main__':
    unittest.main()
