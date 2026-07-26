/**
 * Global vitest setup: redirect `TOKENBOT_HOME` to a per-process temp
 * directory so tests can't accidentally read or write the developer's
 * real `~/.tokenbot/...` files, and reset the in-process passphrase
 * cache between tests.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { __resetContextCacheForTesting } from '../context.js';

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'tokenbot-cli-test-'));
  process.env['TOKENBOT_HOME'] = tmpRoot;
});

afterEach(() => {
  __resetContextCacheForTesting();
});

afterAll(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});
