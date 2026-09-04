/**
 * On-device speaker diarization models (Sherpa-ONNX).
 *
 * Two ONNX files are needed:
 *  - pyannote segmentation-3.0: finds "who is speaking when" turns (handles overlap).
 *  - WeSpeaker ResNet293-LM (English VoxCeleb): speaker embeddings used to cluster
 *    turns into distinct speakers. Largest/most accurate embedding sherpa-onnx
 *    ships for English; ~5x slower than ResNet34-LM (v2) and ~+250 MB peak RAM,
 *    chosen for accuracy over speed. v1 was 3D-Speaker CAM++, which over-split
 *    single voices on real audio. The clustering threshold is model-specific —
 *    see worker.ts.
 *
 * Both are downloaded on demand into userData (never bundled — ~120 MB) and pinned
 * by size + SHA-256 so a corrupt or truncated download can never be loaded.
 * Bump DIARIZATION_MODEL_VERSION whenever a file changes; the service re-downloads
 * when the stored version differs and removes older model directories on launch.
 */

export type DiarizationModelId = 'segmentation' | 'embedding';

export interface DiarizationModelFile {
  id: DiarizationModelId;
  fileName: string;
  url: string;
  sizeBytes: number;
  sha256: string;
}

export const DIARIZATION_MODEL_VERSION = 3;

export const DIARIZATION_SAMPLE_RATE = 16_000;

export const DIARIZATION_MODEL_FILES: readonly DiarizationModelFile[] = [
  {
    id: 'segmentation',
    fileName: 'pyannote-segmentation-3-0.onnx',
    url: 'https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx',
    sizeBytes: 5_992_913,
    sha256: '220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079',
  },
  {
    id: 'embedding',
    fileName: 'wespeaker-en-voxceleb-resnet293-lm.onnx',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet293_LM.onnx',
    sizeBytes: 114_336_527,
    sha256: 'f65dbc820e534eef64ae12d1e289e20244d60e60f7f00d7b092092b1c458be2e',
  },
];

export const DIARIZATION_TOTAL_DOWNLOAD_BYTES = DIARIZATION_MODEL_FILES.reduce(
  (sum, file) => sum + file.sizeBytes,
  0,
);
