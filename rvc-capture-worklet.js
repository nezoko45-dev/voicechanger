class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.length = 0;
    this.target = sampleRate * 2;

    this.port.onmessage = (event) => {
      const seconds = Number(event.data?.chunkSeconds);
      if (Number.isFinite(seconds) && seconds > 0) {
        this.target = Math.max(128, Math.floor(sampleRate * seconds));
      }
    };
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    const copy = new Float32Array(channel);
    this.buffer.push(copy);
    this.length += copy.length;

    while (this.length >= this.target) {
      const joined = new Float32Array(this.length);
      let offset = 0;

      for (const part of this.buffer) {
        joined.set(part, offset);
        offset += part.length;
      }

      this.port.postMessage(joined.slice(0, this.target));

      const remainder = joined.slice(this.target);
      this.buffer = remainder.length ? [remainder] : [];
      this.length = remainder.length;
    }

    return true;
  }
}

registerProcessor("rvc-capture", CaptureProcessor);
