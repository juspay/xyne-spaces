"""
Google Cloud Storage bucket provider
"""
import logging
from typing import Optional
from google.auth import load_credentials_from_file
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.cloud import storage
from config import get_logger
from .storage_base import StorageBucket, BlobWriter

logger = get_logger(__name__)


class GCSBlobWriter(BlobWriter):
    """Wraps GCS blob.open() writer to implement BlobWriter interface."""

    def __init__(self, writer):
        self._writer = writer

    def write(self, data: str) -> None:
        self._writer.write(data)

    def flush(self) -> None:
        self._writer.flush()

    def close(self) -> None:
        self._writer.close()


class GCSStorageBucket(StorageBucket):
    """GCS implementation of StorageBucket."""

    def __init__(self, bucket: storage.Bucket):
        self._bucket = bucket

    @property
    def name(self) -> str:
        return self._bucket.name

    def blob_exists(self, filename: str) -> bool:
        return self._bucket.blob(filename).exists()

    def download_as_bytes(self, filename: str) -> bytes:
        return self._bucket.blob(filename).download_as_string()

    def upload_from_string(self, filename: str, content: str, content_type: str) -> None:
        self._bucket.blob(filename).upload_from_string(content, content_type=content_type)

    def open_writer(self, filename: str, content_type: str) -> BlobWriter:
        blob = self._bucket.blob(filename)
        writer = blob.open("w", content_type=content_type)
        return GCSBlobWriter(writer)


class GCSBucketProvider:
    """
    Lazy GCS bucket initialization provider.

    Avoids blocking worker init by deferring bucket connection
    until first use.

    ``credentials_file`` — path to a credentials JSON (ADC or service account).
    When provided, credentials are loaded explicitly and passed to the GCS
    client, bypassing the implicit ``google.auth.default()`` lookup chain.
    """

    def __init__(
        self,
        project_id: Optional[str] = None,
        bucket_name: Optional[str] = None,
        credentials_file: Optional[str] = None,
    ):
        self.project_id = project_id
        self.bucket_name = bucket_name
        self.credentials_file = credentials_file
        self._bucket: Optional[StorageBucket] = None
        self._attempted = False

    def _load_credentials(self):
        """Load credentials explicitly from ``credentials_file``.

        Supports both ADC (OAuth2 user) and service-account JSON formats via
        ``google.auth.load_credentials_from_file``.
        Returns the credentials object, refreshed and ready to use.
        """
        creds, _ = load_credentials_from_file(
            self.credentials_file,
            scopes=['https://www.googleapis.com/auth/cloud-platform'],
        )
        if not creds.valid:
            creds.refresh(GoogleAuthRequest())
        return creds

    def get_bucket(self) -> Optional[StorageBucket]:
        if self._attempted:
            return self._bucket

        self._attempted = True

        if not self.project_id or not self.bucket_name:
            logger.warning(
                f"GCS not configured - project_id={'set' if self.project_id else 'missing'}, "
                f"bucket_name={'set' if self.bucket_name else 'missing'}"
            )
            return None

        try:
            logger.info(f"Initializing GCS client for project: {self.project_id}")
            if self.credentials_file:
                logger.info(f"GCS: loading credentials explicitly from {self.credentials_file}")
                creds = self._load_credentials()
                storage_client = storage.Client(project=self.project_id, credentials=creds)
            else:
                # Fall back to ambient credentials (GOOGLE_APPLICATION_CREDENTIALS / metadata server)
                storage_client = storage.Client(project=self.project_id)
            self._bucket = GCSStorageBucket(storage_client.bucket(self.bucket_name))
            logger.info(f"GCS bucket ready: {self.bucket_name}")
        except Exception as e:
            logger.error(f"Failed to initialize GCS bucket: {e}", exc_info=True)
            self._bucket = None

        return self._bucket
