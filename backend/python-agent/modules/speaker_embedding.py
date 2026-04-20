"""
Speaker embedding model — lazy-loaded singleton.

Wraps pyannote/wespeaker-voxceleb-resnet34-LM and exposes:
  - get_embedding_inference()  → pyannote Inference instance (whole-clip mode)
                                 Used by embed_voice for enrollment.
  - compute_embedding(waveform, sample_rate) → numpy (256,) unit vector
                                 Sliding-window mean, L2-normalised — the
                                 robust enrollment algorithm.

Both enrollment (/embed-voice) and diarization (/diarize crop+infer fallback)
import from here so the model is only loaded once across the whole process.
"""
import os
import logging

logger = logging.getLogger(__name__)

_embedding_inference = None  # pyannote Inference instance, window="whole"


def get_embedding_inference():
    """
    Lazy-load the WeSpeaker ResNet34-LM speaker embedding model.
    First call takes ~3-5 s (download + load); subsequent calls return instantly.
    Thread-safe for asyncio (single-threaded event loop).
    """
    global _embedding_inference
    if _embedding_inference is not None:
        return _embedding_inference

    try:
        import torch
        from pyannote.audio import Model, Inference

        hf_token = os.getenv("HUGGINGFACE_TOKEN") or os.getenv("HF_TOKEN")
        if not hf_token:
            raise ValueError("HUGGINGFACE_TOKEN env var not set")

        model = Model.from_pretrained(
            "pyannote/wespeaker-voxceleb-resnet34-LM",
            token=hf_token,
        )
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model.to(torch.device(device))
        # window="whole" is used directly by crop+infer in diarization;
        # the sliding-window logic in compute_embedding uses a separate
        # Inference instance created on-the-fly from the same model.
        _embedding_inference = Inference(model, window="whole")
        logger.info(f"Speaker embedding model loaded on {device}")
    except Exception as e:
        logger.error(f"Failed to load speaker embedding model: {e}")
        raise

    return _embedding_inference


def compute_enrollment_embedding(waveform, sample_rate: int = 16000):
    """
    Produce a single robust 256-dim L2-normalised embedding from an audio clip
    using the sliding-window mean algorithm.

    Algorithm:
      1. Run WeSpeaker with window="sliding" (3 s window, 1 s step).
      2. L2-normalise every window embedding → equal weight on unit hypersphere.
      3. Mean-pool the normalised vectors → geometric centroid.
      4. L2-normalise the mean → result is back on the unit hypersphere.

    This is more robust than a single whole-clip embedding because noise,
    silence, or an awkward phoneme in one window gets averaged out.

    Args:
        waveform:    torch.Tensor shape (1, N) float32, 16 kHz mono.
        sample_rate: int, must be 16000.

    Returns:
        tuple: (embedding, n_windows)
          - embedding: numpy.ndarray shape (256,), dtype float32, unit vector.
          - n_windows: int, number of 3-second sliding windows used.
    """
    import numpy as np
    from pyannote.audio import Inference

    inference_whole = get_embedding_inference()
    model = inference_whole.model  # reuse already-loaded model — no overhead

    sliding = Inference(model, window="sliding", duration=3.0, step=1.0)
    sliding_embeddings = sliding({"waveform": waveform, "sample_rate": sample_rate})
    # SlidingWindowFeature → (N, 256) numpy array
    vecs = sliding_embeddings.data

    if len(vecs) == 0:
        raise ValueError("No embedding windows produced — audio may be silent or too short")

    # L2-normalise each window
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    norms = np.where(norms < 1e-9, 1.0, norms)
    vecs_normalised = vecs / norms

    # Mean-pool + re-normalise
    mean_vec = vecs_normalised.mean(axis=0)
    mean_norm = np.linalg.norm(mean_vec)
    if mean_norm < 1e-9:
        raise ValueError("Embedding collapsed to zero — audio may be silent")

    return (mean_vec / mean_norm).astype(np.float32), len(vecs)
