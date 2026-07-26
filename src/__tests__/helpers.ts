/**
 * Shared test helpers for the tokenbot-cli.
 *
 * - `seedConfig`: writes a valid config.json under `TOKENBOT_HOME` and
 *   resets the context cache so subsequent `getAuthenticatedContext`
 *   calls re-load it.
 * - `captureStdout` / `captureStderr`: collect everything printed
 *   during an action and return the stripped text.
 * - `makePassphrase`: returns a stub prompt function for tests.
 *
 * These do NOT mock the SDK directly — most tests inject a fake
 * `fetchImpl` into the context options and queue responses, matching
 * the pattern used by the SDK's own tests.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import {
  generateIdentity,
  saveConfig,
  type GeneratedIdentity,
} from '@tokenbot-org/cli-core';
import { __resetContextCacheForTesting } from '../context.js';
import { setJsonMode } from '../util/output.js';

export const TEST_PASSPHRASE = 'test-passphrase';

/** Result of `seedConfig`. */
export interface SeededIdentity {
  identity: GeneratedIdentity;
  accountId: string;
  passphrase: string;
}

/** Use a fresh `TOKENBOT_HOME` for the test then write a valid config. */
export async function seedConfig(opts: { accountId?: string } = {}): Promise<SeededIdentity> {
  const home = mkdtempSync(join(tmpdir(), 'tokenbot-cli-seed-'));
  process.env['TOKENBOT_HOME'] = home;
  const identity = generateIdentity(TEST_PASSPHRASE);
  const accountId = opts.accountId ?? 'acct-test-1';
  await saveConfig({
    accountId,
    publicKey: identity.publicKey,
    encryptedPrivateKey: identity.encryptedPrivateKey,
    privateKeySalt: identity.salt,
    apiUrl: 'https://api.example.com',
    wsUrl: 'wss://api.example.com/graphql',
    createdAt: new Date('2026-05-17T00:00:00Z'),
  });
  __resetContextCacheForTesting();
  setJsonMode(false);
  return { identity, accountId, passphrase: TEST_PASSPHRASE };
}

/** Drop a previously-seeded config dir. */
export function clearSeed(): void {
  const home = process.env['TOKENBOT_HOME'];
  if (home && home.startsWith(tmpdir())) {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
  __resetContextCacheForTesting();
  setJsonMode(false);
}

/** Capture everything written to stdout via console.log during an async fn. */
export async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const buf: string[] = [];
  console.log = (...args: unknown[]) => {
    buf.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return buf.join('\n');
}

/** Capture stderr similarly. */
export async function captureStderr(fn: () => Promise<void>): Promise<string> {
  const original = console.error;
  const buf: string[] = [];
  console.error = (...args: unknown[]) => {
    buf.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  };
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return buf.join('\n');
}

/** Stub passphrase prompt that returns the test passphrase. */
export function makePassphrase(value = TEST_PASSPHRASE): () => Promise<string> {
  return vi.fn(async () => value);
}

/** Build a queue-driven fake fetch matching the SDK's helpers contract. */
export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export interface FakeFetch {
  fetchImpl: typeof fetch;
  calls: CapturedRequest[];
  queue: { status: number; body: string; headers?: Record<string, string> }[];
  respond: (status: number, body: unknown, headers?: Record<string, string>) => void;
}

export function makeFakeFetch(): FakeFetch {
  const calls: CapturedRequest[] = [];
  const queue: FakeFetch['queue'] = [];
  const respond: FakeFetch['respond'] = (status, body, headers) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    queue.push({ status, body: text, ...(headers ? { headers } : {}) });
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const bodyIn = (init as { body?: string | undefined } | undefined)?.body ?? '';
    calls.push({
      url: input as string,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers,
      body: typeof bodyIn === 'string' ? bodyIn : '',
    });
    const next = queue.shift() ?? { status: 200, body: '{}' };
    const isNullBody = next.status === 204 || next.status === 205 || next.status === 304;
    return new Response(isNullBody ? null : next.body, {
      status: next.status,
      headers: next.headers ?? { 'content-type': 'application/json' },
    });
  };
  return { fetchImpl, calls, queue, respond };
}

/** Parse a captured request body as JSON. */
export function parseBody<T = unknown>(call: CapturedRequest): T {
  return JSON.parse(call.body) as T;
}
