/**
 * Speaker diarization worker — runs in an Electron utilityProcess so the
 * multi-minute ONNX inference never blocks the main process, and a native crash
 * takes down only this process.
 *
 * Protocol (over process.parentPort):
 *   in : { type: 'diarize', pcmPath, modelDir, segmentationFile, embeddingFile, numThreads }
 *   out: { type: 'result', segments: [{ start, end, speaker }], durationSeconds }
 *        { type: 'error', message }
 *
 * The PCM file is 16 kHz mono signed 16-bit little-endian (what the renderer tap
 * writes), converted here to the Float32 [-1, 1] samples Sherpa-ONNX expects.
 */
import { readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { DIARIZATION_SAMPLE_RATE } from './models';
import { postProcessSegments, speechSecondsBySpeaker } from './postprocess';

interface DiarizeRequest {
  type: 'diarize';
  pcmPath: string;
  modelDir: string;
  segmentationFile: string;
  embeddingFile: string;
  numThreads: number;
}

interface WorkerParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

interface SherpaAddon {
  createOfflineSpeakerDiarization(config: unknown): unknown;
  getOfflineSpeakerDiarizationSampleRate(handle: unknown): number;
  offlineSpeakerDiarizationProcess(
    handle: unknown,
    samples: Float32Array,
  ): Array<{ start: number; end: number; speaker: number }>;
}

const parentPort = (process as unknown as { parentPort?: WorkerParentPort }).parentPort;
if (!parentPort) {
  throw new Error('speaker-diarization worker must run inside an Electron utilityProcess');
}

/**
 * Resolve the native addon. Prefer the platform package by *name* so resolution
 * does not depend on the sibling-directory layout sherpa-onnx-node's own loader
 * assumes (which pnpm's virtual store and electron-builder's collected
 * node_modules may not preserve). Fall back to the wrapper package.
 */
function loadAddon(): SherpaAddon {
  const platform = os.platform() === 'win32' ? 'win' : os.platform();
  const platformPackage = `sherpa-onnx-${platform}-${os.arch()}`;
  const errors: string[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(platformPackage) as SherpaAddon;
  } catch (error) {
    errors.push(`${platformPackage}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('sherpa-onnx-node/addon.js') as SherpaAddon;
  } catch (error) {
    errors.push(`sherpa-onnx-node: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(`Sherpa-ONNX native addon unavailable for ${platformPackage}. ${errors.join(' | ')}`);
}

function pcm16ToFloat32(buffer: Buffer): Float32Array {
  const sampleCount = Math.floor(buffer.length / 2);
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    out[i] = buffer.readInt16LE(i * 2) / 32768;
  }
  return out;
}

function diarize(request: DiarizeRequest): void {
  const addon = loadAddon();
  const samples = pcm16ToFloat32(readFileSync(request.pcmPath));
  const durationSeconds = samples.length / DIARIZATION_SAMPLE_RATE;

  const config = {
    segmentation: {
      pyannote: { model: path.join(request.modelDir, request.segmentationFile) },
      numThreads: request.numThreads,
      debug: 0,
    },
    embedding: {
      model: path.join(request.modelDir, request.embeddingFile),
      numThreads: request.numThreads,
      debug: 0,
    },
    // numClusters -1 => estimate the speaker count; threshold is the embedding
    // distance below which two turns are still the same speaker (lower = more
    // speakers). It is MODEL-SPECIFIC. Sweep on WeSpeaker ResNet293-LM (16 kHz,
    // synthetic solo + two-voice audio): 0.3–0.5 gave the right count for both;
    // 0.6 and above merged two different voices into one. 0.45 sits in the upper
    // half because real single voices drift more than synthetic ones. (Earlier
    // models: ResNet34-LM 0.3–0.4, CAM++ 0.8–1.0 — never carry a threshold
    // across models.)
    clustering: { numClusters: -1, threshold: 0.45 },
    // Drop blips shorter than 500 ms (their embeddings are noise) and bridge
    // same-speaker pauses under 1 s so a breath doesn't split an utterance.
    minDurationOn: 0.5,
    minDurationOff: 1.0,
  };

  const handle = addon.createOfflineSpeakerDiarization(config);
  const expectedRate = addon.getOfflineSpeakerDiarizationSampleRate(handle);
  if (expectedRate !== DIARIZATION_SAMPLE_RATE) {
    throw new Error(`Model expects ${expectedRate} Hz audio but tap captures ${DIARIZATION_SAMPLE_RATE} Hz`);
  }

  const raw = samples.length === 0 ? [] : addon.offlineSpeakerDiarizationProcess(handle, samples);
  const { segments, merged, smoothed } = postProcessSegments(raw);
  parentPort!.postMessage({
    type: 'result',
    durationSeconds,
    speakerSeconds: speechSecondsBySpeaker(segments),
    mergedMinorSpeakers: merged,
    smoothedSegments: smoothed,
    segments: segments.map((segment) => ({
      start: Number(segment.start.toFixed(3)),
      end: Number(segment.end.toFixed(3)),
      speaker: segment.speaker,
    })),
  });
}

parentPort.on('message', (event) => {
  const message = event.data as Partial<DiarizeRequest> | undefined;
  if (!message || message.type !== 'diarize') return;
  try {
    diarize(message as DiarizeRequest);
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
