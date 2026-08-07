"""
Pre-download required AI models using LiveKit's official plugin system.
This ensures all required files (including languages.json) are downloaded.
"""
import os


def _get_bool_env(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def download_models():
    """Download all required models during Docker build using LiveKit's plugin system."""
    diarization_enabled = _get_bool_env("DIARIZATION_ENABLED", False)

    print(
        "Model download configuration: "
        f"DIARIZATION_ENABLED={diarization_enabled}"
    )

    # Download the Transformers checkpoint but skip the duplicate NeMo archive.
    # The Dockerfile separately invokes LiveKit's supported plugin downloader
    # (`python -m livekit.agents download-files`) for Silero VAD + turn detector.
    local_stt_enabled = _get_bool_env("LOCAL_STT_ENABLED", True)
    if local_stt_enabled:
        model_id = os.getenv(
            "LOCAL_STT_MODEL",
            "nvidia/nemotron-3.5-asr-streaming-0.6b",
        )
        print(f"Downloading local STT model: {model_id}")
        try:
            from huggingface_hub import snapshot_download

            snapshot_download(
                repo_id=model_id,
                allow_patterns=["*.json", "*.safetensors"],
            )
            print("✓ Local STT model downloaded successfully")
        except Exception as e:
            print(f"⚠ Warning: local STT model download failed: {e}")
            print("  Model will be downloaded on first local transcription")
    else:
        print("Skipping local STT model download: LOCAL_STT_ENABLED=false")

    # Download WeSpeaker speaker embedding model only when diarization is enabled.
    if not diarization_enabled:
        print("Skipping WeSpeaker speaker embedding model download: DIARIZATION_ENABLED=false")
    else:
        print("Downloading WeSpeaker speaker embedding model...")
        try:
            from modules.speaker_embedding import get_embedding_inference
            get_embedding_inference()
            print("✓ WeSpeaker embedding model downloaded and cached")
        except Exception as e:
            print(f"⚠ Warning: WeSpeaker model download failed: {e}")
            print("  Model will be downloaded on first enrollment or diarization request")

if __name__ == "__main__":
    download_models()
