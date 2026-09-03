# video-studio image

A single sandbox image that carries **every** engine the `create-video-explainer`
tool can drive, so a whole storyboard — static and animated scenes — renders in
**one** box with **no internet at run time**.

## Why this exists

`create-video-explainer` (`packages/xyne-claw-shared/src/tools/video-explainer/`)
composes a narrated MP4 from an approved storyboard. Scene kinds:

| Kind | Engine | In base `agent-workspace`? |
|---|---|---|
| title, code, diff, bullets | chromium screenshot + ffmpeg | yes |
| diagram | chromium + bundled mermaid.min.js | yes |
| **manim** | Manim Community (Cairo) | **added here** |
| **d2** | d2 → rsvg-convert → ffmpeg | **added here** |

The base workspace image already has `ffmpeg`/`ffprobe` and `chromium`. This
image only *adds* Manim, D2, and `rsvg-convert` (librsvg2-bin) on top.

## Offline / security model

- **Runtime is egress-free.** The pod template sets `egress: []`, drops the
  service-account token, runs non-root (uid 1000), and drops capabilities.
- **No engine needs the network at run time.** Manim (Cairo) and D2
  (`D2_LAYOUT=dagre`, the bundled layout engine — *not* the browser-based
  ELK/TALA path) both run fully offline. D2 raster is done by `rsvg-convert`,
  not a headless Chromium, precisely so no browser download is ever attempted.
- **TTS never enters the box.** The claw pod calls the S2S-guarded
  `/internal/tts` endpoint and injects the resulting MP3 into the sandbox as a
  file (`session.files.write`). The `x-s2s-key` never crosses the VM boundary.
- **Untrusted model-authored code is sandboxed.** `manim.source` and every
  `d2.steps[]` string is written to a file and never shelled. Only the Manim
  `scene` class name is interpolated into a command line, and the validator
  restricts it to a Python identifier (`storyboard.ts`).

All package installs happen at **build** time (CI has network); the running
container fetches nothing.

## Build

```bash
docker build \
  --build-arg AGENT_WORKSPACE_IMAGE=<the current agent-workspace image> \
  -t video-studio:local \
  claw-deployments/kata-infra/video-studio
```

Pins: `MANIM_VERSION=0.20.1`, `D2_VERSION=0.7.1`, plus architecture-specific
SHA-256 checksums for the official D2 release archives. LaTeX is on by default
for Manim's `MathTex`/`Tex`; set `--build-arg VIDEO_STUDIO_WITH_TEX=0` for a
text-only image.

> Note: this image is **not** built or run in the dev sandbox (no Docker there).
> It builds in CI and is validated by the build-time `command -v` smoke check.
