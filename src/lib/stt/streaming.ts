/**
 * S2: Streaming STT unified interface & provider registry.
 *
 * Provides a single pluggable seam for real-time WebSocket speech recognition.
 * Deepgram is the built-in initial implementation, and other cloud or custom
 * providers plug into this interface without altering call-sites.
 */

import { DeepgramStreamingProvider } from "./deepgram";

export interface StreamingSTTOptions {
  apiKey: string;
  language: string;
  onTranscript: (text: string, isFinal: boolean) => void;
  endpoint?: string;
  onError?: (error: Error) => void;
}

export interface StreamingSTTSession {
  send(pcm16: Int16Array): void;
  close(): void;
}

export interface StreamingSTTProvider {
  id: string;
  connect(opts: StreamingSTTOptions): StreamingSTTSession;
}

const customRegistry = new Map<string, StreamingSTTProvider>();
const builtInDeepgram = new DeepgramStreamingProvider();
const staticProviders: Record<string, StreamingSTTProvider> = {
  deepgram: builtInDeepgram,
  "deepgram-stt": builtInDeepgram,
};

export function registerStreamingProvider(provider: StreamingSTTProvider): void {
  customRegistry.set(provider.id.toLowerCase(), provider);
}

export function unregisterStreamingProvider(id: string): void {
  customRegistry.delete(id.toLowerCase());
}

export function getStreamingProvider(id: string): StreamingSTTProvider | null {
  if (!id) return null;
  const key = id.toLowerCase();
  return customRegistry.get(key) ?? staticProviders[key] ?? null;
}

export function resetStreamingProvidersForTests(): void {
  customRegistry.clear();
}
