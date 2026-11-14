"""Print YQL with a reviewed prefix; NEVER connect to YDB or execute DDL."""
import argparse
import re
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument("--prefix",required=True)
args=parser.parse_args()
if not re.fullmatch(r"[a-z][a-z0-9_]{0,40}_",args.prefix):
    parser.error("Invalid table prefix")
print((Path(__file__).with_name("schema.yql")).read_text(encoding="utf-8").replace("tz_site_",args.prefix))
