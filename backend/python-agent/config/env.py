"""Environment configuration"""
import os
from dotenv import load_dotenv
from dataclasses import dataclass
from typing import Optional


@dataclass
class Config:
    """Application configuration loaded from environment variables"""
    
    # LiveKit Configuration
    livekit_url: str
    livekit_api_key: str
    livekit_api_secret: str
    agent_livekit_url: Optional[str]
    
    # Azure OpenAI STT Configuration
    azure_stt_endpoint: str
    azure_stt_api_key: str
    azure_stt_api_version: str
    azure_stt_model: str
    
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
    
    # VAD Configuration
    vad_activation_threshold: float
    vad_min_speech_duration: float
    vad_min_silence_duration: float
    vad_max_buffered_speech: float
    
    # Debug Configuration
    debug_audio_storage: bool
    debug_audio_storage_path: str
    
    # GCS Configuration
    gcs_project_id: Optional[str]
    gcs_bucket_name: Optional[str]
    
    # Backend API Configuration
    backend_url: str
    transcription_agent_api_key: str
    
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
    restore_last_n_messages: int = 5
    
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
            ai_voice_enabled_default=os.getenv("AI_VOICE_ENABLED_DEFAULT", "false").lower() == "true",
            
            # VAD Configuration
            vad_activation_threshold=float(os.getenv("VAD_ACTIVATION_THRESHOLD", "0.45")),
            vad_min_speech_duration=float(os.getenv("VAD_MIN_SPEECH_DURATION", "0.15")),
            vad_min_silence_duration=float(os.getenv("VAD_MIN_SILENCE_DURATION", "0.4")),
            vad_max_buffered_speech=float(os.getenv("VAD_MAX_BUFFERED_SPEECH", "5.0")),
            
            # Debug Configuration
            debug_audio_storage=os.getenv("DEBUG_AUDIO_STORAGE", "false").lower() == "true",
            debug_audio_storage_path=os.getenv("DEBUG_AUDIO_STORAGE_PATH", "/tmp/xyne-audio-debug"),
            
            # GCS
            gcs_project_id=os.getenv("GCS_PROJECT_ID"),
            gcs_bucket_name=os.getenv("TRANSCRIPTION_BUCKET_NAME") or os.getenv("GCS_BUCKET_NAME"),
            
            # Backend API
            backend_url=os.getenv("BACKEND_URL", "http://localhost:3001"),
            transcription_agent_api_key=os.getenv("TRANSCRIPTION_AGENT_API_KEY"),
            
            # Redis (matching TypeScript: REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_TLS)
            redis_host=os.getenv("REDIS_HOST", "localhost"),
            redis_port=int(os.getenv("REDIS_PORT", "6379")),
            redis_password=os.getenv("REDIS_PASSWORD"),  # None if not set
            redis_tls=os.getenv("REDIS_TLS", "false").lower() == "true",
            
            # Environment
            node_env=node_env,
            is_development=node_env == "development",
        )
