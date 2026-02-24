"""
Pre-download required AI models using LiveKit's official plugin system.
This ensures all required files (including languages.json) are downloaded.
"""
import sys

def download_models():
    """Download all required models during Docker build using LiveKit's plugin system."""
    
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

if __name__ == "__main__":
    download_models()
