"""Build a local function ZIP from an explicit allowlist. No deployment command."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
root=Path(__file__).resolve().parent
files=["index.py","service.py","ydb_store.py","requirements.txt"]
# Use the fully pinned dependency list as the deployment requirements.txt.
with ZipFile(root/"deployment.zip","w",ZIP_DEFLATED) as archive:
    for name in files:
        source=root/("requirements.lock" if name=="requirements.txt" else name)
        archive.writestr(name,source.read_bytes())
print("Prepared local deployment.zip (no env, keys, tests, schema or resource mutations).")
