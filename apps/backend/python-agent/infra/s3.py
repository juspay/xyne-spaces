"""
AWS S3 storage bucket provider
"""
import io
import logging
from typing import Optional

import boto3
from botocore.config import Config as BotoConfig
from config import get_logger
from .storage_base import StorageBucket, BlobWriter

logger = get_logger(__name__)


class S3BlobWriter(BlobWriter):
    """
    S3 streaming writer using multipart upload.

    Buffers writes and uploads as multipart parts when buffer exceeds threshold.
    Minimum part size for S3 multipart is 5MB, so we buffer up to that.
    """

    MIN_PART_SIZE = 5 * 1024 * 1024  # 5MB minimum for S3 multipart

    def __init__(self, s3_client, bucket_name: str, key: str, content_type: str):
        self._s3 = s3_client
        self._bucket = bucket_name
        self._key = key
        self._buffer = io.StringIO()
        self._content_type = content_type
        self._parts = []
        self._part_number = 1

        # Start multipart upload
        response = self._s3.create_multipart_upload(
            Bucket=self._bucket,
            Key=self._key,
            ContentType=self._content_type,
        )
        self._upload_id = response['UploadId']

    def write(self, data: str) -> None:
        self._buffer.write(data)

    def flush(self) -> None:
        content = self._buffer.getvalue()
        if len(content.encode('utf-8')) >= self.MIN_PART_SIZE:
            self._upload_part(content)
            self._buffer = io.StringIO()

    def _upload_part(self, content: str) -> None:
        if not content:
            return
        response = self._s3.upload_part(
            Bucket=self._bucket,
            Key=self._key,
            PartNumber=self._part_number,
            UploadId=self._upload_id,
            Body=content.encode('utf-8'),
        )
        self._parts.append({
            'PartNumber': self._part_number,
            'ETag': response['ETag'],
        })
        self._part_number += 1

    def close(self) -> None:
        # Upload any remaining buffered content
        remaining = self._buffer.getvalue()

        if self._parts or remaining:
            if remaining:
                self._upload_part(remaining)

            if self._parts:
                self._s3.complete_multipart_upload(
                    Bucket=self._bucket,
                    Key=self._key,
                    UploadId=self._upload_id,
                    MultipartUpload={'Parts': self._parts},
                )
            else:
                # No parts uploaded, abort multipart and do a simple put
                self._s3.abort_multipart_upload(
                    Bucket=self._bucket,
                    Key=self._key,
                    UploadId=self._upload_id,
                )
        else:
            # Nothing was written, abort the multipart upload
            self._s3.abort_multipart_upload(
                Bucket=self._bucket,
                Key=self._key,
                UploadId=self._upload_id,
            )


class S3StorageBucket(StorageBucket):
    """S3 implementation of StorageBucket."""

    def __init__(self, s3_client, bucket_name: str):
        self._s3 = s3_client
        self._bucket_name = bucket_name

    @property
    def name(self) -> str:
        return self._bucket_name

    def blob_exists(self, filename: str) -> bool:
        try:
            self._s3.head_object(Bucket=self._bucket_name, Key=filename)
            return True
        except self._s3.exceptions.ClientError as e:
            if e.response['Error']['Code'] == '404':
                return False
            raise

    def download_as_bytes(self, filename: str) -> bytes:
        response = self._s3.get_object(Bucket=self._bucket_name, Key=filename)
        return response['Body'].read()

    def upload_from_string(self, filename: str, content: str, content_type: str) -> None:
        self._s3.put_object(
            Bucket=self._bucket_name,
            Key=filename,
            Body=content.encode('utf-8'),
            ContentType=content_type,
        )

    def open_writer(self, filename: str, content_type: str) -> BlobWriter:
        return S3BlobWriter(self._s3, self._bucket_name, filename, content_type)


class S3BucketProvider:
    """
    Lazy S3 bucket initialization provider.

    Reads AWS credentials from environment variables:
    - AWS_REGION (default: ap-south-1)
    - AWS_ACCESS_KEY_ID
    - AWS_SECRET_ACCESS_KEY
    - S3_BUCKET_NAME
    - S3_ENDPOINT (optional, for MinIO/LocalStack)
    """

    def __init__(
        self,
        bucket_name: Optional[str] = None,
        region: Optional[str] = None,
        access_key_id: Optional[str] = None,
        secret_access_key: Optional[str] = None,
        endpoint_url: Optional[str] = None,
    ):
        self.bucket_name = bucket_name
        self.region = region or 'ap-south-1'
        self.access_key_id = access_key_id
        self.secret_access_key = secret_access_key
        self.endpoint_url = endpoint_url
        self._bucket: Optional[StorageBucket] = None
        self._attempted = False

    def get_bucket(self) -> Optional[StorageBucket]:
        if self._attempted:
            return self._bucket

        self._attempted = True

        if not self.bucket_name:
            logger.warning("S3 not configured - bucket_name missing")
            return None

        try:
            logger.info(f"Initializing S3 client for region: {self.region}")
            kwargs = {
                'region_name': self.region,
                'config': BotoConfig(retries={'max_attempts': 3, 'mode': 'adaptive'}),
            }
            if self.access_key_id and self.secret_access_key:
                kwargs['aws_access_key_id'] = self.access_key_id
                kwargs['aws_secret_access_key'] = self.secret_access_key
            if self.endpoint_url:
                kwargs['endpoint_url'] = self.endpoint_url

            s3_client = boto3.client('s3', **kwargs)
            self._bucket = S3StorageBucket(s3_client, self.bucket_name)
            logger.info(f"S3 bucket ready: {self.bucket_name}")
        except Exception as e:
            logger.error(f"Failed to initialize S3 bucket: {e}", exc_info=True)
            self._bucket = None

        return self._bucket
