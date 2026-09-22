"""Environment configuration"""
import os
from dotenv import load_dotenv
from dataclasses import dataclass
from typing import Optional


def _get_bool_env(name: str, default: bool = False) -> bool:
    """Parse common boolean env values."""
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


@dataclass
class Config:
    """Application configuration loaded from environment variables"""
    
    # LiveKit Configuration
    livekit_url: str
    livekit_api_key: str
    livekit_api_secret: str
    agent_livekit_url: Optional[str]
    
    # Azure OpenAI STT Configuration
    azure_stt_endpoint: Optional[str]
    azure_stt_api_key: Optional[str]
    azure_stt_api_version: Optional[str]
    azure_stt_model: Optional[str]

    # STT Provider: 'azure' (default) or 'chutes'
    stt_provider: str
    
    # Chutes.ai STT Configuration 
    chutes_stt_base_url: Optional[str]
    chutes_stt_api_key: Optional[str]

    # STT Provider Configuration (google, azure, or deepgram)
    stt_model: str  # 'google', 'azure', or 'deepgram'
    voice_input_stt_model: str  # STT provider for voice-input dictation flow (overrides stt_model for this path)
    google_voice_credentials_json: Optional[str]
    google_stt_model: str  # Model for Google STT (e.g., chirp_3)
    google_stt_stream_model: str  # Model for Google STT streaming (chirp_3 does not support streaming+adaptation)
    google_stt_language: str
    google_stt_location: str  # Region for Google STT (chirp models require e.g. us-central1, not global)
    google_stt_stream_location: str  # Region for streaming STT — chirp_2 is not in the "us" multi-region
    
    # Deepgram STT Configuration
    deepgram_api_key: Optional[str]
    deepgram_model: str  # Model for Deepgram STT (e.g., nova-3, flux-general-en)
    deepgram_language: str
    
    # Azure OpenAI TTS Configuration
    azure_tts_endpoint: str
    azure_tts_api_key: str
    azure_tts_api_version: str
    azure_tts_deployment: str
    azure_tts_voice: str
    
    # Azure OpenAI LLM Configuration
    azure_openai_endpoint: str
    azure_openai_api_key: str
    azure_openai_api_version: str
    azure_openai_model: str
    
    # AI Voice Configuration
    ai_voice_enabled_default: bool

    # Speaker diarization / identification
    diarization_enabled: bool
    
    # VAD Configuration
    vad_activation_threshold: float
    vad_min_speech_duration: float
    vad_min_silence_duration: float
    vad_max_buffered_speech: float
    
    # Debug Configuration
    debug_audio_storage: bool
    debug_audio_storage_path: str
    
    # Storage Provider ('gcs' or 's3')
    storage_provider: str

    # GCS Configuration
    gcs_project_id: Optional[str]
    gcs_bucket_name: Optional[str]
    gcs_credentials_path: Optional[str]

    # S3 Configuration
    s3_bucket_name: Optional[str]
    s3_region: str
    s3_access_key_id: Optional[str]
    s3_secret_access_key: Optional[str]
    s3_endpoint: Optional[str]
    
    # Backend API Configuration
    backend_url: str
    transcription_agent_api_key: str
    # LiveKit explicit-dispatch identity for this pod — which agentName the backend can
    # target with createDispatch. Which role this build serves is decided outside this
    # process entirely now (a human-edited Superposition config), not self-reported.
    transcription_agent_name: str

    # Redis Configuration (matching TypeScript backend)
    redis_host: str
    redis_port: int
    redis_password: Optional[str]
    redis_tls: bool
    
    # Environment
    node_env: str
    is_development: bool
    
    # Conversation History Settings
    max_conversation_history: int = 50
    conversation_ttl: int = 86400  # 24 hours
    restore_last_n_messages: int = 30

    # Transcript Incremental Flush
    # Upload the in-memory transcript buffer to GCS every N transcription events so a
    # crash / OOM / forced restart loses at most N events. Event-count based (no idle
    # time-based writes). Set to 0 to disable (flush only on call end / cleanup).
    transcript_flush_every_n: int = 5

    # Transcript Base-Load Retry (rejoin data-loss guard)
    # When a session rejoins a call, the prior transcript is downloaded once and every
    # subsequent full-object upload re-includes it. A *failed* read (transient GCS blip)
    # is NOT the same as "no prior transcript": treating it as empty would overwrite and
    # destroy the earlier session's transcript. So a read that errors (or fails to
    # connect) is retried up to this many times with exponential backoff (capped below).
    # Only after all retries are exhausted do we accept the loss and start fresh.
    transcript_base_load_max_retries: int = 5
    transcript_base_load_backoff_cap_s: float = 5.0
    
    @classmethod
    def load(cls) -> 'Config':
        """Load configuration from environment variables"""
        # Store AGENT_LIVEKIT_URL before loading .env (to prevent override)
        agent_livekit_url = os.getenv("AGENT_LIVEKIT_URL")
        
        # Load environment variables from .env file
        load_dotenv()
        
        # Use AGENT_LIVEKIT_URL if available (for Docker), otherwise fall back to LIVEKIT_URL
        livekit_url = agent_livekit_url or os.getenv("LIVEKIT_URL") or "ws://livekit:7880"
        
        node_env = os.getenv("NODE_ENV", "development")
        
        return cls(
            # LiveKit
            livekit_url=livekit_url,
            livekit_api_key=os.getenv("LIVEKIT_API_KEY", ""),
            livekit_api_secret=os.getenv("LIVEKIT_API_SECRET", ""),
            agent_livekit_url=agent_livekit_url,
            
            # Azure OpenAI STT
            azure_stt_endpoint=os.getenv("AZURE_OPENAI_STT_ENDPOINT", ""),
            azure_stt_api_key=os.getenv("AZURE_OPENAI_STT_API_KEY", ""),
            azure_stt_api_version=os.getenv("AZURE_OPENAI_STT_API_VERSION", ""),
            azure_stt_model=os.getenv("AZURE_OPENAI_STT_MODEL", ""),

            # STT Provider: 'azure' (default) or 'chutes'
            stt_provider=os.getenv("STT_PROVIDER", "azure").lower(),
            
            # Chutes.ai STT
            chutes_stt_base_url=os.getenv("CHUTES_STT_BASE_URL"),
            chutes_stt_api_key=os.getenv("CHUTES_STT_API_KEY"),

            # STT Provider Configuration (google, azure, or deepgram, default: azure)
            stt_model=os.getenv("STT_MODEL", "azure").lower(),
            voice_input_stt_model=os.getenv("VOICE_INPUT_STT_MODEL", os.getenv("STT_MODEL", "azure")).lower(),
            google_voice_credentials_json=os.getenv("GOOGLE_VOICE_CREDENTIALS_JSON"),
            google_stt_model=os.getenv("GOOGLE_STT_MODEL", "chirp_3"),
            google_stt_stream_model=os.getenv("GOOGLE_STT_STREAM_MODEL", "chirp_2"),
            google_stt_language=os.getenv("GOOGLE_STT_LANGUAGE", "en-US"),
            google_stt_location=os.getenv("GOOGLE_STT_LOCATION", "us"),
            google_stt_stream_location=os.getenv("GOOGLE_STT_STREAM_LOCATION", "us-central1"),
            
            # Deepgram STT
            deepgram_api_key=os.getenv("DEEPGRAM_API_KEY"),
            deepgram_model=os.getenv("DEEPGRAM_MODEL", "nova-3"),
            deepgram_language=os.getenv("DEEPGRAM_LANGUAGE", "en-US"),
            
            # Azure OpenAI TTS
            azure_tts_endpoint=os.getenv("AZURE_OPENAI_TTS_ENDPOINT", ""),
            azure_tts_api_key=os.getenv("AZURE_OPENAI_TTS_API_KEY", ""),
            azure_tts_api_version=os.getenv("AZURE_OPENAI_TTS_API_VERSION", "2025-03-01-preview"),
            azure_tts_deployment=os.getenv("AZURE_OPENAI_TTS_DEPLOYMENT", "gpt-4o-mini-tts"),
            azure_tts_voice=os.getenv("AZURE_OPENAI_TTS_VOICE", "shimmer"),
            
            # Azure OpenAI LLM
            azure_openai_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT", ""),
            azure_openai_api_key=os.getenv("AZURE_OPENAI_API_KEY", ""),
            azure_openai_api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-10-21"),
            azure_openai_model=os.getenv("AZURE_OPENAI_MODEL", "gpt-4o"),
            
            # AI Voice
            ai_voice_enabled_default=_get_bool_env("AI_VOICE_ENABLED_DEFAULT", False),

            # Speaker diarization / identification
            diarization_enabled=_get_bool_env("DIARIZATION_ENABLED", False),
            
            # VAD Configuration
            vad_activation_threshold=float(os.getenv("VAD_ACTIVATION_THRESHOLD", "0.45")),
            vad_min_speech_duration=float(os.getenv("VAD_MIN_SPEECH_DURATION", "0.15")),
            vad_min_silence_duration=float(os.getenv("VAD_MIN_SILENCE_DURATION", "0.4")),
            vad_max_buffered_speech=float(os.getenv("VAD_MAX_BUFFERED_SPEECH", "5.0")),
            
            # Debug Configuration
            debug_audio_storage=_get_bool_env("DEBUG_AUDIO_STORAGE", False),
            debug_audio_storage_path=os.getenv("DEBUG_AUDIO_STORAGE_PATH", "/tmp/xyne-audio-debug"),
            
            # Storage provider
            storage_provider=os.getenv("STORAGE_PROVIDER", "gcs").lower(),
            
            # GCS
            gcs_project_id=os.getenv("GCS_PROJECT_ID"),
            gcs_bucket_name=os.getenv("TRANSCRIPTION_BUCKET_NAME") or os.getenv("GCS_BUCKET_NAME"),
            gcs_credentials_path=os.getenv("GCS_CREDENTIALS_PATH"),

            # S3
            s3_bucket_name=os.getenv("S3_BUCKET_NAME") or os.getenv("TRANSCRIPTION_BUCKET_NAME"),
            s3_region=os.getenv("AWS_REGION", "ap-south-1"),
            s3_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            s3_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            s3_endpoint=os.getenv("S3_ENDPOINT"),
            
            # Backend API
            backend_url=os.getenv("BACKEND_URL", "http://localhost:3001"),
            transcription_agent_api_key=os.getenv("TRANSCRIPTION_AGENT_API_KEY"),
            transcription_agent_name=os.getenv("LIVEKIT_TRANSCRIPTION_AGENT_NAME", "xyne-automatic"),

            # Redis (matching TypeScript: REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_TLS)
            redis_host=os.getenv("REDIS_HOST", "localhost"),
            redis_port=int(os.getenv("REDIS_PORT", "6379")),
            redis_password=os.getenv("REDIS_PASSWORD"),  # None if not set
            redis_tls=_get_bool_env("REDIS_TLS", False),
            
            # Transcript incremental flush cadence (events per GCS upload)
            transcript_flush_every_n=int(os.getenv("TRANSCRIPT_FLUSH_EVERY_N_EVENTS", "5")),

            # Rejoin base-load retry: how hard to retry reading the prior transcript
            # before accepting data loss and overwriting it.
            transcript_base_load_max_retries=int(os.getenv("TRANSCRIPT_BASE_LOAD_MAX_RETRIES", "5")),
            transcript_base_load_backoff_cap_s=float(os.getenv("TRANSCRIPT_BASE_LOAD_BACKOFF_CAP_S", "5.0")),

            # Environment
            node_env=node_env,
            is_development=node_env == "development",
        )
