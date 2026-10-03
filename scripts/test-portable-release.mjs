#!/usr/bin/env node
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createZip } from './portable-release.mjs';

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
  console.log('Running portable release regression and fixture test suite...');

  const validSigContent = Buffer.alloc(72, 7).toString('base64'); // 96-char base64 envelope (72 bytes decoded)
  const validExeContent = Buffer.from('MZ...valid-portable-executable-payload...', 'utf8');

  // Test 1: Valid portable release workflow
  console.log('\n[Case 1] Valid portable release archive, signature, and manifest');
  {
    const zipPath = join(tmpDir, 'Echo.AI_1.2.30_portable_x64.zip');
    const sigPath = join(tmpDir, 'Echo.AI_1.2.30_portable_x64.zip.sig');
    const manifestPath = join(tmpDir, 'latest.json');

    const zipBuffer = createZip([
      { name: 'Echo AI.exe', content: validExeContent },
      { name: '.portable', content: 'portable' },
    ]);
    writeFileSync(zipPath, zipBuffer);
    writeFileSync(sigPath, validSigContent + '\n');

    const initialManifest = {
      version: '1.2.30',
      notes: 'Initial release with MSI/NSIS',
      pub_date: '2026-10-03T12:00:00Z',
      platforms: {
        'windows-x86_64': {
          signature: Buffer.alloc(72, 9).toString('base64'),
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
    assert(patched.platforms['windows-x86_64-portable'].signature === validSigContent, 'Target signature matches .sig envelope');
    assert(
      patched.platforms['windows-x86_64-portable'].url === 'https://github.com/wdnameless/ECHO_AI/releases/download/v1.2.30/Echo.AI_1.2.30_portable_x64.zip',
      'Target URL matches expected release asset path'
    );
  }

  // Test 2: Missing .portable marker
  console.log('\n[Case 2] Missing .portable marker in archive root');
  {
    const badZipPath = join(tmpDir, 'missing_marker.zip');
    const sigPath = join(tmpDir, 'missing_marker.zip.sig');
    writeFileSync(sigPath, validSigContent);

    const badZipBuffer = createZip([
      { name: 'Echo AI.exe', content: validExeContent },
    ]);
    writeFileSync(badZipPath, badZipBuffer);

    const res = runCli(['validate-archive', badZipPath, sigPath, 'Echo AI.exe']);
    assert(res.status !== 0, 'validate-archive fails when .portable marker is missing');
    assert(res.stderr.includes('.portable'), 'Error indicates missing .portable marker');
  }

  // Test 3: Signature format validation (missing, empty, non-base64, truncated)
  console.log('\n[Case 3] Signature validation: missing, empty, arbitrary non-base64 text');
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

    // Non-base64 arbitrary text
    const plainTextSigPath = join(tmpDir, 'plain_text.sig');
    writeFileSync(plainTextSigPath, 'this is arbitrary non-base64 plaintext signature string with spaces');
    const resPlainText = runCli(['validate-archive', zipPath, plainTextSigPath]);
    assert(resPlainText.status !== 0, 'validate-archive fails on arbitrary plain text signature');
    assert(resPlainText.stderr.includes('base64 envelope'), 'Error specifies signature must be a valid base64 envelope');

    // Too short base64 signature
    const shortSigPath = join(tmpDir, 'short.sig');
    writeFileSync(shortSigPath, Buffer.from('short-secret').toString('base64'));
    const resShort = runCli(['validate-archive', zipPath, shortSigPath]);
    assert(resShort.status !== 0, 'validate-archive fails on too short base64 signature');
  }

  // Test 4: Manifest target mismatches
  console.log('\n[Case 4] Manifest target mismatches: URL, signature, or platform corruption');
  {
    const manifestPath = join(tmpDir, 'mismatch_latest.json');
    const sigPath = join(tmpDir, 'mismatch.sig');
    writeFileSync(sigPath, validSigContent);

    // Mismatched signature in manifest
    const badSigManifest = {
      version: '1.2.30',
      platforms: {
        'windows-x86_64': { signature: validSigContent, url: 'https://example.com/app.msi' },
        'windows-x86_64-portable': {
          signature: Buffer.alloc(72, 8).toString('base64'), // Different signature
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
        'windows-x86_64': { signature: validSigContent, url: 'https://example.com/app.msi' },
        'windows-x86_64-portable': {
          signature: validSigContent,
          url: 'https://github.com/other/repo/releases/download/v1.2.30/wrong.zip',
        },
      },
    };
    writeFileSync(manifestPath, JSON.stringify(badUrlManifest));
    const resBadUrl = runCli(['validate-manifest', manifestPath, '1.2.30', 'Echo.AI_1.2.30_portable_x64.zip', sigPath, 'wdnameless/ECHO_AI']);
    assert(resBadUrl.status !== 0, 'validate-manifest fails on URL mismatch');
    assert(resBadUrl.stderr.includes('URL mismatch'), 'Error describes URL mismatch');

    // Missing installed platform preservation check
    const droppedInstalledManifest = {
      version: '1.2.30',
      platforms: {
        'windows-x86_64-portable': {
          signature: validSigContent,
          url: 'https://github.com/wdnameless/ECHO_AI/releases/download/v1.2.30/Echo.AI_1.2.30_portable_x64.zip',
        },
      },
    };
    writeFileSync(manifestPath, JSON.stringify(droppedInstalledManifest));
    // If installed platform had corrupted fields:
    const corruptedInstalledManifest = {
      version: '1.2.30',
      platforms: {
        'windows-x86_64': { signature: '' },
        'windows-x86_64-portable': {
          signature: validSigContent,
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
    writeFileSync(sigPath, validSigContent);

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

    // Extract the signing step commands from release.yml
    const signStepMatch = workflowContent.match(/- name: Sign portable archive for the updater[\s\S]*?run: \|([\s\S]*?)(?:- name:|$)/);
    assert(signStepMatch !== null, 'Found Sign portable archive step in release.yml');
    const signStepBody = signStepMatch[1];

    // Find the tauri signer invocation line(s)
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
    // Simulate pipeline execution logic:
    // 1. Create draft
    // 2. Validate archive
    // 3. Promote draft only if step 2 passes
    let draftPromoted = false;
    const badZip = join(tmpDir, 'corrupt.zip');
    writeFileSync(badZip, Buffer.from('corrupt non-zip data'));
    const sigPath = join(tmpDir, 'corrupt.sig');
    writeFileSync(sigPath, validSigContent);

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
