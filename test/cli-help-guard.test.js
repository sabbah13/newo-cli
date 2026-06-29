import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Spawn the built CLI in an isolated cwd with NO NEWO credentials. If a
// subcommand actually executed (instead of printing help) it would hit env
// validation or the network — so exit 0 + the help banner proves it did not.
async function runCli(args, env = {}) {
  const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const cwd = await mkdtemp(path.join(tmpdir(), 'newo-cli-help-test-'));
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: { PATH: process.env.PATH, HOME: cwd, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI timed out: ${args.join(' ')}`));
    }, 10_000);
    child.stdout.on('data', (c) => {
      stdout += c.toString();
    });
    child.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// `newo <sub> --help` must print help, NOT execute the subcommand
// (the old dispatcher only matched the positional command, so `push --help`
// fell through to the switch and ran a destructive live push).
for (const sub of ['push', 'conversations', 'pull']) {
  test(`\`${sub} --help\` prints help instead of running ${sub}`, async () => {
    const r = await runCli([sub, '--help']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /NEWO CLI/);
    assert.match(r.stdout, /Core Commands/);
    assert.doesNotMatch(r.stdout + r.stderr, /Environment validation failed/);
    assert.doesNotMatch(r.stdout, /Pushing|Fetching logs|Downloading|Published/);
  });
}

test('`push -h` (short flag) also prints help', async () => {
  const r = await runCli(['push', '-h']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Core Commands/);
});
