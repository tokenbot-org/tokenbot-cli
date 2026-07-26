import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runApiKeyCreate,
  runApiKeyList,
  runApiKeyRevoke,
} from '../commands/apikey.js';
import { CliUserError } from '../errors.js';
import {
  captureStdout,
  clearSeed,
  makeFakeFetch,
  makePassphrase,
  seedConfig,
} from './helpers.js';

afterEach(() => clearSeed());

const KEY = {
  id: 'k-1',
  user_id: 'u',
  name: 'ci',
  environment: 'live',
  key_prefix: 'tk_live_abc',
  permissions: ['read'],
  status: 'active',
  created_at: '2026-05-17T00:00:00Z',
};

describe('runApiKeyList', () => {
  it('renders the table', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, { data: [KEY] });
    const out = await captureStdout(async () =>
      runApiKeyList({ promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );
    expect(out).toContain('k-1');
    expect(out).toContain('ci');
    expect(out).toContain('tk_live_abc');
  });
});

describe('runApiKeyCreate', () => {
  it('creates a key with the supplied options', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, { data: { ...KEY, key: 'tk_live_full_secret' } });
    const out = await captureStdout(async () =>
      runApiKeyCreate(
        { name: 'ci', env: 'live', permissions: 'read,write' },
        { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
      ),
    );
    expect(out).toContain('tk_live_full_secret');
    const body = JSON.parse(fake.calls[0]!.body) as Record<string, unknown>;
    expect(body['permissions']).toEqual(['read', 'write']);
    expect(body['environment']).toBe('live');
  });

  it('rejects an unknown environment', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    await expect(
      runApiKeyCreate(
        { name: 'ci', env: 'staging', permissions: 'read' },
        { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
      ),
    ).rejects.toBeInstanceOf(CliUserError);
  });

  it('rejects empty permissions list', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    await expect(
      runApiKeyCreate(
        { name: 'ci', env: 'live', permissions: '' },
        { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
      ),
    ).rejects.toBeInstanceOf(CliUserError);
  });
});

describe('runApiKeyRevoke', () => {
  it('revokes after a double-confirm', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(204, '');
    const promptConfirm = vi.fn(async () => true);
    await captureStdout(async () =>
      runApiKeyRevoke('k-1', {
        promptPassphrase: makePassphrase(),
        fetchImpl: fake.fetchImpl,
        promptConfirm,
      }),
    );
    expect(fake.calls[0]!.method).toBe('DELETE');
    expect(promptConfirm).toHaveBeenCalledWith(expect.any(String), true);
  });

  it('aborts when confirm declines', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    await expect(
      runApiKeyRevoke('k-1', {
        promptPassphrase: makePassphrase(),
        fetchImpl: fake.fetchImpl,
        promptConfirm: async () => false,
      }),
    ).rejects.toBeInstanceOf(CliUserError);
  });
});
