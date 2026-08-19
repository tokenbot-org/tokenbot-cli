import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfigDir, loadConfig } from '@tokenbot-org/cli-core';
import { runInit, DEFAULT_API_URL, DEFAULT_WS_URL } from '../commands/init.js';
import { CliUserError } from '../errors.js';
import {
  captureStdout,
  clearSeed,
  makeFakeFetch,
  makePassphrase,
  seedConfig,
} from './helpers.js';
import { setJsonMode } from '../util/output.js';

afterEach(() => clearSeed());

/**
 * Wire up the two server responses an `init` round-trip needs:
 *   1. POST /v1/auth/cli-challenge → { data: CliChallenge }
 *   2. POST /v1/auth/cli-identity  → { data: CliIdentity }
 */
function queueRegistration(
  fake: ReturnType<typeof makeFakeFetch>,
  accountId = 'acct-init-1',
) {
  fake.respond(200, {
    data: {
      challenge_id: 'chal-1',
      nonce: 'deadbeef',
      expires_at: '2099-01-01T00:00:00Z',
    },
  });
  fake.respond(200, {
    data: {
      id: 'id-1',
      account_id: accountId,
      public_key: '02' + 'aa'.repeat(32),
      algorithm: 'secp256k1',
      label: 'my-laptop',
      created_at: '2026-05-17T10:00:00Z',
    },
  });
}

describe('runInit', () => {
  it('generates a key, signs the challenge, registers, and saves config', async () => {
    // Use a fresh empty TOKENBOT_HOME (no existing config) — seedConfig
    // + clearSeed leaves the env var pointed at a wiped dir.
    await seedConfig();
    clearSeed();
    await seedConfig();
    clearSeed();

    const fake = makeFakeFetch();
    queueRegistration(fake);

    await captureStdout(async () => {
      await runInit(
        {
          apiUrl: DEFAULT_API_URL,
          wsUrl: DEFAULT_WS_URL,
          label: 'my-laptop',
          apiKey: 'bootstrap-key',
        },
        {
          promptPassphrase: makePassphrase('newpass'),
          promptConfirm: async () => true,
          fetchImpl: fake.fetchImpl,
        },
      );
    });

    expect(fake.calls.map((c) => c.url)).toEqual([
      'https://api.tokenbot.com/v1/auth/cli-challenge',
      'https://api.tokenbot.com/v1/auth/cli-identity',
    ]);

    const cfg = await loadConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.accountId).toBe('acct-init-1');
    expect(cfg!.apiUrl).toBe(DEFAULT_API_URL);
    expect(cfg!.wsUrl).toBe(DEFAULT_WS_URL);
  });

  it('prompts a double-confirm when a config already exists', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    queueRegistration(fake);

    const confirmSpy = vi.fn(async () => true);
    await captureStdout(async () => {
      await runInit(
        { apiUrl: DEFAULT_API_URL, wsUrl: DEFAULT_WS_URL, apiKey: 'k' },
        {
          promptPassphrase: makePassphrase('newpass'),
          promptConfirm: confirmSpy,
          fetchImpl: fake.fetchImpl,
          hostnameFn: () => 'overridden',
        },
      );
    });
    expect(confirmSpy).toHaveBeenCalledOnce();
  });

  it('aborts when the user declines the overwrite confirm', async () => {
    await seedConfig();
    await expect(
      runInit(
        { apiUrl: DEFAULT_API_URL, wsUrl: DEFAULT_WS_URL },
        {
          promptPassphrase: makePassphrase('newpass'),
          // Supplied so a regression that reordered the checks fails loudly
          // rather than hanging on an interactive prompt.
          promptApiKey: async () => 'k',
          promptConfirm: async () => false,
          fetchImpl: makeFakeFetch().fetchImpl,
        },
      ),
    ).rejects.toBeInstanceOf(CliUserError);
  });

  it('rejects an empty passphrase', async () => {
    // Wipe so no existing config triggers the overwrite prompt.
    await seedConfig();
    clearSeed();
    await seedConfig();
    clearSeed();
    await expect(
      runInit(
        { apiUrl: DEFAULT_API_URL, wsUrl: DEFAULT_WS_URL },
        {
          promptPassphrase: async () => '',
          promptApiKey: async () => 'k',
          fetchImpl: makeFakeFetch().fetchImpl,
        },
      ),
    ).rejects.toBeInstanceOf(CliUserError);
  });

  it('sends the bootstrap API key as x-api-key on the registration round-trip', async () => {
    await seedConfig();
    clearSeed();
    await seedConfig();
    clearSeed();
    const fake = makeFakeFetch();
    queueRegistration(fake);

    await captureStdout(async () => {
      await runInit(
        { apiUrl: DEFAULT_API_URL, wsUrl: DEFAULT_WS_URL, apiKey: 'secret-key' },
        {
          promptPassphrase: makePassphrase('newpass'),
          fetchImpl: fake.fetchImpl,
        },
      );
    });

    expect(fake.calls).toHaveLength(2);
    for (const call of fake.calls) {
      expect(call.headers['x-api-key']).toBe('secret-key');
      // Signing headers must survive alongside the credential.
      expect(call.headers['x-tb-pubkey']).toBeTruthy();
      expect(call.headers['x-tb-sig']).toBeTruthy();
    }
  });

  // Regression: the SDK issues POST for both legs. rest-api had registered
  // the challenge route as GET only, so init 404'd on its first call.
  it('uses POST for both the challenge and the registration', async () => {
    await seedConfig();
    clearSeed();
    await seedConfig();
    clearSeed();
    const fake = makeFakeFetch();
    queueRegistration(fake);

    await captureStdout(async () => {
      await runInit(
        { apiUrl: DEFAULT_API_URL, wsUrl: DEFAULT_WS_URL, apiKey: 'k' },
        {
          promptPassphrase: makePassphrase('newpass'),
          fetchImpl: fake.fetchImpl,
        },
      );
    });

    expect(fake.calls.map((c) => c.method)).toEqual(['POST', 'POST']);
  });

  it('falls back to TOKENBOT_API_KEY when --api-key is omitted', async () => {
    await seedConfig();
    clearSeed();
    await seedConfig();
    clearSeed();
    process.env['TOKENBOT_API_KEY'] = 'env-key';
    const fake = makeFakeFetch();
    queueRegistration(fake);

    try {
      await captureStdout(async () => {
        await runInit(
          { apiUrl: DEFAULT_API_URL, wsUrl: DEFAULT_WS_URL },
          {
            promptPassphrase: makePassphrase('newpass'),
            fetchImpl: fake.fetchImpl,
          },
        );
      });
      expect(fake.calls[0]!.headers['x-api-key']).toBe('env-key');
    } finally {
      delete process.env['TOKENBOT_API_KEY'];
    }
  });

  it('rejects an empty API key without contacting the server', async () => {
    await seedConfig();
    clearSeed();
    await seedConfig();
    clearSeed();
    const fake = makeFakeFetch();
    await expect(
      runInit(
        { apiUrl: DEFAULT_API_URL, wsUrl: DEFAULT_WS_URL },
        {
          promptPassphrase: makePassphrase('newpass'),
          promptApiKey: async () => '',
          fetchImpl: fake.fetchImpl,
        },
      ),
    ).rejects.toBeInstanceOf(CliUserError);
    expect(fake.calls).toHaveLength(0);
  });

  it('writes the config file under TOKENBOT_HOME', async () => {
    await seedConfig();
    clearSeed();
    await seedConfig();
    clearSeed();
    const fake = makeFakeFetch();
    queueRegistration(fake, 'acct-write-1');
    await captureStdout(async () => {
      await runInit(
        { apiUrl: DEFAULT_API_URL, wsUrl: DEFAULT_WS_URL, label: 'lab', apiKey: 'k' },
        {
          promptPassphrase: makePassphrase('newpass'),
          fetchImpl: fake.fetchImpl,
        },
      );
    });
    const text = await readFile(join(getConfigDir(), 'config.json'), 'utf8');
    expect(text).toContain('"acct-write-1"');
  });

  it('emits JSON when json mode is on', async () => {
    await seedConfig();
    clearSeed();
    await seedConfig();
    clearSeed();
    setJsonMode(true);
    const fake = makeFakeFetch();
    queueRegistration(fake);
    const out = await captureStdout(async () => {
      await runInit(
        { apiUrl: DEFAULT_API_URL, wsUrl: DEFAULT_WS_URL, label: 'lab', apiKey: 'k' },
        {
          promptPassphrase: makePassphrase('newpass'),
          fetchImpl: fake.fetchImpl,
        },
      );
    });
    const parsed = JSON.parse(out) as { accountId: string };
    expect(parsed.accountId).toBe('acct-init-1');
  });
});
