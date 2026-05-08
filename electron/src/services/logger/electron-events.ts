const ElectronEvent = {
    // App lifecycle events
    APP_QUIT: 'app_quit',
    APP_TRANSITION_TO_BACKGROUND: 'app_transition_to_background',
    APP_TRANSITION_TO_FOREGROUND: 'app_transition_to_foreground',
    UNCAUGHT_EXCEPTION: 'uncaught_exception',
    UNHANDLED_REJECTION: 'unhandled_rejection',
    
    // Agent Auth events
    AGENT_AUTH_SERVER_STOP: 'agent_auth_server_stop',
    AGENT_AUTH_SERVER_START_FAILED: 'agent_auth_server_start_failed',
    AGENT_AUTH_REQUEST: 'agent_auth_request',
    AGENT_AUTH_DENIED: 'agent_auth_denied',
    AGENT_AUTH_GRANTED: 'agent_auth_granted',
    
    // Docs Publish events
    DOCS_PUBLISH_SERVER_START: 'docs_publish_server_start',
    DOCS_PUBLISH_SERVER_STARTED: 'docs_publish_server_started',
    DOCS_PUBLISH_SERVER_STOP: 'docs_publish_server_stop',
    DOCS_PUBLISH_SERVER_START_FAILED: 'docs_publish_server_start_failed',
    DOCS_PUBLISH_SERVER_RESTART: 'docs_publish_server_restart',
    DOCS_PUBLISH_REQUEST_RECEIVED: 'docs_publish_request_received',
    DOCS_PUBLISH_GIT_INFO: 'docs_publish_git_info',
    DOCS_PUBLISH_EXISTING_DOC_CHECK: 'docs_publish_existing_doc_check',
    DOCS_PUBLISH_CONFLICT: 'docs_publish_conflict',
    DOCS_PUBLISH_ZIP_CREATE_START: 'docs_publish_zip_create_start',
    DOCS_PUBLISH_ZIP_CREATE_COMPLETE: 'docs_publish_zip_create_complete',
    DOCS_PUBLISH_UPLOAD_START: 'docs_publish_upload_start',
    DOCS_PUBLISH_UPLOAD_SUCCESS: 'docs_publish_upload_success',
    DOCS_PUBLISH_UPLOAD_FAILED: 'docs_publish_upload_failed',
    DOCS_PUBLISH_CLEAR_OUTPUT_DIR: 'docs_publish_clear_output_dir',
    DOCS_PUBLISH_SHARE_TARGETS_REQUEST: 'docs_publish_share_targets_request',
    DOCS_PUBLISH_SHARE_DOC_REQUEST: 'docs_publish_share_doc_request',
    DOCS_PUBLISH_OPEN_TICKET_THREAD: 'docs_publish_open_ticket_thread',
    
    // Memory Proxy events
    MEMORY_SEARCH_REQUEST: 'memory_search_request',
    MEMORY_UPLOAD_REQUEST: 'memory_upload_request',

    // Meeting Detector events
    MEETING_DETECTOR_START: 'meeting_detector_start',
    MEETING_DETECTOR_STOP: 'meeting_detector_stop',
    MEETING_DETECTOR_ERROR: 'meeting_detector_error',
    MEETING_DETECTOR_PROCESS_EXIT: 'meeting_detector_process_exit',
    MEETING_DETECTOR_RESTART: 'meeting_detector_restart',
    MEETING_DETECTED: 'meeting_detected',
    MEETING_ENDED: 'meeting_ended',

    // UI Update events
    UI_UPDATE_CHECK_START: 'ui_update_check_start',
    UI_UPDATE_CHECK_FAILED: 'ui_update_check_failed',
    UI_UPDATE_AVAILABLE: 'ui_update_available',
    UI_UPDATE_NOT_AVAILABLE: 'ui_update_not_available',
    UI_UPDATE_DOWNLOAD_START: 'ui_update_download_start',
    UI_UPDATE_DOWNLOAD_FAILED: 'ui_update_download_failed',
    UI_UPDATE_DOWNLOAD_COMPLETE: 'ui_update_download_complete',

    // Cookie events
    COOKIES_CLEARED: 'cookies_cleared',
    COOKIES_CLEAR_FAILED: 'cookies_clear_failed',
    } as const;

export type ElectronEventType = (typeof ElectronEvent)[keyof typeof ElectronEvent];

export default ElectronEvent;