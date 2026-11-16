"""Sequential AlfaCRM delivery. Never retries an ambiguous create automatically.

The caller must hold the single FIFO message group's visibility lease.
Yandex scaling limits are per zone: concurrency=1 does NOT serialize an account.
Production calls go through crm_delivery.Delivery.drain, never directly from HTTP.
"""
import json
import re
import threading
import time
import urllib.error
import urllib.request

BRANCH_IDS = {'kaluga': 7, 'troitsk': 53}
DIRECTIONS = {'vocal': 'Вокал', 'guitar': 'Гитара', 'drums': 'Барабаны',
              'piano': 'Фортепиано', 'actor': 'Актёрское мастерство',
              'speech': 'Ораторское искусство', 'unsure': 'Помогите выбрать'}


class CRMError(RuntimeError):
    def __init__(self, code='crm_unavailable'):
        super().__init__(code)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def transport(path, payload, token):
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}
    if token:
        headers['X-ALFACRM-TOKEN'] = token
    request = urllib.request.Request('https://tochkazvuka.s20.online' + path,
        data=json.dumps(payload).encode(), headers=headers, method='POST')
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=8) as response:
            raw = response.read(1048577)
            if response.status != 200 or len(raw) > 1048576:
                raise CRMError()
            return json.loads(raw)
    except urllib.error.HTTPError as error:
        # No response bodies, contact details, tokens or request URLs in errors.
        raise CRMError('crm_rate_limited' if error.code == 429 else 'crm_unavailable') from None
    except Exception:
        raise CRMError() from None


def phone_key(value):
    digits = re.sub(r'\D', '', str(value))
    return '7' + digits[1:] if len(digits) == 11 and digits[0] == '8' else digits


class AlfaCRM:
    def __init__(self, env, send=transport, clock=time.monotonic, sleep=time.sleep):
        self.email, self.key = env.get('ALFACRM_EMAIL'), env.get('ALFACRM_API_KEY')
        if not self.email or not self.key:
            raise CRMError('crm_not_configured')
        # Explicitly reviewed initial stage required. No default to Skorozvon.
        raw = env.get('ALFACRM_LEAD_STATUS_ID', '')
        if not re.fullmatch(r'[1-9][0-9]*', raw):
            raise CRMError('crm_stage_required')
        self.stage = int(raw)
        self.send, self.clock, self.sleep = send, clock, sleep
        self.lock = threading.RLock()
        self.token, self.expires, self.next_at = None, 0, self.clock() + 2.2

    def _request(self, path, payload, authenticated=True):
        delay = self.next_at - self.clock()
        if delay > 0:
            self.sleep(delay)
        try:
            result = self.send(path, payload, self.token if authenticated else None)
            if not isinstance(result, dict):
                raise CRMError()
            return result
        finally:
            self.next_at = self.clock() + 2.2

    def _login(self):
        if not self.token or self.clock() >= self.expires:
            result = self._request('/v2api/auth/login',
                {'email': self.email, 'api_key': self.key}, authenticated=False)
            if not isinstance(result.get('token'), str) or not result['token']:
                raise CRMError('crm_auth_failed')
            self.token, self.expires = result['token'], self.clock() + 3300

    def sync(self, lead, store):
        with self.lock:
            return self._sync(lead, store)

    def _sync(self, lead, store):
        receipt = lead['request_id']
        branch = BRANCH_IDS[lead['branch']]
        direction = DIRECTIONS[lead['direction']]
        name = (lead['name'] + ' ' + lead['surname']).strip()
        # CRM name limit is 50; never silently truncate a person's name.
        if len(name) > 50:
            return 'attention'
        marker = store.crm_marker(receipt)
        if marker and marker.get('crm_state') == 'sent':
            return marker['crm_state']
        self._login()
        path = '/v2api/' + str(branch) + '/customer/'
        result = self._request(path + 'index',
            {'phone': phone_key(lead['phone']), 'is_study':2,'removed': 1, 'page': 0})
        items = result.get('items')
        total = result.get('total')
        if (not isinstance(items, list) or type(total) is not int or total > len(items)
                or total != len(items)):
            raise CRMError('crm_lookup_incomplete')
        matches = [item for item in items if isinstance(item, dict)
            and type(item.get('id')) is int and item['id'] > 0
            and isinstance(item.get('phone'), list)
            and any(phone_key(p) == phone_key(lead['phone']) for p in item['phone'])]
        reference = '[tzvuka-request:' + receipt + ']'
        recovered = [item for item in matches if reference in str(item.get('note', ''))]
        if len(recovered) == 1:
            store.crm_mark(lead, 'sent', str(recovered[0]['id']))
            return 'sent'
        if len(recovered)>1:
            return 'attention'
        if items and not matches:
            # A fuzzy phone result is not proof that no duplicate exists.
            return 'attention'
        if marker and marker.get('crm_state')!='existing_review':
            # A previous create might have succeeded. Never create again blindly.
            return 'attention'
        store.crm_mark(lead, 'creating', '')  # durable barrier BEFORE the POST
        note = '\n'.join(['Заявка с tzvuka.ru', reference, 'Направление: ' + direction,
            'Страница: ' + lead['page_path'], 'Заявка на занятие по инициативе заявителя.',
            'Политика: https://tzvuka.ru/documents/#privacy'])
        if matches:
            note+='\nПовторное обращение. Связанные карточки с тем же телефоном: '+', '.join('№'+str(item['id']) for item in matches)+'. Прежние карточки не изменялись.'
        payload = {'name': name, 'phone': [lead['phone']], 'legal_type': 1,
            'is_study': 0, 'branch_ids': [branch], 'lead_source_id': 3,
            'lead_status_id': self.stage,'pipeline_id':1, 'note': note}
        created = self._request(path + 'create', payload)
        if created.get('success') is True and isinstance(created.get('model'),dict):
            created=created['model']
        # Validate the returned model; a validation-error JSON is not success.
        if type(created.get('id')) is not int or created['id'] <= 0:
            raise CRMError('crm_create_unconfirmed')
        checked=self._request(path+'index',{'id':created['id'],'is_study':2,'removed':1,'page':0})
        models=checked.get('items',[])
        if (len(models)!=1 or models[0].get('id')!=created['id']
                or branch not in models[0].get('branch_ids',[])
                or models[0].get('lead_status_id')!=self.stage
                or models[0].get('lead_source_id')!=3
                or reference not in str(models[0].get('note',''))
                or not isinstance(models[0].get('phone'),list)
                or not any(phone_key(p)==phone_key(lead['phone']) for p in models[0]['phone'])):
            raise CRMError('crm_create_unconfirmed')
        store.crm_mark(lead, 'sent', str(created['id']))
        return 'sent'
