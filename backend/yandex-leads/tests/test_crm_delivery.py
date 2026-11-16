import copy
import json
import unittest
from unittest.mock import Mock,MagicMock
from crm_delivery import Delivery,notification_text
from crm_queue import Queue,QueueError
from test_bulk_mvp import BulkTests
from alfacrm import CRMError


class DeliveryTests(unittest.TestCase):
    save=BulkTests.save
    def setUp(self):
        BulkTests.setUp(self)
        self.receipt=self.save();self.lead=self.store.load_lead(self.receipt)
        self.queue=Mock();self.queue.take.return_value=(self.receipt,'fixture-handle')
        self.crm=Mock();self.sender=Mock(return_value=44)
        self.delivery=Delivery(self.store,self.queue,self.crm,self.sender)
    def test_crm_error_still_notifies_and_keeps_queue(self):
        self.crm.sync.side_effect=CRMError()
        result=self.delivery.accept(self.receipt)
        self.assertEqual(result['notification'],'sent')
        text=self.sender.call_args.args[1]
        self.assertIn('не подтверждена',text)
        self.assertNotIn(self.lead['phone'],text)
        self.queue.delete.assert_not_called()
        self.assertIsNotNone(self.store.load_lead(self.receipt))
    def test_pending_message_is_edited_after_confirmation(self):
        self.delivery.notice(self.receipt,'pending')
        def sync(lead,store):store.crm_mark(lead,'sent','77');return 'sent'
        self.crm.sync.side_effect=sync
        self.delivery.drain()
        self.assertEqual(self.sender.call_args.args[2],'44')
        self.assertIn('№77',self.sender.call_args.args[1])
        self.queue.delete.assert_called_once()
        self.assertEqual(self.store.notice_marker(self.receipt)['crm_state'],'sent')
    def test_telegram_failure_preserves_confirmed_crm(self):
        def sync(lead,store):store.crm_mark(lead,'sent','77');return 'sent'
        self.crm.sync.side_effect=sync;self.sender.side_effect=RuntimeError()
        result=self.delivery.drain()
        self.assertEqual(result,{'crm':'sent','notification':'pending'})
        self.assertEqual(self.store.crm_marker(self.receipt)['crm_state'],'sent')
        self.queue.delete.assert_not_called()
    def test_queue_failure_has_warning_without_false_success(self):
        self.queue.enqueue.side_effect=QueueError()
        result=self.delivery.accept(self.receipt)
        self.assertEqual(result,{'crm':'pending','notification':'sent'})
        self.queue.take.assert_not_called();self.crm.sync.assert_not_called()
    def test_busy_fifo_does_not_call_crm_in_parallel(self):
        self.queue.take.return_value=None
        self.assertEqual(self.delivery.accept(self.receipt)['crm'],'queued')
        self.crm.sync.assert_not_called()
    def test_notification_does_not_regress_after_sent(self):
        self.store.crm_mark(self.lead,'sent','77')
        self.delivery.notice(self.receipt,'pending')
        self.assertIn('передана',self.sender.call_args.args[1])
        self.assertNotIn('не подтверждена',self.sender.call_args.args[1])
    def test_notifications_never_contain_name_phone(self):
        for state in ('pending','sent','attention','existing_review'):
            text=notification_text(self.lead,state,'77')
            for field in ('name','surname','phone'):self.assertNotIn(self.lead[field],text)
    def test_queue_signature_and_fifo_parameters(self):
        opener=MagicMock();response=opener.open.return_value.__enter__.return_value
        response.status=200;response.read.return_value=b'<SendMessageResponse><MessageId>x</MessageId></SendMessageResponse>'
        queue=Queue({'CRM_QUEUE_ACCESS_KEY':'fixture','CRM_QUEUE_SECRET_KEY':'secret',
            'CRM_QUEUE_URL':'https://message-queue.api.cloud.yandex.net/a/b/test.fifo'},opener=opener)
        queue.enqueue(self.receipt)
        request=opener.open.call_args.args[0]
        self.assertEqual(request.full_url,'https://message-queue.api.cloud.yandex.net/')
        self.assertIn('MessageGroupId=alfacrm-account',request.data.decode())
        self.assertIn('AWS4-HMAC-SHA256',request.get_header('Authorization'))
        self.assertNotIn(self.lead['phone'],request.data.decode())


if __name__=='__main__':unittest.main()
