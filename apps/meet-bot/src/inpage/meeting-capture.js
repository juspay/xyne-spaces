// Runs inside the meeting page (installed with addInitScript before the page's own
// code). Plain browser JS on purpose: Playwright serialises functions from source,
// and tsx/esbuild helpers (e.g. __name) don't exist in the page. The bot sets
// window.__xyneMeetingPlatform ("google_meet" | "teams") and window.__xyneBotName
// in front of this script.
//
// 1. Wraps RTCPeerConnection so every remote audio track the page receives is kept.
// 2. startCapture() mixes those tracks with Web Audio and hands 48 kHz mono 16-bit
//    PCM to the bot's Node process (window.__xyneAudio, exposed by Playwright),
//    which publishes it to LiveKit. Nothing LiveKit runs in this page: Meet locks
//    down the browser objects livekit-client needs.
// 3. Works out who is speaking from the participant tiles (the talking indicator),
//    and tags every audio chunk with that speaker so Node can route it to a LiveKit
//    participant named after them.
// 4. state() reads what the meeting UI currently shows, for the Node side to act on.
// Steps 1–2 are the same everywhere; 3–4 read each platform's UI (PLATFORMS below).
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

  // Icon fonts draw icons as literal text such as "frame_person" or "mic_off", so
  // those must never be taken for a name.
  const ICON_TEXT = /^[a-z0-9]+(_[a-z0-9]+)*$/;

  function cleanName(text) {
    const lines = (text || '').split('\n').map((l) => l.trim());
    return lines.find((l) => l && l.length <= 60 && !ICON_TEXT.test(l)) || null;
  }

  function isIcon(el) {
    const cls = typeof el.className === 'string' ? el.className : '';
    return el.getAttribute('aria-hidden') === 'true' || /icon|symbol/i.test(cls) || el.tagName === 'I';
  }

  function visible(selector) {
    const el = document.querySelector(selector);
    return !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  const BOT_NAME = (window.__xyneBotName || '').trim().toLowerCase();

  // ---- Per-platform UI ----
  // tile:      selector for one participant's tile; tileId(tile) gives a stable id.
  // speaking:  selectors present inside a tile while that person talks (checked first;
  //            otherwise the tile with the most class changes is taken as the speaker).
  // TEXT:      phrases the page shows in each situation.
  const PLATFORMS = {
    google_meet: {
      tile: '[data-participant-id]',
      tileId: (tile) => tile.getAttribute('data-participant-id'),
      speaking: ['.Oaajhc', '.HX2H7', '.wEsLMd', '.OgVli'],
      isSelfTile: (tile) => !!tile.querySelector('[data-self-name]'),
      tileName: (tile) => {
        for (const el of tile.querySelectorAll('.notranslate')) {
          if (isIcon(el)) continue;
          const named = cleanName(el.textContent);
          if (named) return named;
        }
        return cleanName(tile.getAttribute('aria-label')) || cleanName(tile.innerText);
      },
      participantCount: () => participantTiles().size,
      inCall: () => !!document.querySelector('[aria-label^="Leave call"]'),
      nameInput: () => !!document.querySelector('input[aria-label="Your name"]'),
      TEXT: {
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
        lobby: [],
      },
    },
    teams: {
      tile: '[data-cid="calling-participant-stream"], [data-tid*="participant-tile"], [data-stream-type]',
      tileId: (tile) =>
        tile.getAttribute('data-acc-element-id') ||
        tile.getAttribute('data-participant-id') ||
        tile.getAttribute('data-tid') + ':' + (tile.getAttribute('aria-label') || '').split(',')[0],
      speaking: ['[data-tid="voice-level-stream-outline"].vdi-frame-occlusion', '[class*="speaking" i]'],
      isSelfTile: (tile) => {
        const label = (tile.getAttribute('aria-label') || '').toLowerCase();
        return label.includes('(you)') || (!!BOT_NAME && label.startsWith(BOT_NAME));
      },
      tileName: (tile) => {
        const named = tile.querySelector('[data-tid*="display-name"], [data-tid="participant-name"]');
        if (named) return cleanName(named.textContent);
        // aria-label reads like "Ana Lima, muted, camera off".
        return cleanName((tile.getAttribute('aria-label') || '').split(',')[0]);
      },
      // Teams' layout can show a single tile with several people in the call (screen
      // share), so the count comes from the People button; 0 means unknown.
      participantCount: () => {
        const button = document.querySelector('[data-tid="roster-button"], #roster-button, [data-tid="calling-roster-button"]');
        const label = button ? (button.getAttribute('aria-label') || '') + ' ' + (button.textContent || '') : '';
        const match = label.match(/\d+/);
        return match ? Number(match[0]) : 0;
      },
      // The hang-up button is also on the lobby screen, so the lobby text rules it out.
      inCall: () =>
        (visible('[data-tid="hangup-main-btn"]') || visible('#hangup-button') || visible('[data-tid="call-hangup"]')) &&
        !hasText(PLATFORMS.teams.TEXT.lobby),
      nameInput: () => !!document.querySelector('input[data-tid="prejoin-display-name-input"]'),
      TEXT: {
        blocked: [
          "can't join this meeting",
          'Anonymous users can',
          'Sign in to join this meeting',
          'needs to sign in',
        ],
        denied: ['denied access to the meeting', 'declined your request', 'Your request to join was declined'],
        notAdmitted: ['No one let you in', 'no one responded', "You've been in the lobby"],
        removed: ["You've been removed from this meeting", 'removed you from the meeting', 'Someone removed you'],
        ended: ['The meeting has ended', 'This meeting has ended', 'You left the meeting', 'Meeting ended'],
        notFound: ["Sorry, we couldn't connect you", "This meeting link isn't valid", "We couldn't find the meeting"],
        alone: ['Waiting for others to join', "You're the only one here"],
        lobby: [
          'should let you in soon',
          "we'll let people know you're waiting",
          "Someone will let you in",
          'Waiting for someone to let you in',
        ],
      },
    },
  };
  const P = PLATFORMS[window.__xyneMeetingPlatform] || PLATFORMS.google_meet;

  function pageText() {
    return (document.body ? document.body.innerText : '').replace(/’/g, "'");
  }

  function hasText(phrases) {
    const text = pageText().toLowerCase();
    return phrases.some((phrase) => text.includes(phrase.toLowerCase()));
  }

  // ---- Active speaker ----
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
        const tile = target && target.closest ? target.closest(P.tile) : null;
        if (!tile) continue;
        const id = P.tileId(tile);
        if (!id) continue;
        const times = activity.get(id) || [];
        times.push(now);
        while (times.length && now - times[0] > ACTIVITY_WINDOW_MS) times.shift();
        activity.set(id, times);
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
  }

  function tileName(tile, id) {
    const named = P.tileName(tile);
    // The first good name for a tile sticks, so a flicker in the tile can't rename them.
    if (named && !tileNames.has(id)) tileNames.set(id, named);
    return tileNames.get(id) || null;
  }

  function participantTiles() {
    const tiles = new Map();
    document.querySelectorAll(P.tile).forEach((tile) => {
      const id = P.tileId(tile);
      if (id && !tiles.has(id)) tiles.set(id, tile);
    });
    return tiles;
  }

  function currentSpeaker() {
    const tiles = new Map([...participantTiles()].filter(([, tile]) => !P.isSelfTile(tile)));
    for (const [id, tile] of tiles) {
      if (P.speaking.some((selector) => tile.querySelector(selector))) return { id, name: tileName(tile, id) };
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
    const T = P.TEXT;
    return {
      inCall: P.inCall(),
      nameInput: P.nameInput(),
      blocked: hasText(T.blocked),
      denied: hasText(T.denied),
      notAdmitted: hasText(T.notAdmitted),
      removed: hasText(T.removed),
      ended: hasText(T.ended),
      notFound: hasText(T.notFound),
      lobby: hasText(T.lobby),
      participants: P.participantCount(),
      aloneMessage: hasText(T.alone),
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

    // ScriptProcessor needs no module URL (the page's CSP would block an AudioWorklet
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
