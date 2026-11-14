"""Build a local function ZIP from an explicit allowlist. No deployment command."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import hashlib
import json
import shutil
root=Path(__file__).resolve().parent
files=["index.py","service.py","ydb_store.py","requirements.txt"]
# Use the fully pinned dependency list as the deployment requirements.txt.
with ZipFile(root/"deployment.zip","w",ZIP_DEFLATED) as archive:
    for name in files:
        source=root/("requirements.lock" if name=="requirements.txt" else name)
        archive.writestr(name,source.read_bytes())
release=root/'release'
release.mkdir(exist_ok=True)
artifact=release/'function-python312.zip'
shutil.copyfile(root/'deployment.zip',artifact)
digest=hashlib.sha256(artifact.read_bytes()).hexdigest()
manifest_path=release/'manifest.json'
manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
manifest['artifact_sha256']=digest
manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(release/'SHA256SUMS').write_text(digest+'  function-python312.zip\n',encoding='ascii')
print('Prepared offline Python 3.12 ZIP, manifest and SHA256SUMS; nothing deployed.')
