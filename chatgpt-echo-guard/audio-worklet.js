class EchoGuardCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blockSize = 2048;
    this.buffer = new Float32Array(this.blockSize);
    this.offset = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) { if (input) output.set(input); else output.fill(0); }
    if (input) {
      let sourceOffset = 0;
      while (sourceOffset < input.length) {
        const count = Math.min(this.blockSize - this.offset, input.length - sourceOffset);
        this.buffer.set(input.subarray(sourceOffset, sourceOffset + count), this.offset);
        this.offset += count;
        sourceOffset += count;
        if (this.offset === this.blockSize) {
          const block = this.buffer;
          this.buffer = new Float32Array(this.blockSize);
          this.offset = 0;
          this.port.postMessage({ type: "audio", samples: block }, [block.buffer]);
        }
      }
    }
    return true;
  }
}
registerProcessor("echo-guard-capture", EchoGuardCaptureProcessor);
