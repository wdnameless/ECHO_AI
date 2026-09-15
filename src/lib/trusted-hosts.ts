import { safeLocalStorage } from "@/lib/storage/helper";
import { STORAGE_KEYS } from "@/config/constants";
import { AI_PROVIDERS } from "@/config/ai-providers.constants";
import { SPEECH_TO_TEXT_PROVIDERS } from "@/config/stt.constants";

const DEFAULT_TRUSTED_HOSTS: readonly string[] = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
];

function normalizeHost(hostOrUrl: string): string | null {
  if (!hostOrUrl) return null;
  const trimmed = hostOrUrl.trim();
  if (!trimmed) return null;

  try {
    const url = trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
    return url.hostname.toLowerCase();
  } catch {
    const match = trimmed.match(/^(?:https?:\/\/)?([^/:]+)/i);
    return match ? match[1].toLowerCase() : null;
  }
}

function extractKnownProviderHosts(): Record<string, true> {
  const hosts: Record<string, true> = {};

  for (const provider of AI_PROVIDERS) {
    const host = getHostOfCurlTemplate(provider.curl);
    if (host) {
      hosts[host.toLowerCase()] = true;
    }
  }

  for (const provider of SPEECH_TO_TEXT_PROVIDERS) {
    const host = getHostOfCurlTemplate(provider.curl);
    if (host) {
      hosts[host.toLowerCase()] = true;
    }
  }

  return hosts;
}

const KNOWN_PROVIDER_HOSTS = extractKnownProviderHosts();

export function getHostOfCurlTemplate(curl: string): string | null {
  if (!curl || typeof curl !== "string") return null;

  // Match url in curl command: --url "..." or --url '...' or --location "..." or raw argument
  // Common pattern: --url 'https://...' or --url "https://..." or -X POST 'https://...' or curl 'https://...'
  // Handle {{VAR}} placeholders in domain/protocol
  const urlMatch = curl.match(/(?:--url\s+|--location\s+|curl\s+|['"]https?:\/\/)(['"]?)(https?:\/\/[^\s'"]+)\1/i)
    || curl.match(/https?:\/\/[^\s'"]+/i);

  if (!urlMatch) {
    // Check if URL might be starting with a placeholder e.g. {{BASE_URL}}/v1/...
    const placeholderUrlMatch = curl.match(/['"]?(\{\{[^}]+\}\}[^\s'"]*)['"]?/);
    if (placeholderUrlMatch) {
      // Host cannot be statically determined if baseUrl placeholder is used
      return null;
    }
    return null;
  }

  let rawUrl = urlMatch[2] || urlMatch[0];
  // Strip quotes if any
  rawUrl = rawUrl.replace(/^['"]|['"]$/g, "");

  // If the host itself is a template variable like {{API_HOST}}, we can't extract a static host
  const hostPartMatch = rawUrl.match(/^https?:\/\/([^/:]+)/i);
  if (!hostPartMatch) return null;

  const rawHost = hostPartMatch[1];
  if (rawHost.includes("{{") || rawHost.includes("}}")) {
    return null;
  }

  return rawHost.toLowerCase();
}

export function getTrustedHosts(): string[] {
  const stored = safeLocalStorage.getItem(STORAGE_KEYS.TRUSTED_HOSTS);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {}
  return [];
}

export function isTrustedHost(urlOrHost: string): boolean {
  const host = normalizeHost(urlOrHost);
  if (!host) return false;

  for (const defaultHost of DEFAULT_TRUSTED_HOSTS) {
    if (host === defaultHost) return true;
  }

  if (KNOWN_PROVIDER_HOSTS[host]) {
    return true;
  }

  const userTrusted = getTrustedHosts();
  for (const trusted of userTrusted) {
    if (normalizeHost(trusted) === host) {
      return true;
    }
  }

  return false;
}

export function trustHost(host: string): void {
  const normalized = normalizeHost(host);
  if (!normalized) return;

  const current = getTrustedHosts();
  const set: Record<string, true> = {};
  for (const h of current) {
    const n = normalizeHost(h);
    if (n) set[n] = true;
  }
  set[normalized] = true;

  safeLocalStorage.setItem(STORAGE_KEYS.TRUSTED_HOSTS, JSON.stringify(Object.keys(set)));
}

export function untrustHost(host: string): void {
  const normalized = normalizeHost(host);
  if (!normalized) return;

  const current = getTrustedHosts();
  const filtered = current.filter((h) => normalizeHost(h) !== normalized);
  safeLocalStorage.setItem(STORAGE_KEYS.TRUSTED_HOSTS, JSON.stringify(filtered));
}
