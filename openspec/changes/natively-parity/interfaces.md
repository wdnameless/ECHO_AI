# Interfaces — Natively parity (S1–S6)

Публичные границы модулей и зоны владения. Обновляется оркестратором после каждого слайса.
Clean-room: сигнатуры спроектированы от наших швов (Wave-0 recon), не из чужого кода.

## S1 — rag-memory

### Новые модули
```ts
// src/lib/rag/memory-index.ts
/** Локальный индекс памяти встреч. Поиск — всегда локально. */
export interface MemoryHit { conversationId: string; chunkId: string; score: number; text: string; }
export async function indexTranscript(conversationId: string, segments: { text: string; ts: number }[]): Promise<void>;
export async function searchMemory(query: string, limit?: number): Promise<MemoryHit[]>;
```

```ts
// src/lib/rag/embeddings.ts
/** Провайдер эмбеддингов: local-first, cloud — опция. */
export interface EmbeddingProvider { id: "local" | "cloud"; embed(texts: string[]): Promise<Float32Array[]>; }
export function getEmbeddingProvider(): EmbeddingProvider;
```

```rust
// src-tauri/src/memory/mod.rs (новый модуль)
#[tauri::command] pub async fn memory_search(query: String, limit: u32) -> Result<Vec<MemoryHit>, String>;
#[tauri::command] pub async fn memory_index(conversation_id: String, chunks: Vec<String>) -> Result<u32, String>;
```

### Зоны владения
| Файл | Владелец |
|---|---|
| `src/lib/rag/memory-index.ts` | S1 |
| `src/lib/rag/embeddings.ts` | S1 |
| `src-tauri/src/memory/` | S1 |
| `src-tauri/Cargo.toml` (+sqlite-vec) | S1 |
| `src/lib/functions/ai-response.function.ts` (инъекция хитов) | S1 |

## S2 — streaming-stt

### Новые модули
```ts
// src/lib/stt/streaming.ts
/** Единый шов облачного стриминга; Deepgram — первая реализация. */
export interface StreamingSTTProvider {
  id: string;
  connect(opts: { apiKey: string; language: string; onTranscript: (text: string, isFinal: boolean) => void }): StreamingSTTSession;
}
export interface StreamingSTTSession { send(pcm16: Int16Array): void; close(): void; }
export function getStreamingProvider(id: string): StreamingSTTProvider | null; // static map + custom registry (Stage-B: без list)
```

### Изменяемые швы
```ts
// src/lib/asr-gate.ts — слот под облачный стрим рядом с локальным WS (расширение, не замена)
```

### Зоны владения
| Файл | Владелец |
|---|---|
| `src/lib/stt/streaming.ts` | S2 |
| `src/lib/stt/deepgram.ts` | S2 |
| `src/lib/asr-gate.ts` (расширение) | S2 |
| `src/lib/trusted-hosts.ts` (+deepgram host) | S2 |
| `src/config/stt.constants.ts` (+streaming провайдер) | S2 |

## S3 — stealth-window

### Изменяемые модули
```rust
// src-tauri/src/window.rs — расширение set_stealth_mode
// Было: SetWindowDisplayAffinity + TOOLWINDOW
// Стало: + скрытие из таскбара/Alt-Tab через set_skip_taskbar (Stage-B), sharingType none для aux-окон (mac), no-op Linux честно
```

### Зоны владения
| Файл | Владелец |
|---|---|
| `src-tauri/src/window.rs` | S3 |
| `src/contexts/app.context.tsx` (расширение стелс-состояния) | S3 |
| `src/pages/settings/components/StealthToggle.tsx` | S3 |

## S4 — cheap-pack

### Данные (персоны)
```ts
// src/lib/storage/prompt-profiles.ts — +4 записи BUILTIN_PROFILES: sales, recruiting, lecture, call-center
// Схема записи не меняется: { id, name, systemPrompt, flushGap, ... }
```

### Новые модули
```ts
// src/lib/docx.ts
export async function extractDocxText(file: File): Promise<string>;
```

```ts
// src/lib/database/history-export.ts (Stage-B: md через generateConversationMarkdown из useHistory)
export async function exportHistory(format: "md" | "json", conversationIds?: string[]): Promise<Blob>;
```

```ts
// src/lib/document-text.ts (Stage-B: общий PDF/DOCX/txt, pdf — lazy import для jsdom)
export async function extractDocumentText(file: File): Promise<string>;
```

### Зоны владения
| Файл | Владелец |
|---|---|
| `src/lib/storage/prompt-profiles.ts` (+данные) | S4 |
| `src/lib/docx.ts` | S4 |
| `src/pages/settings/components/JobContext.tsx` (+.docx) | S4 |
| `src/pages/settings/components/ResumeContext.tsx` (+.docx) | S4 |
| `src/lib/database/history-export.ts` | S4 |
| `src/lib/document-text.ts` | S4/Stage-B |
| `src/hooks/useHistory.ts` (generateConversationMarkdown) | S4/Stage-B |

## S5 — visual-answers

### Новые модули
```ts
// src/lib/visual-answers.ts
/** Решает, просить ли у LLM диаграмму; извлекает mermaid-блоки из ответа. */
export function shouldOfferVisual(profileId: string, question: string): boolean;
export function extractMermaidBlocks(markdown: string): string[];
```

### Зоны владения
| Файл | Владелец |
|---|---|
| `src/lib/visual-answers.ts` | S5 |
| `src/lib/functions/ai-response.function.ts` (визуальный хинт в промпт) | S5, после S1 (S1 первый) |
| `src/components/Markdown/renderer.tsx` (mermaid уже в бандле) | S5 |

## S6 — distribution

### Зоны владения
| Файл | Владелец |
|---|---|
| `.github/workflows/release.yml` (+portable job) | S6 |
| `src-tauri/tauri.conf.json` (только если нужно для portable) | S6 |
