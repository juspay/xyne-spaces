"""Google Cloud credentials for Speech-to-Text.

A service-account key is optional. Without one, the agent uses Application Default
Credentials: on GKE with Workload Identity that is the pod's Google service account,
served by the metadata server, so there is no key to mount or leak.

Order:
1. GOOGLE_VOICE_CREDENTIALS_JSON (inline key), if set.
2. The key file named by GOOGLE_APPLICATION_CREDENTIALS, if set.
3. Application Default Credentials (Workload Identity, gcloud ADC locally).
"""
import json
import os
import threading
import time
from typing import Any, Optional, Tuple

import google.auth
from google.auth import load_credentials_from_dict
from google.auth.exceptions import DefaultCredentialsError

from .logging import get_logger

logger = get_logger(__name__)

SCOPES = ['https://www.googleapis.com/auth/cloud-platform']

# How long a failed ADC lookup is remembered before trying again. Off GCP the lookup
# probes the metadata server, which can take seconds; don't repeat it on every call.
_ADC_RETRY_AFTER_SECONDS = 300.0

_adc_lock = threading.Lock()
_adc_result: Optional[Tuple[Any, Optional[str]]] = None
_adc_failed_at: Optional[float] = None


def load_google_key(credentials_json: Optional[str]) -> Optional[dict]:
    """The service-account key, if one is configured; None means use ADC."""
    if credentials_json:
        try:
            return json.loads(credentials_json) if isinstance(credentials_json, str) else credentials_json
        except json.JSONDecodeError as e:
            raise ValueError(f'Invalid GOOGLE_VOICE_CREDENTIALS_JSON: {e}') from e

    credentials_file = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
    if credentials_file:
        try:
            with open(credentials_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            raise ValueError(f'Failed to read GOOGLE_APPLICATION_CREDENTIALS: {e}') from e

    return None


def _application_default_credentials() -> Optional[Tuple[Any, Optional[str]]]:
    """(credentials, project_id) from ADC, or None if there are none. Cached per process."""
    global _adc_result, _adc_failed_at
    with _adc_lock:
        if _adc_result is not None:
            return _adc_result
        if _adc_failed_at is not None and time.monotonic() - _adc_failed_at < _ADC_RETRY_AFTER_SECONDS:
            return None
        try:
            _adc_result = google.auth.default(scopes=SCOPES)
            _adc_failed_at = None
            logger.info(f'[google] Using Application Default Credentials | project={_adc_result[1]}')
            return _adc_result
        except DefaultCredentialsError as e:
            _adc_failed_at = time.monotonic()
            logger.info(f'[google] No Application Default Credentials: {e}')
            return None


def google_stt_available(credentials_json: Optional[str]) -> bool:
    """Whether Google STT has credentials: a configured key, or ADC (Workload Identity)."""
    try:
        if load_google_key(credentials_json) is not None:
            return True
    except ValueError as e:
        logger.error(f'[google] {e}')
        return False
    return _application_default_credentials() is not None


def google_credentials(credentials_json: Optional[str], fallback_project_id: Optional[str]) -> Tuple[Any, str]:
    """(credentials, project_id) for Speech-to-Text REST and gRPC clients.

    The project comes from the key, else from ADC (on GKE: the cluster's project), else
    from fallback_project_id (GCS_PROJECT_ID).
    """
    key = load_google_key(credentials_json)
    if key is not None:
        creds, _ = load_credentials_from_dict(key, scopes=SCOPES)
        project_id = key.get('project_id') or fallback_project_id
    else:
        adc = _application_default_credentials()
        if adc is None:
            raise ValueError(
                'Google STT has no credentials: use Workload Identity (or gcloud ADC locally), '
                'or set GOOGLE_VOICE_CREDENTIALS_JSON'
            )
        creds, adc_project = adc
        project_id = adc_project or fallback_project_id

    if not project_id:
        raise ValueError('Google STT requires a project_id: set GCS_PROJECT_ID or GOOGLE_CLOUD_PROJECT')
    return creds, project_id
