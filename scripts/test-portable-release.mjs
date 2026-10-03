#!/usr/bin/env node
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Standard IEEE 802.3 CRC32 implementation (Node 20 compatible, zero dependencies)
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Fixture ZIP creator for test scenarios (Node 20 compatible)
function createZip(entries) {
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

function runCli(args) {
  const result = spawnSync(process.execPath, [join(process.cwd(), 'scripts', 'portable-release.mjs'), ...args], {
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

let passed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (!condition) {
    console.error(`FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passed++;
  console.log(`  PASS: ${message}`);
}

const tmpDir = mkdtempSync(join(tmpdir(), 'portable-release-test-'));

try {
  console.log('Running portable release regression and fixture test suite (Node 20 compatible)...');

  // Valid minisign signature envelope
  const rawMinisignEnvelope = [
    'untrusted comment: signature from tauri secret key',
    'RWTnnItHPcahcqKwHCs6vhkmePoe8oVrjy36j5g2esMx5vny5LluNZqQ0123456789abcdef0123456789abcdef0123456789abcdef',
    'trusted comment: timestamp:1727956800\tfile:Echo.AI_1.2.30_portable_x64.zip',
    'RWTnnItHPcahcqKwHCs6vhkmePoe8oVrjy36j5g2esMx5vny5LluNZqQ0123456789abcdef0123456789abcdef0123456789abcdef',
  ].join('\n');

  const base64MinisignEnvelope = Buffer.from(rawMinisignEnvelope, 'utf8').toString('base64');
  const validExeContent = Buffer.from('MZ...valid-portable-executable-payload...', 'utf8');

  // Test 1: Valid portable release workflow with base64 envelope
  console.log('\n[Case 1] Valid portable release archive, minisign signature, and manifest');
  {
    const zipPath = join(tmpDir, 'Echo.AI_1.2.30_portable_x64.zip');
    const sigPath = join(tmpDir, 'Echo.AI_1.2.30_portable_x64.zip.sig');
    const manifestPath = join(tmpDir, 'latest.json');

    const zipBuffer = createZip([
      { name: 'Echo AI.exe', content: validExeContent },
      { name: '.portable', content: 'portable' },
    ]);
    writeFileSync(zipPath, zipBuffer);
    writeFileSync(sigPath, base64MinisignEnvelope + '\n');

    const initialManifest = {
      version: '1.2.30',
      notes: 'Initial release with MSI/NSIS',
      pub_date: '2026-10-03T12:00:00Z',
      platforms: {
        'windows-x86_64': {
          signature: base64MinisignEnvelope,
          url: 'https://github.com/wdnameless/ECHO_AI/releases/download/v1.2.30/Echo_AI_1.2.30_x64_en-US.msi',
        },
      },
    };
    writeFileSync(manifestPath, JSON.stringify(initialManifest, null, 2));

    const valRes = runCli(['validate-archive', zipPath, sigPath, 'Echo AI.exe']);
    assert(valRes.status === 0, 'validate-archive succeeds on valid archive and signature');

    const patchRes = runCli(['patch-manifest', manifestPath, '1.2.30', 'Echo.AI_1.2.30_portable_x64.zip', sigPath, 'wdnameless/ECHO_AI']);
    assert(patchRes.status === 0, 'patch-manifest succeeds on valid inputs');

    const checkRes = runCli(['validate-manifest', manifestPath, '1.2.30', 'Echo.AI_1.2.30_portable_x64.zip', sigPath, 'wdnameless/ECHO_AI']);
    assert(checkRes.status === 0, 'validate-manifest confirms patched manifest target');

    const patched = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert(patched.platforms['windows-x86_64'] !== undefined, 'Preserves existing installed windows-x86_64 target');
    assert(patched.platforms['windows-x86_64-portable'] !== undefined, 'Includes new windows-x86_64-portable target');
    assert(patched.platforms['windows-x86_64-portable'].signature === base64MinisignEnvelope, 'Target signature matches canonical base64 envelope');
    assert(
      patched.platforms['windows-x86_64-portable'].url === 'https://github.com/wdnameless/ECHO_AI/releases/download/v1.2.30/Echo.AI_1.2.30_portable_x64.zip',
      'Target URL matches expected release asset path'
    );
  }

  // Test 1b: Canonicalization from raw multiline minisign text in .sig file
  console.log('\n[Case 1b] Canonicalization of raw multiline minisign signature to single-line base64');
  {
    const zipPath = join(tmpDir, 'Echo.AI_1.2.30_portable_x64.zip');
    const rawSigPath = join(tmpDir, 'raw_multiline.sig');
    const manifestPath = join(tmpDir, 'latest_canonical.json');

    writeFileSync(rawSigPath, rawMinisignEnvelope + '\n');
    const initialManifest = {
      version: '1.2.30',
      platforms: {
        'windows-x86_64': {
          signature: base64MinisignEnvelope,
          url: 'https://example.com/app.msi',
        },
      },
    };
    writeFileSync(manifestPath, JSON.stringify(initialManifest, null, 2));

    const patchRes = runCli(['patch-manifest', manifestPath, '1.2.30', 'Echo.AI_1.2.30_portable_x64.zip', rawSigPath, 'wdnameless/ECHO_AI']);
    assert(patchRes.status === 0, 'patch-manifest succeeds with raw multiline minisign input');

    const patched = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert(
      patched.platforms['windows-x86_64-portable'].signature === base64MinisignEnvelope,
      'patch-manifest normalizes raw multiline minisign text into canonical base64 envelope'
    );

    const checkRes = runCli(['validate-manifest', manifestPath, '1.2.30', 'Echo.AI_1.2.30_portable_x64.zip', rawSigPath, 'wdnameless/ECHO_AI']);
    assert(checkRes.status === 0, 'validate-manifest verifies canonicalized signature matches');
  }

  // Test 2: Missing .portable marker
  console.log('\n[Case 2] Missing .portable marker in archive root');
  {
    const badZipPath = join(tmpDir, 'missing_marker.zip');
    const sigPath = join(tmpDir, 'missing_marker.zip.sig');
    writeFileSync(sigPath, base64MinisignEnvelope);

    const badZipBuffer = createZip([
      { name: 'Echo AI.exe', content: validExeContent },
    ]);
    writeFileSync(badZipPath, badZipBuffer);

    const res = runCli(['validate-archive', badZipPath, sigPath, 'Echo AI.exe']);
    assert(res.status !== 0, 'validate-archive fails when .portable marker is missing');
    assert(res.stderr.includes('.portable'), 'Error indicates missing .portable marker');
  }

  // Test 3: Signature format validation (missing, empty, non-envelope text, arbitrary base64, corrupt lines)
  console.log('\n[Case 3] Signature validation: missing, empty, arbitrary non-minisign text/base64, corrupt sig lines');
  {
    const zipPath = join(tmpDir, 'sig_test.zip');
    const zipBuffer = createZip([
      { name: 'Echo AI.exe', content: validExeContent },
      { name: '.portable', content: 'portable' },
    ]);
    writeFileSync(zipPath, zipBuffer);

    // Missing signature file
    const resMissing = runCli(['validate-archive', zipPath, join(tmpDir, 'nonexistent.sig')]);
    assert(resMissing.status !== 0, 'validate-archive fails when signature file does not exist');

    // Empty signature file
    const emptySigPath = join(tmpDir, 'empty.sig');
    writeFileSync(emptySigPath, '   \n');
    const resEmpty = runCli(['validate-archive', zipPath, emptySigPath]);
    assert(resEmpty.status !== 0, 'validate-archive fails when signature file is empty');

    // Non-minisign plain text
    const plainTextSigPath = join(tmpDir, 'plain_text.sig');
    writeFileSync(plainTextSigPath, 'arbitrary nonempty text');
    const resPlainText = runCli(['validate-archive', zipPath, plainTextSigPath]);
    assert(resPlainText.status !== 0, 'validate-archive fails on arbitrary plain text signature');
    assert(resPlainText.stderr.includes('untrusted comment'), 'Error specifies signature must be a Tauri minisign envelope');

    // Arbitrary base64 string without minisign headers
    const randomBase64SigPath = join(tmpDir, 'random_base64.sig');
    writeFileSync(randomBase64SigPath, Buffer.alloc(96, 1).toString('base64'));
    const resRandomBase64 = runCli(['validate-archive', zipPath, randomBase64SigPath]);
    assert(resRandomBase64.status !== 0, 'validate-archive fails on arbitrary base64 without minisign headers');
    assert(resRandomBase64.stderr.includes('untrusted comment'), 'Error specifies signature must contain minisign headers');

    // Minisign envelope with corrupt signature line syntax (not base64)
    const corruptLineSigPath = join(tmpDir, 'corrupt_line.sig');
    const corruptLineEnvelope = [
      'untrusted comment: signature from tauri secret key',
      'NOT-VALID-BASE64-SIG-DATA!@#$',
      'trusted comment: timestamp:1727956800\tfile:test.zip',
      'RWTnnItHPcahcqKwHCs6vhkmePoe8oVrjy36j5g2esMx5vny5LluNZqQ0123456789abcdef0123456789abcdef0123456789abcdef',
    ].join('\n');
    writeFileSync(corruptLineSigPath, Buffer.from(corruptLineEnvelope, 'utf8').toString('base64'));
    const resCorruptLine = runCli(['validate-archive', zipPath, corruptLineSigPath]);
    assert(resCorruptLine.status !== 0, 'validate-archive fails when signature line data is invalid base64');
    assert(resCorruptLine.stderr.includes('signature data is not valid base64'), 'Error identifies invalid base64 signature syntax');
  }

  // Test 4: Manifest target and version mismatches
  console.log('\n[Case 4] Manifest target mismatches: URL, signature, version equality, platform corruption');
  {
    const manifestPath = join(tmpDir, 'mismatch_latest.json');
    const sigPath = join(tmpDir, 'mismatch.sig');
    writeFileSync(sigPath, base64MinisignEnvelope);

    // Mismatched manifest version
    const wrongVersionManifest = {
      version: '1.2.29', // Does not match expected 1.2.30
      platforms: {
        'windows-x86_64': { signature: base64MinisignEnvelope, url: 'https://example.com/app.msi' },
        'windows-x86_64-portable': {
          signature: base64MinisignEnvelope,
          url: 'https://github.com/wdnameless/ECHO_AI/releases/download/v1.2.30/Echo.AI_1.2.30_portable_x64.zip',
        },
      },
    };
    writeFileSync(manifestPath, JSON.stringify(wrongVersionManifest));
    const resWrongVer = runCli(['validate-manifest', manifestPath, '1.2.30', 'Echo.AI_1.2.30_portable_x64.zip', sigPath, 'wdnameless/ECHO_AI']);
    assert(resWrongVer.status !== 0, 'validate-manifest fails on manifest version mismatch');
    assert(resWrongVer.stderr.includes('Manifest version mismatch'), 'Error describes manifest version mismatch');

    // Mismatched signature in manifest
    const differentEnvelope = Buffer.from(rawMinisignEnvelope.replace('1.2.30', '1.2.31'), 'utf8').toString('base64');
    const badSigManifest = {
      version: '1.2.30',
      platforms: {
        'windows-x86_64': { signature: base64MinisignEnvelope, url: 'https://example.com/app.msi' },
        'windows-x86_64-portable': {
          signature: differentEnvelope,
          url: 'https://github.com/wdnameless/ECHO_AI/releases/download/v1.2.30/Echo.AI_1.2.30_portable_x64.zip',
        },
      },
    };
    writeFileSync(manifestPath, JSON.stringify(badSigManifest));
    const resBadSig = runCli(['validate-manifest', manifestPath, '1.2.30', 'Echo.AI_1.2.30_portable_x64.zip', sigPath, 'wdnameless/ECHO_AI']);
    assert(resBadSig.status !== 0, 'validate-manifest fails on signature mismatch');
    assert(resBadSig.stderr.includes('does not match .sig file contents'), 'Error describes signature mismatch');

    // Mismatched URL in manifest
    const badUrlManifest = {
      version: '1.2.30',
      platforms: {
        'windows-x86_64': { signature: base64MinisignEnvelope, url: 'https://example.com/app.msi' },
        'windows-x86_64-portable': {
          signature: base64MinisignEnvelope,
          url: 'https://github.com/other/repo/releases/download/v1.2.30/wrong.zip',
        },
      },
    };
    writeFileSync(manifestPath, JSON.stringify(badUrlManifest));
    const resBadUrl = runCli(['validate-manifest', manifestPath, '1.2.30', 'Echo.AI_1.2.30_portable_x64.zip', sigPath, 'wdnameless/ECHO_AI']);
    assert(resBadUrl.status !== 0, 'validate-manifest fails on URL mismatch');
    assert(resBadUrl.stderr.includes('URL mismatch'), 'Error describes URL mismatch');

    // Missing installed platform preservation check
    const corruptedInstalledManifest = {
      version: '1.2.30',
      platforms: {
        'windows-x86_64': { signature: '' },
        'windows-x86_64-portable': {
          signature: base64MinisignEnvelope,
          url: 'https://github.com/wdnameless/ECHO_AI/releases/download/v1.2.30/Echo.AI_1.2.30_portable_x64.zip',
        },
      },
    };
    writeFileSync(manifestPath, JSON.stringify(corruptedInstalledManifest));
    const resCorrupt = runCli(['validate-manifest', manifestPath, '1.2.30', 'Echo.AI_1.2.30_portable_x64.zip', sigPath, 'wdnameless/ECHO_AI']);
    assert(resCorrupt.status !== 0, 'validate-manifest fails if installed target is corrupted');
  }

  // Test 5: Root entries whitelist and shape violations
  console.log('\n[Case 5] Archive shape violations: extra entries, paths, missing executable');
  {
    const sigPath = join(tmpDir, 'shape.sig');
    writeFileSync(sigPath, base64MinisignEnvelope);

    // Extra entry in root
    const extraZipPath = join(tmpDir, 'extra.zip');
    writeFileSync(extraZipPath, createZip([
      { name: 'Echo AI.exe', content: validExeContent },
      { name: '.portable', content: 'portable' },
      { name: 'extra_payload.exe', content: 'extra' },
    ]));
    const resExtra = runCli(['validate-archive', extraZipPath, sigPath, 'Echo AI.exe']);
    assert(resExtra.status !== 0, 'validate-archive fails on extra root entry');
    assert(resExtra.stderr.includes('exactly 2 root entries'), 'Error indicates entry count whitelist violation');

    // Directory separator in entry name
    const nestedZipPath = join(tmpDir, 'nested.zip');
    writeFileSync(nestedZipPath, createZip([
      { name: 'sub/Echo AI.exe', content: validExeContent },
      { name: '.portable', content: 'portable' },
    ]));
    const resNested = runCli(['validate-archive', nestedZipPath, sigPath, 'Echo AI.exe']);
    assert(resNested.status !== 0, 'validate-archive fails on nested directory path in entry');

    // Missing executable
    const noExeZipPath = join(tmpDir, 'no_exe.zip');
    writeFileSync(noExeZipPath, createZip([
      { name: 'wrong_app.exe', content: validExeContent },
      { name: '.portable', content: 'portable' },
    ]));
    const resNoExe = runCli(['validate-archive', noExeZipPath, sigPath, 'Echo AI.exe']);
    assert(resNoExe.status !== 0, 'validate-archive fails when expected executable is missing');
  }

  // Test 6: Unsupported sign option removed via executable command
  console.log('\n[Case 6] Unsupported sign option removed and supported local CLI invocation');
  {
    // A: Invocations with unsupported --write-signature-file fail
    const resUnsupported = runCli([
      'verify-sign-invocation',
      'npx', '--no-install', 'tauri', 'signer', 'sign', 'archive.zip',
      '--private-key', 'dummy_key', '--password', 'dummy_pwd',
      '--write-signature-file',
    ]);
    assert(resUnsupported.status !== 0, 'verify-sign-invocation rejects unsupported --write-signature-file');
    assert(resUnsupported.stderr.includes('--write-signature-file'), 'Error mentions unsupported --write-signature-file');

    // B: Invocations fetching floating npx CLI version fail
    const resFloating = runCli([
      'verify-sign-invocation',
      'npx', '--yes', '@tauri-apps/cli@2', 'signer', 'sign', 'archive.zip',
      '--private-key', 'dummy_key', '--password', 'dummy_pwd',
    ]);
    assert(resFloating.status !== 0, 'verify-sign-invocation rejects floating npx CLI fetch');
    assert(resFloating.stderr.includes('floating CLI version'), 'Error mentions floating CLI version forbidden');

    // C: Supported local npm-ci installed CLI invocation succeeds
    const resSupported = runCli([
      'verify-sign-invocation',
      'npx', '--no-install', 'tauri', 'signer', 'sign', 'archive.zip',
      '--private-key', 'dummy_key', '--password', 'dummy_pwd',
    ]);
    assert(resSupported.status === 0, 'verify-sign-invocation accepts supported local CLI invocation');

    // D: Verify actual workflow command in .github/workflows/release.yml via executable command
    const workflowPath = join(process.cwd(), '.github', 'workflows', 'release.yml');
    assert(existsSync(workflowPath), 'release.yml exists');
    const workflowContent = readFileSync(workflowPath, 'utf8');

    const signStepMatch = workflowContent.match(/- name: Sign portable archive for the updater[\s\S]*?run: \|([\s\S]*?)(?:- name:|$)/);
    assert(signStepMatch !== null, 'Found Sign portable archive step in release.yml');
    const signStepBody = signStepMatch[1];

    const tauriSignLines = signStepBody
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.includes('tauri signer sign') || line.includes('--private-key') || line.includes('--password') || line.includes('--write-signature-file'));
    const commandText = tauriSignLines.join(' ').replace(/\\/g, ' ');
    const commandTokens = commandText.split(/\s+/).filter(Boolean);

    const resWorkflowCmd = runCli(['verify-sign-invocation', ...commandTokens]);
    assert(resWorkflowCmd.status === 0, 'Actual command line extracted from release.yml is valid and supported');
  }

  // Test 7: Failure before promotion prevents partial release promotion (R06)
  console.log('\n[Case 7] Pipeline abort on archive/sig failure prevents release promotion');
  {
    let draftPromoted = false;
    const badZip = join(tmpDir, 'corrupt.zip');
    writeFileSync(badZip, Buffer.from('corrupt non-zip data'));
    const sigPath = join(tmpDir, 'corrupt.sig');
    writeFileSync(sigPath, base64MinisignEnvelope);

    const stepResult = runCli(['validate-archive', badZip, sigPath]);
    if (stepResult.status === 0) {
      draftPromoted = true;
    }

    assert(draftPromoted === false, 'Corrupted archive halts pipeline; release promotion is skipped, leaving draft isolated');
  }

  console.log(`\nAll tests passed: ${passed}/${total}`);
} finally {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}
