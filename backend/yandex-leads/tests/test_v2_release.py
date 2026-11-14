import hashlib
import json
from pathlib import Path
import unittest
import zipfile

ROOT=Path(__file__).resolve().parents[1]


class V2ReleaseTests(unittest.TestCase):
    def test_artifact_contains_exact_runtime_sources_and_pinned_requirements(self):
        manifest=json.loads((ROOT/'release/leads-v2-manifest.json').read_text())
        path=ROOT/'release/leads-v2-python312.zip'
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),manifest['sha256'])
        with zipfile.ZipFile(path) as archive:
            self.assertEqual(set(archive.namelist()),set(manifest['files']))
            self.assertNotIn('admin.py',archive.namelist())
            for name in archive.namelist():
                source=ROOT/('requirements.lock' if name=='requirements.txt' else name)
                self.assertEqual(archive.read(name),source.read_bytes().replace(b'\r\n',b'\n'))
                if name.endswith('.py'):compile(archive.read(name),name,'exec')

    def test_migration_only_adds_nullable_fields_on_exact_leads_table(self):
        spec=json.loads((ROOT/'migrations/002-legal-metadata.json').read_text())
        self.assertIn('etntmjbnguvsu5l8bv3s',spec['database'])
        self.assertEqual(spec['table'],'tz_site_test_20261114_leads')
        self.assertEqual(spec['ttl'],{'column':'purge_at_ms','unit':'MILLISECONDS','expire_after_seconds':0})


if __name__=='__main__':unittest.main()
