// Runs inside the Google Meet page (installed with addInitScript before Meet's own
// code). Plain browser JS on purpose: Playwright serialises functions from source,
// and tsx/esbuild helpers (e.g. __name) don't exist in the page.
//
// 1. Wraps RTCPeerConnection so every remote audio track Meet receives is kept.
// 2. startCapture() mixes those tracks with Web Audio and hands 48 kHz mono 16-bit
//    PCM to the bot's Node process (window.__xyneAudio, exposed by Playwright),
//    which publishes it to LiveKit. Nothing LiveKit runs in this page: Meet locks
//    down the browser objects livekit-client needs.
// 3. Works out who is speaking from Meet's participant tiles (the talking animation),
//    and tags every audio chunk with that speaker so Node can route it to a LiveKit
//    participant named after them.
// 4. state() reads what the Meet UI currently shows, for the Node side to act on.
(() => {
  if (window.top !== window || window.__xyneMeetBot) return;

  const SAMPLE_RATE = 48000;
  const remoteTracks = new Map();
  let audioContext = null;
  let mixer = null;

  function connectToMixer(entry) {
    if (!audioContext || entry.source) return;
    entry.source = audioContext.createMediaStreamSource(new MediaStream([entry.track]));
    entry.source.connect(mixer);
  }

  function addRemoteTrack(track) {
    if (!track || track.kind !== 'audio' || remoteTracks.has(track.id)) return;
    const entry = { track, source: null };
    remoteTracks.set(track.id, entry);
    connectToMixer(entry);
    track.addEventListener('ended', () => {
      if (entry.source) entry.source.disconnect();
      remoteTracks.delete(track.id);
    });
  }

  const NativePeerConnection = window.RTCPeerConnection;
  if (NativePeerConnection) {
    const PatchedPeerConnection = function (...args) {
      const pc = new NativePeerConnection(...args);
      pc.addEventListener('track', (event) => addRemoteTrack(event.track));
      return pc;
    };
    PatchedPeerConnection.prototype = NativePeerConnection.prototype;
    Object.setPrototypeOf(PatchedPeerConnection, NativePeerConnection);
    window.RTCPeerConnection = PatchedPeerConnection;
    if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = PatchedPeerConnection;
  }

  const TEXT = {
    blocked: ["You can't join this video call"],
    denied: ['denied your request to join', 'Someone in the call denied your request'],
    notAdmitted: ['No one responded to your request'],
    removed: ["You've been removed from the meeting", 'removed you from the meeting'],
    ended: [
      'You left the meeting',
      "You've left the meeting",
      'The meeting has ended',
      'This meeting has ended',
      'The call has ended',
    ],
    notFound: ['Check your meeting code', 'Invalid video call name', "This video call doesn't exist"],
    // Meet's own empty-meeting message, shown once everyone else has left.
    alone: ["You're the only one here", 'No one else is here'],
  };

  // ---- Active speaker ----
  // Meet animates the tile of whoever is talking by toggling classes on elements
  // inside it. Known animation classes are checked first; otherwise the tile with
  // the most class changes in the last moment is taken as the speaker, which keeps
  // working when Google renames those classes.
  const SPEAKING_CLASSES = ['Oaajhc', 'HX2H7', 'wEsLMd', 'OgVli'];
  const ACTIVITY_WINDOW_MS = 600;
  const MIN_ACTIVITY = 3;
  const activity = new Map();
  const tileNames = new Map();
  let observer = null;

  function watchTiles() {
    if (observer || !document.body) return;
    observer = new MutationObserver((records) => {
      const now = performance.now();
      for (const record of records) {
        const target = record.target;
        const tile = target && target.closest ? target.closest('[data-participant-id]') : null;
        if (!tile) continue;
        const id = tile.getAttribute('data-participant-id');
        if (!id) continue;
        const times = activity.get(id) || [];
        times.push(now);
        while (times.length && now - times[0] > ACTIVITY_WINDOW_MS) times.shift();
        activity.set(id, times);
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
  }

  // Meet draws icons with an icon font: the icon is literal text such as
  // "frame_person" or "mic_off", so those must never be taken for a name.
  const ICON_TEXT = /^[a-z0-9]+(_[a-z0-9]+)*$/;

  function cleanName(text) {
    const lines = (text || '').split('\n').map((l) => l.trim());
    return lines.find((l) => l && l.length <= 60 && !ICON_TEXT.test(l)) || null;
  }

  function isIcon(el) {
    const cls = typeof el.className === 'string' ? el.className : '';
    return el.getAttribute('aria-hidden') === 'true' || /icon|symbol/i.test(cls) || el.tagName === 'I';
  }

  function tileName(tile, id) {
    let named = null;
    for (const el of tile.querySelectorAll('.notranslate')) {
      if (isIcon(el)) continue;
      named = cleanName(el.textContent);
      if (named) break;
    }
    named = named || cleanName(tile.getAttribute('aria-label')) || cleanName(tile.innerText);
    // The first good name for a tile sticks, so a flicker in the tile can't rename them.
    if (named && !tileNames.has(id)) tileNames.set(id, named);
    return tileNames.get(id) || null;
  }

  function isSelfTile(tile) {
    return !!tile.querySelector('[data-self-name]');
  }

  function currentSpeaker() {
    const tiles = new Map();
    document.querySelectorAll('[data-participant-id]').forEach((tile) => {
      const id = tile.getAttribute('data-participant-id');
      if (id && !tiles.has(id) && !isSelfTile(tile)) tiles.set(id, tile);
    });
    for (const [id, tile] of tiles) {
      if (SPEAKING_CLASSES.some((cls) => tile.querySelector('.' + cls))) return { id, name: tileName(tile, id) };
    }
    const now = performance.now();
    let best = null;
    let bestCount = MIN_ACTIVITY - 1;
    for (const [id, tile] of tiles) {
      const recent = (activity.get(id) || []).filter((t) => now - t <= ACTIVITY_WINDOW_MS).length;
      if (recent > bestCount) {
        bestCount = recent;
        best = { id, name: tileName(tile, id) };
      }
    }
    return best;
  }

  function state() {
    const text = (document.body ? document.body.innerText : '').replace(/’/g, "'");
    const has = (phrases) => phrases.some((phrase) => text.includes(phrase));
    const participantIds = new Set();
    document.querySelectorAll('[data-participant-id]').forEach((el) => {
      const id = el.getAttribute('data-participant-id');
      if (id) participantIds.add(id);
    });
    return {
      inCall: !!document.querySelector('[aria-label^="Leave call"]'),
      nameInput: !!document.querySelector('input[aria-label="Your name"]'),
      blocked: has(TEXT.blocked),
      denied: has(TEXT.denied),
      notAdmitted: has(TEXT.notAdmitted),
      removed: has(TEXT.removed),
      ended: has(TEXT.ended),
      notFound: has(TEXT.notFound),
      participants: participantIds.size,
      aloneMessage: has(TEXT.alone),
      remoteAudioTracks: remoteTracks.size,
      speaker: observer ? (currentSpeaker() || {}).name || null : null,
    };
  }

  function toBase64(int16) {
    const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  async function startCapture() {
    if (audioContext) return true;
    if (typeof window.__xyneAudio !== 'function') throw new Error('audio sink is not exposed');
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    mixer = audioContext.createGain();
    remoteTracks.forEach(connectToMixer);

    // ScriptProcessor needs no module URL (Meet's CSP would block an AudioWorklet
    // blob). 4096 samples ≈ 85 ms per chunk.
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    watchTiles();
    processor.onaudioprocess = (event) => {
      const speaker = currentSpeaker();
      const input = event.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      window.__xyneAudio(toBase64(pcm), speaker ? speaker.id : null, speaker ? speaker.name : null);
    };
    // A ScriptProcessor only runs while connected to an output; keep that silent.
    const silent = audioContext.createGain();
    silent.gain.value = 0;
    mixer.connect(processor);
    processor.connect(silent);
    silent.connect(audioContext.destination);
    await audioContext.resume();
    return true;
  }

  async function stopCapture() {
    if (observer) observer.disconnect();
    if (audioContext) await audioContext.close();
  }

  window.__xyneMeetBot = { state, startCapture, stopCapture };
})();
