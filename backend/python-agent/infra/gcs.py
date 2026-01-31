"""
Google Cloud Storage bucket provider
"""
import logging
from typing import Optional
from google.cloud import storage

logger = logging.getLogger(__name__)


class GCSBucketProvider:
    """
    Lazy GCS bucket initialization provider.

    Avoids blocking worker init by deferring bucket connection
    until first use.
    """

    def __init__(self, project_id: Optional[str] = None, bucket_name: Optional[str] = None):
        self.project_id = project_id
        self.bucket_name = bucket_name
        self._bucket = None
        self._attempted = False

    def get_bucket(self) -> Optional[storage.Bucket]:
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
            storage_client = storage.Client(project=self.project_id)
            self._bucket = storage_client.bucket(self.bucket_name)
            logger.info(f"GCS bucket ready: {self.bucket_name}")
        except Exception as e:
            logger.error(f"Failed to initialize GCS bucket: {e}", exc_info=True)
            self._bucket = None

        return self._bucket
