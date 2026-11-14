"""Deterministic source ZIP; no environment, credentials, diagnostic files or admin CLI."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT=Path(__file__).resolve().parent
FILES=('index.py','service.py','bulk_store.py','retention.py','storage_errors.py')


def build():
    target=ROOT/'release'/'leads-v2-python312.zip'
    with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED) as archive:
        for name in (*FILES,'requirements.txt'):
            source=ROOT/('requirements.lock' if name=='requirements.txt' else name)
            info=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
            info.create_system=3;info.external_attr=0o100644 << 16
            archive.writestr(info,source.read_bytes().replace(b'\r\n',b'\n'))
    manifest={'runtime':'python312','entrypoint':'index.handler','files':[*FILES,'requirements.txt'],
              'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),
              'deployment_order':['additive-schema','dual-server','v2-client'],
              'required_environment':{'LEADS_SCHEMA_V2_ENABLED':'true','LEADS_MAINTENANCE':'false'},
              'secrets':'reuse existing Lockbox bindings; no new secret values'}
    (ROOT/'release'/'leads-v2-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print(manifest['sha256'])


if __name__=='__main__':build()
