#!/usr/bin/env node
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const MAX_ARCHIVE_SIZE = 250 * 1024 * 1024; // 250 MB
const MAX_EXE_SIZE = 250 * 1024 * 1024;
const MAX_PORTABLE_MARKER_SIZE = 1024; // 1 KB
const MIN_SIGNATURE_DECODED_BYTES = 64; // Tauri/minisign signature envelope

export function validateSignatureFormat(rawSignature) {
  if (typeof rawSignature !== 'string') {
    throw new Error('Signature must be a string');
  }
  const clean = rawSignature.trim().replace(/\r?\n/g, '');
  if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) {
    throw new Error('Signature must be a valid base64 envelope as produced by Tauri CLI signer');
  }
  const decoded = Buffer.from(clean, 'base64');
  if (decoded.length < MIN_SIGNATURE_DECODED_BYTES) {
    throw new Error(`Signature decoded length (${decoded.length} bytes) is too short for a Tauri signature (minimum ${MIN_SIGNATURE_DECODED_BYTES} bytes)`);
  }
  return clean;
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

export function createZip(entries) {
  const parts = [];
  const cdParts = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const content = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content || '', 'utf8');
    const crc = crc32(content);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8); // Store
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(content.length, 18);
    lh.writeUInt32LE(content.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    parts.push(lh, nameBuf, content);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(0, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(content.length, 20);
    cdh.writeUInt32LE(content.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);
    cdParts.push(cdh, nameBuf);

    offset += 30 + nameBuf.length + content.length;
  }

  const cdOffset = offset;
  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, cdBuf, eocd]);
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

  const cleanVersion = version.replace(/^v/, '');
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

export function verifySignInvocation(args) {
  const joined = args.join(' ');

  if (args.includes('--write-signature-file') || /--write-signature-file\b/.test(joined)) {
    throw new Error("unsupported option: '--write-signature-file' is not supported by Tauri v2 CLI (signer creates .sig by default)");
  }

  if (/npx\s+--yes/.test(joined) || /@tauri-apps\/cli@/.test(joined)) {
    throw new Error("unsupported invocation: floating CLI version fetched; use npm-ci-installed CLI ('npx --no-install tauri')");
  }

  if (!joined.includes('signer') || !joined.includes('sign')) {
    throw new Error("invalid signing invocation: command must invoke 'signer sign'");
  }

  if (!joined.includes('--private-key') || !joined.includes('--password')) {
    throw new Error("invalid signing invocation: missing '--private-key' or '--password'");
  }

  return true;
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
      case 'verify-sign-invocation': {
        if (rest.length === 0) {
          throw new Error('usage: verify-sign-invocation <args...>');
        }
        verifySignInvocation(rest);
        console.log('Verified signing invocation: supported options and local CLI');
        break;
      }
      default:
        console.error(`Unknown command '${cmd}'. Available: validate-archive, patch-manifest, validate-manifest, verify-sign-invocation`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`portable-release error: ${err.message}`);
    process.exit(1);
  }
}
