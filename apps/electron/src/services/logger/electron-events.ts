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
    MEETING_DETECTION_ENABLED: 'meeting_detection_enabled',
    MEETING_DETECTION_DISABLED: 'meeting_detection_disabled',
    MEETING_MIC_ACTIVE: 'meeting_mic_active',
    MEETING_MIC_INACTIVE: 'meeting_mic_inactive',
    MEETING_APP_UNIDENTIFIED: 'meeting_app_unidentified',
    MEETING_SCREEN_RECORDING_IGNORED: 'meeting_screen_recording_ignored',
    MEETING_NON_MEETING_APP_IGNORED: 'meeting_non_meeting_app_ignored',
    MEETING_APP_IDENTIFIED: 'meeting_app_identified',
    MEETING_POPUP_SHOWN: 'meeting_popup_shown',
    MEETING_POPUP_SKIPPED_LOGGED_OUT: 'meeting_popup_skipped_logged_out',
    MEETING_POPUP_SKIPPED_RECORDING: 'meeting_popup_skipped_recording',
    MEETING_POPUP_DISMISSED: 'meeting_popup_dismissed',
    MEETING_POPUP_START_RECORDING: 'meeting_popup_start_recording',
    MEETING_POPUP_HIDDEN: 'meeting_popup_hidden',

    // UI Update events
    UI_UPDATE_CHECK_START: 'ui_update_check_start',
    UI_UPDATE_CHECK_FAILED: 'ui_update_check_failed',
    UI_UPDATE_AVAILABLE: 'ui_update_available',
    UI_UPDATE_NOT_AVAILABLE: 'ui_update_not_available',
    UI_UPDATE_DOWNLOAD_START: 'ui_update_download_start',
    UI_UPDATE_DOWNLOAD_FAILED: 'ui_update_download_failed',
    UI_UPDATE_DOWNLOAD_COMPLETE: 'ui_update_download_complete',

    SET_PENDING_INVITATION_COOKIE: 'set_pending_invitation_cookie',
    // Cookie events
    COOKIES_CLEARED: 'cookies_cleared',
    COOKIES_CLEAR_FAILED: 'cookies_clear_failed',

    // Security guard rail events
    OPEN_EXTERNAL_BLOCKED: 'open_external_blocked',
    DEEP_LINK_INVITATION_REJECTED: 'deep_link_invitation_rejected',
    DEEP_LINK_PARAM_REJECTED: 'deep_link_param_rejected',
    AGENT_AUTH_PEER_MISMATCH: 'agent_auth_peer_mismatch',
    AGENT_AUTH_COOLDOWN_BLOCKED: 'agent_auth_cooldown_blocked',
    } as const;

export type ElectronEventType = (typeof ElectronEvent)[keyof typeof ElectronEvent];

export default ElectronEvent;