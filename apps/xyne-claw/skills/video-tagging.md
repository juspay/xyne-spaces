---
name: video-tagging
description: "Understand and tag Google Drive videos at scale — transcript, on-screen text, logos and scene content — then write the tags back to each file as Drive Labels and a Description. Load when a user asks to analyse, caption, describe, index or tag a folder of videos (e.g. a marketing-video folder) so the videos become searchable. On-demand, per-folder; not a continuous worker."
---

# Video Tagging (Google Drive folder → tags)

Turn a Google Drive folder of videos into searchable, tagged files. For each video you
produce: a transcript, the on-screen text, the logos/brands shown, a short scene
description, and a set of tags. You then write those tags back onto the Drive file as
**Drive Labels** (controlled vocabulary) and a free-text **Description**. A separate
search tool (owned by the user) does the search over those labels/descriptions — this
skill only *creates* the tags.

This is an **on-demand, per-folder** job. Do not build a background worker for it.

## What works, and the one dependency

Every step below is verified to run in the agent sandbox. The whole chain works **once
the video file is on disk in the sandbox**.

- **List the folder** — `google-drive-search` returns the folder's video files (id, name, size, mimeType).
- **Get the bytes into the sandbox** — use the `google-drive-download-to-sandbox` tool
  (tracked in the Drive-download ticket). It downloads a Drive file by id, server-side,
  using the caller's own Drive credentials, into a sandbox path.
  **If that tool is not yet available**, ask the user to share the videos "anyone with
  the link" and `curl` them in through the egress proxy, or have them delivered into the
  session — `google-drive-read` only returns a binary placeholder for video and cannot
  be used to get the bytes.
- **Frames + audio** — `ffmpeg` (present in the sandbox).
- **Transcript** — `faster-whisper`, model pulled from Hugging Face **through the egress proxy** (see below).
- **On-screen text, logos, scene** — read the extracted frames yourself with `sandbox-read-file` (vision). Do NOT rely on a bundled OCR engine; a basic OCR misreads stylised title cards. The model reading the frame is far more accurate and also identifies logos and describes the scene.
- **Write tags back** — `google-drive-modify-labels` (Drive Labels) and `google-drive-update-description` (Description).

### Critical: the sandbox reaches the internet only via the egress proxy

Direct `curl`/model downloads fail (HTTP 000). Hugging Face and GitHub raw are reachable
**only** through the egress proxy. Export it before any download or model load:

```
export https_proxy=http://10.20.20.17:3128 http_proxy=http://10.20.20.17:3128
```

(Confirm the address from `$EGRESS_PROXY_PORT` in the sandbox env; it has been `10.20.20.17:3128`.)

## Pipeline (per video)

### 0. Session + deps (once per run)

```
# faster-whisper installs from PyPI (works directly); the MODEL downloads via the proxy.
pip3 install --user --break-system-packages faster-whisper
```

### 1. Get the file

Prefer the **lowest-resolution copy** when a folder has both (e.g. `1080_...mp4` vs
`4K_...mp4`, 90 MB vs 145 MB) — same content, far less bandwidth and CPU. Download it
into `/tmp/vt/<fileId>/src.mp4` with the Drive-download tool.

### 2. Frames + audio (ffmpeg)

```
cd /tmp/vt/<fileId>
ffprobe -v error -show_entries format=duration -of csv=p=0 src.mp4
mkdir -p fr
# one frame at the start + one per scene change, downscaled for fast vision reads
ffmpeg -loglevel error -y -i src.mp4 \
  -vf "select='eq(n,0)+gt(scene,0.25)',scale=512:-1" -vsync vfr fr/f_%03d.jpg
# mono 16 kHz audio for whisper
ffmpeg -loglevel error -y -i src.mp4 -vn -ac 1 -ar 16000 a.wav
```

Cap frames for very long videos (e.g. keep the first ~40). For a typical 30–60 s
marketing clip you get ~5–10 scene frames.

### 3. Transcript (faster-whisper, model via proxy)

```
export https_proxy=http://10.20.20.17:3128 http_proxy=http://10.20.20.17:3128
python3 - <<'EOF'
from faster_whisper import WhisperModel
m = WhisperModel('small', device='cpu', compute_type='int8')  # 'tiny'/'base' are faster; 'small' is a good quality/speed balance
seg, info = m.transcribe('a.wav')
text = ' '.join(s.text.strip() for s in seg).strip()
print('LANG', info.language)
print('TRANSCRIPT', text or '(no speech — music/ambient only)')
EOF
```

Whisper also recognises when there is no dialogue (music-only) — record that rather than
inventing a transcript.

### 4. On-screen text + logos + scene (vision)

Read each frame with `sandbox-read-file` ( `path: /tmp/vt/<fileId>/fr/f_00N.jpg` ). For
each frame capture: exact on-screen text (titles, captions, lower-thirds, CTAs, URLs),
any logos/brands visible, and a one-line scene description. Merge across frames and
de-duplicate.

### 5. Build the tag record

Combine transcript + on-screen text + logos + scene into one record, e.g.:

```
{
  "fileId": "...",
  "name": "4K_IKEA X Juspay.mp4",
  "duration_s": 39,
  "language": "en",
  "transcript": "...",
  "on_screen_text": ["IKEA", "Shop now", "..."],
  "logos": ["IKEA", "Juspay"],
  "scene": "retail store interior; checkout flow; product closeups",
  "tags": { ...from the agreed tag universe... }
}
```

Map free findings onto the **agreed tag universe** the user defines (e.g. `brand`,
`product`, `campaign`, `region`, `language`, `video_type`, `has_logo`, `duration_bucket`).
Keep tag *keys* and allowed *values* fixed so the downstream search is consistent — do
not invent new tag keys per video.

### 6. Write tags back to Drive

Two mechanisms, use both:

- **Drive Labels** (`google-drive-modify-labels`) — the controlled vocabulary. Each label
  and its fields/options must already exist in the Workspace **Label Manager** (an admin
  publishes them once); the agent only *applies* values. Resolve label/field/option ids
  with `google-drive-labels-list` first, then set them. This is the structured,
  admin-governed "universe of tags".
- **Description** (`google-drive-update-description`) — free text, up to 25,000 chars.
  Write a human-readable summary plus a flat `key: value; key: value` tag line and the
  transcript snippet, so full-text Drive search also finds the file.

Both are per-file writes and go through normal approval. Labels need the taxonomy to
exist first; Description works with no setup.

## Operating rules

- **Idempotency / resume.** Key work by `fileId`. Before processing, check whether the
  file already has the label set / a description written and skip it unless re-tagging is
  requested. Keep a per-run manifest (`/tmp/vt/manifest.json`) of done/failed ids so a
  re-run resumes instead of redoing everything.
- **Scale.** Process sequentially or in small batches; a folder of marketing videos is
  tens of files, not thousands. Report progress per file.
- **Errors.** Surface and continue on: not-shared/no-access, file too large for the
  download tool's cap, ffmpeg decode failure, no audio track. Never fabricate a
  transcript or a logo you did not see in a frame.
- **Approval.** Writing labels/descriptions mutates the user's Drive files — let the
  normal approval gate run; batch sensibly and say what you are about to change.
- **Cost.** The vision reads (frames) are the main cost. Downscale frames to ~512px wide
  and keep only scene-change frames to stay cheap.

## Minimal end-to-end shape

list folder (`google-drive-search`) → for each video: download (`google-drive-download-to-sandbox`)
→ `ffmpeg` frames+audio → `faster-whisper` transcript → read frames (vision) for text/logos/scene
→ build tag record against the agreed universe → `google-drive-modify-labels` + `google-drive-update-description`.
