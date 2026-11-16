"""One FIFO group serializes ALL account requests across function instances/zones."""
import json
from alfacrm import BRANCH_IDS, DIRECTIONS
from storage_errors import RequestDeleted

LABELS={'sent':'✅ Заявка передана в AlfaCRM',
        'pending':'⚠️ Заявка получена. Передача в CRM пока не подтверждена.',
        'attention':'⚠️ Заявка получена. Результат создания карточки требует проверки.',
        'existing_review':'⚠️ Повторное обращение: телефон уже есть в CRM. Нужна проверка.'}


def notification_text(lead,state,external_id=''):
    branch={'kaluga':'Калуга','troitsk':'Троицк'}[lead['branch']]
    lines=[LABELS[state],'Филиал: '+branch,'Направление: '+DIRECTIONS[lead['direction']],
           'Заявка: '+lead['request_id']]
    if external_id:
        lines+=['Карточка CRM: №'+external_id,
                'https://tochkazvuka.s20.online/company/'+str(BRANCH_IDS[lead['branch']])+'/customer/view?id='+external_id]
    elif state!='sent':lines+=['Данные сохранены. Контакты в Telegram не передаются.']
    return '\n'.join(lines)


class Delivery:
    def __init__(self,store,queue,crm,send_notice):
        self.store,self.queue,self.crm,self.send_notice=store,queue,crm,send_notice

    def notice(self,receipt,state):
        lead=self.store.load_lead(receipt)
        crm=self.store.crm_marker(receipt) or {}
        # An old pending attempt must never overwrite a later confirmed outcome.
        if crm.get('crm_state') in ('sent','existing_review'):state=crm['crm_state']
        marker=self.store.notice_marker(receipt)
        if marker and marker.get('crm_state')==state:return 'sent'
        old=marker.get('telegram_message_id') if marker else None
        message=self.send_notice(lead,notification_text(lead,state,crm.get('crm_external_id','')),old)
        self.store.notice_mark(lead,state,message)
        return 'sent'

    def accept(self,receipt):
        notification='pending'
        try:
            self.queue.enqueue(receipt)
        except Exception:
            try:notification=self.notice(receipt,'pending')
            except Exception:pass
            return {'crm':'pending','notification':notification}
        # Inform the manager even if another request currently occupies the FIFO group.
        try:notification=self.notice(receipt,'pending')
        except Exception:pass
        self.drain()
        marker=self.store.crm_marker(receipt) or {}
        notice=self.store.notice_marker(receipt) or {}
        if notice.get('telegram_sent') is True:notification='sent'
        return {'crm':marker.get('crm_state','queued'),'notification':notification}

    def drain(self):
        item=self.queue.take()
        if item is None:return {'crm':'idle'}
        receipt,handle=item
        try:
            state=self.store.sync_crm(receipt,self.crm)
        except RequestDeleted:
            self.queue.delete(handle)
            return {'crm':'deleted'}
        except Exception:
            try:self.notice(receipt,'pending')
            except Exception:pass
            # No loop/retry: FIFO visibility (300s) throttles dependency failures.
            return {'crm':'pending'}
        try:
            self.notice(receipt,state)
            self.queue.delete(handle)
        except Exception:return {'crm':state,'notification':'pending'}
        return {'crm':state,'notification':'sent'}
