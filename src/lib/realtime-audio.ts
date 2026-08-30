export class StreamingLinearResampler {
  private readonly ratio: number;
  private totalInput = 0;
  private emitted = 0;
  private history = new Float32Array(0);

  constructor(sourceRate: number, targetRate = 16_000) {
    if (sourceRate <= 0 || targetRate <= 0 || targetRate > sourceRate) {
      throw new Error("Invalid streaming resampler rates");
    }
    this.ratio = sourceRate / targetRate;
  }

  process(input: Float32Array): Float32Array {
    if (input.length === 0) return new Float32Array(0);
    const start = this.totalInput - this.history.length;
    const samples = new Float32Array(this.history.length + input.length);
    samples.set(this.history);
    samples.set(input, this.history.length);
    this.totalInput += input.length;

    const targetCount = Math.floor(this.totalInput / this.ratio);
    const output = new Float32Array(targetCount - this.emitted);
    for (let i = 0; i < output.length; i++) {
      const sourcePosition = (this.emitted + i) * this.ratio;
      const local = sourcePosition - start;
      const lo = Math.max(0, Math.floor(local));
      const hi = Math.min(lo + 1, samples.length - 1);
      const fraction = local - Math.floor(local);
      output[i] = samples[lo] * (1 - fraction) + samples[hi] * fraction;
    }
    this.emitted = targetCount;

    const nextPosition = this.emitted * this.ratio;
    const keepFromGlobal = Math.max(0, Math.floor(nextPosition) - 1);
    const keepFromLocal = Math.max(0, keepFromGlobal - start);
    this.history = samples.slice(keepFromLocal);
    return output;
  }

  reset(): void {
    this.totalInput = 0;
    this.emitted = 0;
    this.history = new Float32Array(0);
  }
}

export const float32ToLittleEndian = (samples: Float32Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(samples.length * 4);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    view.setFloat32(i * 4, samples[i], true);
  }
  return buffer;
};

export type PendingQuestionItem = {
  text: string;
  source: "me" | "them";
  queuedAt: number;
  updatedAt: number;
};

export class PendingQuestionQueue {
  private items: PendingQuestionItem[] = [];

  constructor(private readonly maxItems = 5, private readonly ttlMs = 60_000) {}

  enqueue(text: string, source: "me" | "them", now = Date.now()): void {
    this.expire(now);
    const next = text.trim();
    if (!next) return;
    const tail = this.items[this.items.length - 1];
    if (tail && tail.source === source && now - tail.updatedAt <= 15_000) {
      if (next.includes(tail.text)) {
        tail.text = next;
        tail.updatedAt = now;
        return;
      }
      if (tail.text.includes(next)) {
        tail.updatedAt = now;
        return;
      }
    }
    if (this.items.length >= this.maxItems) this.items.shift();
    this.items.push({ text: next, source, queuedAt: now, updatedAt: now });
  }

  dequeue(now = Date.now()): PendingQuestionItem | undefined {
    this.expire(now);
    return this.items.shift();
  }

  snapshot(now = Date.now()): readonly PendingQuestionItem[] {
    this.expire(now);
    return this.items;
  }

  clear(): void {
    this.items = [];
  }

  private expire(now: number): void {
    this.items = this.items.filter((item) => now - item.queuedAt < this.ttlMs);
  }
}

export const channelToLiveSource = (channel: "them" | "mic"): "them" | "me" =>
  channel === "mic" ? "me" : "them";
