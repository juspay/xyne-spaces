"""Memorystore IAM auth: the Redis password is a short-lived access token."""
import google.auth
from google.auth.transport.requests import Request
from redis.credentials import CredentialProvider


class IamCredentialProvider(CredentialProvider):
    def __init__(self) -> None:
        self._credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])

    def get_credentials(self) -> tuple:
        if not self._credentials.valid:
            self._credentials.refresh(Request())
        return (self._credentials.token,)

    async def get_credentials_async(self) -> tuple:
        return self.get_credentials()
