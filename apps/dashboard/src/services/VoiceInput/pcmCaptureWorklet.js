/* global AudioWorkletProcessor, registerProcessor, sampleRate */
// Audio thread: downsamples the mic to 16 kHz int16 LE and posts each render quantum to the main thread.
const TARGET_RATE = 16000;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.acc = 0;
    this.count = 0;
    this.pos = 0;
    this.stopped = false;
    // Without this a disconnected node keeps being processed for the page's lifetime.
    this.port.onmessage = () => {
      this.stopped = true;
    };
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return !this.stopped;
    const out = new Int16Array(Math.ceil(channel.length / this.ratio) + 1);
    let n = 0;
    for (let i = 0; i < channel.length; i++) {
      this.acc += channel[i];
      this.count++;
      this.pos++;
      if (this.pos >= this.ratio) {
        const s = Math.max(-1, Math.min(1, this.acc / this.count));
        out[n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        this.acc = 0;
        this.count = 0;
        this.pos -= this.ratio;
      }
    }
    if (n > 0) {
      const samples = out.slice(0, n);
      this.port.postMessage(samples.buffer, [samples.buffer]);
    }
    return !this.stopped;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
