#!/usr/bin/env node
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MAX_ARCHIVE_SIZE = 250 * 1024 * 1024; // 250 MB
const MAX_EXE_SIZE = 250 * 1024 * 1024;
const MAX_PORTABLE_MARKER_SIZE = 1024; // 1 KB

export function validateSignatureFormat(rawSignature) {
  if (typeof rawSignature !== 'string') {
    throw new Error('Signature must be a string');
  }
  const trimmed = rawSignature.trim();
  if (trimmed.length === 0) {
    throw new Error('Signature is empty');
  }

  let decodedText;
  let canonicalBase64;

  // Check 1: Base64-encoded envelope (standard Tauri single-line format)
  const singleLine = trimmed.replace(/\r?\n/g, '');
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(singleLine)) {
    try {
      const candidateText = Buffer.from(singleLine, 'base64').toString('utf8');
      if (candidateText.includes('untrusted comment:') && candidateText.includes('trusted comment:')) {
        decodedText = candidateText;
        canonicalBase64 = singleLine;
      }
    } catch {}
  }

  // Check 2: Raw multiline minisign text format (canonicalize to base64 envelope)
  if (!decodedText) {
    if (trimmed.includes('untrusted comment:') && trimmed.includes('trusted comment:')) {
      decodedText = trimmed;
      canonicalBase64 = Buffer.from(trimmed, 'utf8').toString('base64');
    }
  }

  if (!decodedText || !canonicalBase64) {
    throw new Error("Invalid signature format: expected Tauri minisign envelope containing 'untrusted comment:' and 'trusted comment:' headers");
  }

  // Validate the 4-line minisign structure and base64 syntax of signature lines
  const lines = decodedText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 4) {
    throw new Error(`Incomplete minisign envelope: expected at least 4 lines, found ${lines.length}`);
  }

  const [untrustedHeader, sigLine1, trustedHeader, sigLine2] = lines;
  if (!untrustedHeader.startsWith('untrusted comment:')) {
    throw new Error("Invalid minisign envelope: line 1 must begin with 'untrusted comment:'");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(sigLine1)) {
    throw new Error('Invalid minisign envelope: line 2 signature data is not valid base64');
  }
  if (!trustedHeader.startsWith('trusted comment:')) {
    throw new Error("Invalid minisign envelope: line 3 must begin with 'trusted comment:'");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(sigLine2)) {
    throw new Error('Invalid minisign envelope: line 4 global signature data is not valid base64');
  }

  // Always return the canonical single-line base64 envelope
  return canonicalBase64;
}

export function readZipEntries(buffer) {
  if (buffer.length < 22) {
    throw new Error('File too small to be a valid ZIP archive');
  }

  let eocdOffset = -1;
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= minOffset; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP archive: End of Central Directory record not found');
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (cdOffset + cdSize > eocdOffset) {
    throw new Error('Invalid ZIP archive: corrupt Central Directory layout');
  }

  const entries = [];
  let pos = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error(`Invalid ZIP archive: corrupted Central Directory header at index ${i}`);
    }
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const uncompressedSize = buffer.readUInt32LE(pos + 24);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);

    const nameStart = pos + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > buffer.length) {
      throw new Error(`Invalid ZIP archive: truncated entry name at index ${i}`);
    }
    const name = buffer.toString('utf8', nameStart, nameEnd);
    entries.push({
      name,
      compressedSize,
      uncompressedSize,
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

export function validateArchive(archivePath, sigPath, expectedExeName = 'Echo AI.exe') {
  if (!existsSync(archivePath)) {
    throw new Error(`Archive file not found: ${archivePath}`);
  }
  const archiveStat = statSync(archivePath);
  if (archiveStat.size === 0) {
    throw new Error(`Archive file is empty: ${archivePath}`);
  }
  if (archiveStat.size > MAX_ARCHIVE_SIZE) {
    throw new Error(`Archive size (${archiveStat.size} bytes) exceeds limit (${MAX_ARCHIVE_SIZE} bytes)`);
  }

  if (!existsSync(sigPath)) {
    throw new Error(`Signature file not found: ${sigPath}`);
  }
  const rawSig = readFileSync(sigPath, 'utf8');
  const validSig = validateSignatureFormat(rawSig);

  const buffer = readFileSync(archivePath);
  const entries = readZipEntries(buffer);

  if (entries.length !== 2) {
    throw new Error(`Archive must contain exactly 2 root entries, found ${entries.length}: ${entries.map(e => e.name).join(', ')}`);
  }

  const names = new Set(entries.map(e => e.name));

  for (const entry of entries) {
    if (entry.name.includes('/') || entry.name.includes('\\') || entry.name.includes('..')) {
      throw new Error(`Archive entry '${entry.name}' is not a flat root entry or contains traversal`);
    }
  }

  if (!names.has(expectedExeName)) {
    throw new Error(`Archive is missing expected application executable '${expectedExeName}'`);
  }
  if (!names.has('.portable')) {
    throw new Error("Archive is missing required '.portable' marker at root");
  }

  const exeEntry = entries.find(e => e.name === expectedExeName);
  if (!exeEntry || exeEntry.uncompressedSize === 0) {
    throw new Error(`Application executable '${expectedExeName}' is empty`);
  }
  if (exeEntry.uncompressedSize > MAX_EXE_SIZE) {
    throw new Error(`Application executable size (${exeEntry.uncompressedSize}) exceeds maximum (${MAX_EXE_SIZE})`);
  }

  const markerEntry = entries.find(e => e.name === '.portable');
  if (markerEntry && markerEntry.uncompressedSize > MAX_PORTABLE_MARKER_SIZE) {
    throw new Error(`.portable marker size (${markerEntry.uncompressedSize}) exceeds maximum (${MAX_PORTABLE_MARKER_SIZE})`);
  }

  return {
    archiveSize: archiveStat.size,
    entries: entries.map(e => ({ name: e.name, size: e.uncompressedSize })),
    signatureLength: validSig.length,
  };
}

export function patchManifest(latestJsonPath, version, archiveName, sigPath, repoSlug, outputPath = latestJsonPath) {
  if (!existsSync(latestJsonPath)) {
    throw new Error(`Manifest file not found: ${latestJsonPath}`);
  }
  if (!existsSync(sigPath)) {
    throw new Error(`Signature file not found: ${sigPath}`);
  }
  const rawSig = readFileSync(sigPath, 'utf8');
  const signature = validateSignatureFormat(rawSig);

  const raw = readFileSync(latestJsonPath, 'utf8');
  const manifest = JSON.parse(raw);
  if (!manifest.platforms || typeof manifest.platforms !== 'object') {
    manifest.platforms = {};
  }

  const cleanVersion = version.replace(/^v/, '');
  const cleanRepo = repoSlug.replace(/^\/+|\/+$/g, '');
  const url = `https://github.com/${cleanRepo}/releases/download/v${cleanVersion}/${archiveName}`;

  manifest.platforms['windows-x86_64-portable'] = {
    signature,
    url,
  };

  writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifest;
}

export function validateManifest(latestJsonPath, version, archiveName, sigPath, repoSlug) {
  if (!existsSync(latestJsonPath)) {
    throw new Error(`Manifest file not found: ${latestJsonPath}`);
  }
  if (!existsSync(sigPath)) {
    throw new Error(`Signature file not found: ${sigPath}`);
  }
  const rawSig = readFileSync(sigPath, 'utf8');
  const expectedSig = validateSignatureFormat(rawSig);

  const raw = readFileSync(latestJsonPath, 'utf8');
  const manifest = JSON.parse(raw);

  const cleanVersion = version.replace(/^v/, '');
  if (!manifest.version || manifest.version.replace(/^v/, '') !== cleanVersion) {
    throw new Error(`Manifest version mismatch: expected '${cleanVersion}', got '${manifest.version}'`);
  }

  if (!manifest.platforms || typeof manifest.platforms !== 'object') {
    throw new Error("Manifest is missing 'platforms' object");
  }

  const portable = manifest.platforms['windows-x86_64-portable'];
  if (!portable || typeof portable !== 'object') {
    throw new Error("Manifest is missing 'windows-x86_64-portable' target in platforms");
  }

  if (!portable.signature || typeof portable.signature !== 'string') {
    throw new Error("Manifest portable target is missing valid 'signature'");
  }
  const manifestSig = validateSignatureFormat(portable.signature);
  if (manifestSig !== expectedSig) {
    throw new Error("Manifest portable target signature does not match .sig file contents");
  }

  const cleanRepo = repoSlug.replace(/^\/+|\/+$/g, '');
  const expectedUrl = `https://github.com/${cleanRepo}/releases/download/v${cleanVersion}/${archiveName}`;

  if (portable.url !== expectedUrl) {
    throw new Error(`Manifest portable target URL mismatch: expected '${expectedUrl}', got '${portable.url}'`);
  }

  // Preserve installed MSI/NSIS platform if present
  if (manifest.platforms['windows-x86_64']) {
    const installed = manifest.platforms['windows-x86_64'];
    if (!installed.url || !installed.signature) {
      throw new Error("Manifest installed target 'windows-x86_64' was corrupted (missing url or signature)");
    }
  }

  return manifest;
}


// CLI Dispatcher
if (process.argv[1] && (process.argv[1].endsWith('portable-release.mjs') || import.meta.url === pathToFileURL(process.argv[1]).href)) {
  const [,, cmd, ...rest] = process.argv;

  try {
    switch (cmd) {
      case 'validate-archive': {
        const [archivePath, sigPath, expectedExe] = rest;
        if (!archivePath || !sigPath) {
          throw new Error('usage: validate-archive <archivePath> <sigPath> [expectedExeName]');
        }
        const res = validateArchive(archivePath, sigPath, expectedExe || 'Echo AI.exe');
        console.log(`Validated archive '${archivePath}': ${res.entries.map(e => `${e.name} (${e.size}B)`).join(', ')}`);
        break;
      }
      case 'patch-manifest': {
        const [latestJsonPath, version, archiveName, sigPath, repoSlug, outPath] = rest;
        if (!latestJsonPath || !version || !archiveName || !sigPath || !repoSlug) {
          throw new Error('usage: patch-manifest <latestJsonPath> <version> <archiveName> <sigPath> <repoSlug> [outPath]');
        }
        patchManifest(latestJsonPath, version, archiveName, sigPath, repoSlug, outPath || latestJsonPath);
        console.log(`Patched manifest '${latestJsonPath}' with portable target for v${version.replace(/^v/, '')}`);
        break;
      }
      case 'validate-manifest': {
        const [latestJsonPath, version, archiveName, sigPath, repoSlug] = rest;
        if (!latestJsonPath || !version || !archiveName || !sigPath || !repoSlug) {
          throw new Error('usage: validate-manifest <latestJsonPath> <version> <archiveName> <sigPath> <repoSlug>');
        }
        validateManifest(latestJsonPath, version, archiveName, sigPath, repoSlug);
        console.log(`Validated manifest '${latestJsonPath}' portable target`);
        break;
      }
      default:
        console.error(`Unknown command '${cmd}'. Available: validate-archive, patch-manifest, validate-manifest`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`portable-release error: ${err.message}`);
    process.exit(1);
  }
}
