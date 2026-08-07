# Local Recording Fallback vs `main`

This document explains the behavior introduced on `feature/local-recording-fallback` relative to `origin/main`.

The branch adds a repair path for Xyne Scribe / note-taker (`HEADLESS`) recordings so short LiveKit / browser outages can be recovered from browser-local audio and merged back into the canonical transcript after the call ends.

## Scope of change

Compared with `main`, this branch adds four main capabilities:

1. Browser-local fallback capture during outages
2. Upload/finalize/status APIs for repair chunks
3. Queue/worker-based transcription merge for repair audio
4. UI/state coordination for outage tracking and repair completion

## High-level behavioral delta

On `main`:

- note-taker recordings depend on the live room and live transcription path
- if audio/transcription drops during a gap, that gap is generally lost

On this branch:

- the browser records local audio chunks during outage windows
- those chunks are uploaded after connectivity returns or when the call ends
- backend transcribes the uploaded chunks
- backend merges the repaired text back into the note-taker transcript

## Main components added or changed

Frontend:

- `apps/dashboard/src/components/Recording/RecordingFallbackCoordinator.tsx`
- `apps/dashboard/src/services/Recording/offlineRecordingService.ts`
- `apps/dashboard/src/services/Recording/recordingRepairOutages.ts`
- `apps/dashboard/src/services/Recording/recordingService.ts`
- `apps/dashboard/src/stores/recordingStore.ts`
- `apps/dashboard/src/routes/RecordingsV2Screen/components/NoteTakerOverlayHost.tsx`

Backend:

- `apps/backend/src/controllers/recordingRepairController.ts`
- `apps/backend/src/services/recordingRepairStateService.ts`
- `apps/backend/src/services/recordingRepairStorageService.ts`
- `apps/backend/src/services/recordingRepairService.ts`
- `apps/backend/src/queues/recordingRepairQueue.ts`
- `apps/backend/src/workers/recordingRepairWorker.ts`
- `apps/backend/src/services/noteTakerTranscriptService.ts`

Shared storage/runtime:

- `packages/storage/src/types.ts`
- `packages/storage/src/gcsAdapter.ts`
- `packages/storage/src/gcsService.ts`
- `packages/storage/src/s3StorageService.ts`

## Architecture summary

The branch introduces a second recording path alongside the normal note-taker flow:

- live path: LiveKit room -> transcription agent -> canonical transcript
- repair path: browser MediaRecorder -> IndexedDB -> repair upload API -> repair worker -> transcript merge

## DFD: end-to-end note-taker recording with fallback

```mermaid
flowchart LR
    U[User microphone] --> LK[LiveKit room]
    LK --> AG[Transcription agent]
    AG --> LT[Live transcript packets]
    LT --> UI[Dashboard / overlay]

    U --> MR[Browser MediaRecorder]
    MR --> IDB[(IndexedDB repair cache)]
    IDB --> API[/recording repair upload API/]
    API --> OBJ[(Repair chunk storage)]
    OBJ --> W[Repair worker]
    W --> STT[Audio transcription]
    STT --> MERGE[Transcript merge]
    MERGE --> TR[(Canonical transcript)]
    TR --> UI
```

## DFD: repair-state persistence

```mermaid
flowchart TD
    FE[OfflineRecordingService] --> REDIS[(Repair state in Redis)]
    FE --> GCS[(Chunk objects in storage)]
    FE --> IDX[(IndexedDB local cache)]

    REDIS --> Q[Repair queue]
    Q --> WK[Repair worker]
    WK --> REDIS
    WK --> GCS
    WK --> CALL[(Call transcript + metadata)]
```

## Sequence: happy path without outage

```mermaid
sequenceDiagram
    participant User
    participant Dash as Dashboard
    participant LK as LiveKit
    participant Agent as Transcription Agent
    participant API as Backend

    User->>Dash: Start note-taker recording
    Dash->>API: create HEADLESS call
    API->>LK: create/join room
    API->>API: auto-start audio recording
    User->>LK: microphone audio
    LK->>Agent: live media
    Agent->>Dash: transcript packets
    Agent->>API: transcript ready / room finished
    API->>API: persist transcript + summary
```

## Sequence: outage and repair path

```mermaid
sequenceDiagram
    participant User
    participant Dash as Dashboard
    participant Local as OfflineRecordingService
    participant API as Repair API
    participant Store as Chunk Storage
    participant Queue as Repair Queue
    participant Worker as Repair Worker
    participant Transcript as NoteTakerTranscriptService

    User->>Dash: recording in progress
    Dash->>Local: set fallback reason active
    Local->>Local: record standalone WebM chunks
    Local->>Local: persist chunks + outage intervals in IndexedDB

    alt network restored before stop
        Local->>API: upload overlapping chunks
    else call ends first
        Local->>API: upload chunks during stopAndUpload()
    end

    Local->>API: finalize repair capture with outage windows
    API->>Queue: enqueue repair job
    Queue->>Worker: process(callId, captureId)
    Worker->>Store: read uploaded chunks
    Worker->>Worker: transcribe chunk audio
    Worker->>Transcript: applyRecordingRepair(...)
    Transcript->>Transcript: replace transcript coverage
    Worker->>API: mark repair merged
    API-->>Dash: status=MERGED
```

## Runtime flow by layer

### 1. Frontend outage detection

The dashboard now tracks outage reasons independently of the main recording lifecycle:

- browser offline
- LiveKit reconnect/disconnect
- reconnect timeout
- transcription agent left
- STT failure/recovery

These reasons are accumulated in store state and mirrored into `OfflineRecordingService`.

### 2. Frontend local capture

`OfflineRecordingService`:

- creates standalone WebM chunks with one MediaRecorder lifecycle per chunk
- persists chunks into IndexedDB
- persists outage windows into IndexedDB
- retries unfinished uploads/finalization on startup and browser `online`

### 3. Backend capture finalization

`recordingRepairController`:

- accepts repair chunk uploads
- validates finalized outage windows
- creates repair state in Redis
- enqueues a repair job

### 4. Backend repair processing

`recordingRepairWorker` + `recordingRepairQueue`:

- recover pending repair jobs
- transcribe stored repair chunks
- merge text into the canonical transcript
- mark repair state `MERGED` or `FAILED`

## Storage model

Frontend local:

- IndexedDB `captures`
- IndexedDB `chunks`

Backend transient:

- Redis hash per `recording-repair:<callId>:<captureId>`

Backend durable:

- object storage under `recording-repairs/<callId>/<captureId>/...`
- canonical transcript storage remains the source of truth after merge

## State model introduced

Repair status:

- `OPEN`
- `FINALIZED`
- `PROCESSING`
- `MERGED`
- `FAILED`

Frontend fallback availability:

- `ready`
- `unavailable`

## Main request/response additions

New client methods:

- upload repair chunk
- finalize repair capture
- fetch repair status

New backend routes:

- `PUT /calls/:callId/recording-repairs/:captureId/chunks/:sequence`
- `POST /calls/:callId/recording-repairs/:captureId/finalize`
- `GET /calls/:callId/recording-repairs/:captureId`

## Operational requirements

This branch requires the following to be healthy for repaired audio to appear:

- dashboard browser supports `MediaRecorder`
- IndexedDB available
- repair chunk storage configured
- Redis available for repair state + queue
- repair worker running
- transcription service accepts uploaded WebM chunks

Without the repair worker, fallback audio can be captured and uploaded, but it will not be merged into the transcript.

## What does not change

- note-taker recordings are still `HEADLESS` calls
- canonical transcript persistence remains the backend source of truth
- regular in-call recording and stitch flows still use `call_recordings`

## Current safeguards in this branch

- stale repair recovery is kicked off in the background so a leftover capture does not block arming fallback capture for a new call
- finalize rejects repairs unless uploaded chunk coverage spans each finalized outage interval end-to-end
- transcript replacement is limited to the intersection of selected chunk coverage and finalized outage windows

## Remaining risk areas

- repair merge still depends on chunk transcription quality; a valid merge can still produce coarse text if the recovered audio is noisy
- repair completion still depends on Redis, repair storage, and the repair worker all being available after call end
- long-lived local failures are retained in IndexedDB for retry, so operator visibility into repeated `FAILED` states remains important

## Suggested verification checklist

- start a note-taker recording and keep network healthy
- force browser offline for part of the call
- verify IndexedDB chunks are written
- restore connectivity
- stop the call
- verify repair state transitions `FINALIZED -> PROCESSING -> MERGED`
- verify repaired transcript appears in recording detail
- verify summary regeneration still works after merge
