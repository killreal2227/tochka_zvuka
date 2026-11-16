"""Switch only the dedicated leads Gateway after private verification."""
import copy
import json
from pathlib import Path
import sys
from prepare_crm_cloud import yc,STATE,save

ROOT=Path(__file__).resolve().parents[1]


def main():
    state=json.loads(STATE.read_text(encoding='utf-8'))
    operation=yc(['operation','get',state['production_operation']])
    assert operation.get('done') is True and not operation.get('error')
    version=operation['response']
    assert version['entrypoint']=='index.handler' and version['status']=='ACTIVE'
    assert version['environment']['LEADS_SCHEMA_V2_ENABLED']=='true'
    assert version['environment']['ALFACRM_ENABLED']=='true'
    assert version['environment']['PUBLIC_LEADS_ENABLED']=='true'
    value=yc(['serverless','api-gateway','get-spec','--id','d5d2psrdhd0snl30t7b0'])
    spec=value.get('openapi_spec',value)
    if isinstance(spec,str):
        try:spec=json.loads(spec)
        except ValueError:
            import yaml
            spec=yaml.safe_load(spec)
    release=ROOT/'backend/yandex-leads/release'
    old=release/'crm-gateway-rollback.json'
    if not old.exists():old.write_text(json.dumps(spec,ensure_ascii=False,indent=2),encoding='utf-8')
    route=spec['paths']['/leads']['post']['x-yc-apigateway-integration']
    assert route['function_id']=='d4ep7jlje5la3g8ohd70'
    route['tag']=state['candidate_tag']
    spec['info']['title']='Tochka website leads: AlfaCRM and notifications'
    spec['info']['description']='YDB persistence, serial AlfaCRM FIFO delivery and Telegram status notifications.'
    target=release/'crm-gateway-active.json';target.write_text(json.dumps(spec,ensure_ascii=False,indent=2),encoding='utf-8')
    yc(['serverless','api-gateway','update','d5d2psrdhd0snl30t7b0','--spec',str(target)])
    state['production_version']=version['id'];state['gateway_activated']=True;save(state)
    print(json.dumps({'gateway_activated':True,'version':version['id'],'rollback_tag':'leads-public-20261114'}))


if __name__=='__main__':
    try:main()
    except Exception as e:
        print(json.dumps({'gateway_activated':False,'error_type':type(e).__name__}));sys.exit(1)
