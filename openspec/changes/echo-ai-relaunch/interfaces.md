# Interfaces — Echo AI 1.0.0 (S1–S6)

Публичные границы модулей и зоны владения. Обновляется оркестратором после каждого слайса.

## S1 — webview-security

### Новые модули
```ts
// src/lib/sanitize-schema.ts
import type { Plugin } from "unified";
/** Rehype-плагин: allowlist тегов, удаление on*-атрибутов, style, опасных схем. */
export const sanitizeSchema: Plugin;
```

### Изменяемые сигнатуры
```tsx
// src/components/Markdown/index.tsx
// Было: rehypePlugins не задавался (Streamdown применял rehype-raw по умолчанию)
// Стало: явный проп без rehype-raw, с собственным санитайзером
<Streamdown rehypePlugins={[[rehypeKatex, { errorColor: "..." }], sanitizeSchema]} ... />
```

### Зоны владения
| Файл | Владелец |
|---|---|
| `src/lib/sanitize-schema.ts` | S1 |
| `src/components/Markdown/index.tsx` | S1 |
| `src/lib/functions/parallel-search.ts` | S1 |
| `src-tauri/tauri.conf.json` → `app.security.csp` | S1 |

## S2 — network-egress

### Новые модули
```ts
// src/lib/trusted-hosts.ts
export function getHostOfCurlTemplate(curl: string): string | null;
export function isTrustedHost(url: string): boolean;
export function trustHost(host: string): void;
export function getTrustedHosts(): string[];
```

### Новый компонент
```tsx
// src/components/TrustHostDialog/index.tsx
interface TrustHostDialogProps {
  host: string;
  secrets: string[];      // какие ключи будут отправлены
  onConfirm: () => void;  // доверять и запомнить
  onSendWithoutSecret: () => void;
  onCancel: () => void;
}
```

### Зоны владения
| Файл | Владелец |
|---|---|
| `src/lib/trusted-hosts.ts` | S2 |
| `src/components/TrustHostDialog/` | S2 |
| `src/lib/functions/ai-response.function.ts` (только проверка хоста) | S2, затем S4 (согласовано, S2 первым) |
| `src/lib/functions/models.function.ts` | S2 |
| `src/lib/host-trust-gate.ts` | S2 |
| `src/lib/storage/secret-store.ts` | S4 |
| `src/lib/web-search.ts` | S4 |
| `src-tauri/capabilities/*.json` → `http:default` | S2 |
| `src-tauri/src/lib.rs` → runtime scope | S2 |

## S3 — licensing

### Изменяемые сигнатуры Rust
```rust
// src-tauri/src/shortcuts.rs
impl Default for LicenseState {
    fn default() -> Self {
        LicenseState { has_active_license: AtomicBool::new(false) }  // было true
    }
}

#[tauri::command]
pub fn set_license_status<R: Runtime>(app: AppHandle<R>, has_license: bool) -> Result<(), String>;
// было: _has_license (игнорировался), всегда set_active(true)

// src-tauri/src/shortcuts.rs — move_window теряет гейт лицензии
fn handle_move_window<R: Runtime>(app: &AppHandle<R>, direction: &str);

// src-tauri/src/activate.rs
pub async fn validate_license_api(_app: AppHandle) -> Result<ValidateResponse, String>;
// больше не возвращает константный is_active: true
```

### Зоны владения
| Файл | Владелец |
|---|---|
| `src-tauri/src/shortcuts.rs` | S3 |
| `src-tauri/src/activate.rs` | S3 |
| `src-tauri/src/api.rs` → `check_license_status` | S3 |
| `src/contexts/app.context.tsx` → `getActiveLicenseStatus` | S3 |

## S4 — secret-storage

### Новые модули
```ts
// src/lib/storage/secret-store.ts
export async function saveSecret(key: string, value: string): Promise<void>;
export async function getSecret(key: string): Promise<string | null>;
export async function removeSecret(key: string): Promise<void>;
export async function migrateSecretsFromLocalStorage(): Promise<void>;
```

### Схема ключей секретов
```
ai_provider:<providerId>:API_KEY
stt_provider:<providerId>:API_KEY
web_search:brave
web_search:exa
web_search:tavily
```

### Зоны владения
| Файл | Владелец |
|---|---|
| `src/lib/storage/secret-store.ts` | S4 |
| `src/lib/storage/ai-providers.ts` | S4 |
| `src/lib/storage/stt-providers.ts` | S4 |
| `src/lib/web-search.ts` | S4 |
| `src/lib/functions/stt.function.ts` | S4 |
| Rust-команды секретов | S4 |

## S5 — branding

### Изменяемые идентификаторы (НЕ трогать)
```
identifier:          com.srikanthnani.pluely    ← сохранить
pluely.db            ← сохранить (путь данных)
secure_storage.json  ← сохранить
updater endpoint + pubkey ← сохранить
имя бинарника pluely ← сохранить
```

### Изменяемые значения
```
productName:  Pluely       → Echo AI
version:      0.1.90       → 1.0.0
title окна:   Pluely - ... → Echo AI - ...
tray-меню:    «...Pluely»  → «...Echo AI»
```

### Зоны владения
| Файл | Владелец |
|---|---|
| `src-tauri/tauri.conf.json` (productName, version, title) | S5 |
| `package.json`, `src-tauri/Cargo.toml` (version, description) | S5 |
| `src-tauri/src/tray.rs` | S5 |
| `src-tauri/pluely.desktop`, `src-tauri/info.plist` | S5 |
| `src-tauri/icons/*` | S5 |
| `src/components/Sidebar.tsx`, `Contribute.tsx`, `Promote.tsx`, `src/layouts/ErrorLayout.tsx`, `src/config/shortcuts.ts` | S5 |

## S6 — feature-tiers

### Новый модуль
```ts
// src/lib/entitlements.ts
export type Feature =
  | "dictation" | "meeting" | "localStt" | "byoKey" | "chatHistory" | "customPrompts"
  | "hostedApi" | "screenshot" | "selectionMode" | "themes" | "fonts"
  | "customShortcuts" | "promptGeneration" | "analytics"
  | "responseLength" | "language" | "autoScroll";

export type Tier = "free" | "pro";

export const FEATURE_TIER: Record<Feature, Tier>;
export function canUseFeature(feature: Feature, isDevBuild: boolean, hasLicense: boolean): boolean;
```

### Новый компонент
```tsx
// src/components/UpgradePrompt/index.tsx
interface UpgradePromptProps {
  feature: string;   // человекочитаемое имя возможности
  compact?: boolean;
}
```

### Зоны владения
| Файл | Владелец |
|---|---|
| `src/lib/entitlements.ts` | S6 |
| `src/components/UpgradePrompt/` | S6 |
| `src/pages/chats/components/View.tsx` | S6 |
| `src/pages/responses/**` | S6 |
| `src/pages/settings/components/Theme.tsx` | S6 |
| `src/pages/shortcuts/**`, `src/pages/system-prompts/**`, `src/pages/dashboard/**` | S6 |
| `src/hooks/useChatCompletion.ts`, `src/hooks/useSettings.ts` | S6 |

## Пересечения слайсов (требуют сериализации)

| Файл | Слайсы | Правило |
|---|---|---|
| `src/lib/functions/ai-response.function.ts` | S2 (проверка хоста), S4 (асинхронный ключ) | S2 владеет проверкой хоста, S4 — чтением ключа; S2 идёт первым |
| `src-tauri/tauri.conf.json` | S1 (csp), S5 (productName/version/title) | S1 владеет `app.security`, S5 — остальным; слайсы не пересекаются по ключам, но мердж последовательный |
| `src/contexts/app.context.tsx` | S3 (лицензия), S4 (загрузка ключей), S6 (гейты) | S3 → S4 → S6, строго последовательно |
| `src/components/index.ts` | S2, S6 (новые экспорты) | разные строки, конфликт тривиален |
