/**
 * Enrollment Event Constants
 * Defines all enrollment funnel and error events for tracking
 */

export const EnrollmentEvent = {
  // App lifecycle
  APP_OPENED: 'app_opened',
  MTLS_FRONTEND_LOAD: 'mtls_frontend_load',

  MTLS_FRONTEND_LOAD_FAILED: 'mtls_frontend_load_failed',
  
  // Enrollment funnel
  FIRST_TIME_SIGNUP_START: 'first_time_signup_start',
  DASHBOARD_LOAD: 'dashboard_load',
  KEY_GENERATION_START: 'key_generation_start',
  KEY_GENERATION_SUCCESS: 'key_generation_success',
  KEY_GENERATION_FAILED: 'key_generation_failed',
  CSR_GENERATION_SUCCESS: 'csr_generation_success',
  CSR_GENERATION_FAILED: 'csr_generation_failed',
  ROOT_CA_INSTALL_START: 'root_ca_install_start',
  ROOT_CA_INSTALL_SUCCESS: 'root_ca_install_success',
  ROOT_CA_INSTALL_FAILED: 'root_ca_install_failed',
  CERTIFICATE_IMPORT_START: 'certificate_import_start',
  CERTIFICATE_IMPORT_SUCCESS: 'certificate_import_success',
  CERTIFICATE_STORAGE_FAILED: 'certificate_storage_failed',
  USER_CANCELLED_ENROLLMENT: 'user_cancelled_enrollment',
  ENROLLMENT_SUCCESS: 'enrollment_success',
  
  // Identity management
  IDENTITY_CHECK: 'identity_check',
  IDENTITY_DELETED: 'identity_deleted',
  IDENTITY_NOT_FOUND: 'identity_not_found',
  IDENTITY_DELETE_FAILED: 'identity_delete_failed',
  DEVICE_INFO_REQUESTED: 'device_info_requested',
  
  // Login
  MTLS_AUTH_SUCCESS: 'mtls_auth_successful',
  AUTH_EXCHANGE_START: 'auth_exchange_start',
  AUTH_EXCHANGE_SUCCESS: 'auth_exchange_success',
  AUTH_EXCHANGE_FAILED: 'auth_exchange_failed',

  HEALTH_CHECK_SUCCESS: 'health_check_success',
  HEALTH_CHECK_FAILURE: 'health_check_failure',

  DEEP_LINK_OPENED: 'deep_link_opened',
  DEEP_LINK_HANDLING_FAILED: 'deep_link_handling_failed',

  LOAD_URL: 'load_url',
  LOAD_URL_RETRY: 'load_url_retry',
  URL_LOAD_FAILED: 'url_load_failed',

  // Errors and edge cases
  PARTIAL_ENROLLMENT_DETECTED: 'partial_enrollment_detected',
  CERTIFICATE_EXPIRED: 'certificate_expired',
  CERTIFICATE_INVALID: 'certificate_invalid',
  CERTIFICATE_REVOKED: 'certificate_revoked',
  SSL_ERROR: 'ssl_error',
  NETWORK_ERROR: 'network_error',
  UNKNOWN_ERROR: 'unknown_error',



  // OpenTelemetry
  OTEL_INIT_SUCCESS: 'otel_init_success',
  OTEL_INIT_FAILED: 'otel_init_failed',
  OTEL_METRIC_ERROR: 'otel_metric_error',
  OTEL_SHUTDOWN_SUCCESS: 'otel_shutdown_success',
  OTEL_SHUTDOWN_FAILED: 'otel_shutdown_failed',
  OTEL_NO_PROVIDER: 'otel_no_provider',
  
} as const;

export type EnrollmentEventType = (typeof EnrollmentEvent)[keyof typeof EnrollmentEvent];