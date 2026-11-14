"""Storage errors never include credentials, request bodies or contacts."""
class RequestConflict(Exception):
    pass

class ConditionalFailed(Exception):
    pass

class StorageUnavailable(Exception):
    pass

class DeliveryFailure(RuntimeError):
    def __init__(self, code='delivery_unconfirmed', retry_after=None, permanent=False):
        self.code=code if code in {'telegram_429','telegram_400','telegram_401','telegram_403',
            'telegram_5xx','delivery_unconfirmed'} else 'delivery_unconfirmed'
        valid=type(retry_after) is int and retry_after>=0
        self.retry_after=min(retry_after,604800) if valid else None
        self.permanent=bool(permanent or valid and retry_after>604800)
        super().__init__(self.code)
