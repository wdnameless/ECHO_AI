import { describe, expect, it } from "vitest";
import {
  PendingQuestionQueue,
  StreamingLinearResampler,
  channelToLiveSource,
  float32ToLittleEndian,
} from "../realtime-audio";

describe.each([48_000, 44_100])("StreamingLinearResampler %iHz", (sourceRate) => {
  it("preserves exact long-run count and interpolation across callback boundaries", () => {
    const input = Float32Array.from({ length: 4096 * 10 }, (_, i) => i / (4096 * 10));
    const resampler = new StreamingLinearResampler(sourceRate);
    const chunks: Float32Array[] = [];
    for (let offset = 0; offset < input.length; offset += 4096) {
      chunks.push(resampler.process(input.slice(offset, offset + 4096)));
    }
    const output = Float32Array.from(chunks.flatMap((chunk) => Array.from(chunk)));
    expect(output.length).toBe(Math.floor(input.length * 16_000 / sourceRate));
    const ratio = sourceRate / 16_000;
    for (const index of [0, 1364, 1365, output.length - 1]) {
      expect(output[index]).toBeCloseTo(index * ratio / input.length, 5);
    }
  });
});

it("serializes f32 explicitly little-endian", () => {
  const view = new DataView(float32ToLittleEndian(new Float32Array([1, -0.5])));
  expect(view.getFloat32(0, true)).toBe(1);
  expect(view.getFloat32(4, true)).toBe(-0.5);
});

it("keeps distinct pending questions FIFO but replaces true extensions", () => {
  const queue = new PendingQuestionQueue();
  queue.enqueue("What is React", "them", 0);
  queue.enqueue("What is React concurrency?", "them", 1000);
  queue.enqueue("Why use TypeScript?", "them", 2000);
  expect(queue.snapshot(2000).map((item) => item.text)).toEqual([
    "What is React concurrency?",
    "Why use TypeScript?",
  ]);
  expect(queue.dequeue(2000)?.text).toBe("What is React concurrency?");
  expect(queue.dequeue(2000)?.text).toBe("Why use TypeScript?");
  expect(queue.dequeue(2000)).toBeUndefined();
});

it("maps websocket mic channel to live source me", () => {
  expect(channelToLiveSource("mic")).toBe("me");
  expect(channelToLiveSource("them")).toBe("them");
});
