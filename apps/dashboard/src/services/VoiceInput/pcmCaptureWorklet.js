/* global AudioWorkletProcessor, registerProcessor, sampleRate */
// Runs on the audio thread: averages the device-rate mic signal down to 16 kHz,
// converts it to int16 LE and posts each render quantum's samples to the main thread.
const TARGET_RATE = 16000;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.acc = 0;
    this.count = 0;
    this.pos = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
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
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
