"""
Download LiveKit models during Docker build
Pre-downloads Silero VAD model to /root/.cache/huggingface/
"""
import os
from livekit.plugins import silero

if __name__ == "__main__":
    print("Downloading Silero VAD model...")
    vad = silero.VAD.load()
    print(f"✓ Silero VAD model downloaded successfully")
    
    # Verify cache directory exists
    cache_dir = os.path.expanduser("~/.cache/huggingface/hub")
    if os.path.exists(cache_dir):
        print(f"✓ Cache directory exists: {cache_dir}")
        # List downloaded files
        for root, dirs, files in os.walk(cache_dir):
            for f in files:
                if f.endswith('.onnx'):
                    print(f"  Found model: {os.path.join(root, f)}")
    else:
        print(f"⚠ Warning: Cache directory not found at {cache_dir}")
