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
    
    # Download Turn Detector model files (ONNX model, tokenizer, languages.json)
    # This uses LiveKit's official download mechanism
    print("Downloading Turn Detector model...")
    try:
        from livekit.plugins.turn_detector.multilingual import _EUORunnerMultilingual
        _EUORunnerMultilingual._download_files()
        print("✓ Turn Detector model downloaded successfully")
    except Exception as e:
        print(f"⚠ Warning: Turn Detector download failed: {e}")
        print("  Model will be downloaded at runtime")
    
    # Download Silero VAD model
    print("Downloading Silero VAD model...")
    try:
        from livekit.plugins import silero
        _ = silero.VAD.load()
        print("✓ Silero VAD model downloaded successfully")
    except Exception as e:
        print(f"⚠ Warning: Silero VAD download failed: {e}")
        print("  Model will be downloaded at runtime")

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
