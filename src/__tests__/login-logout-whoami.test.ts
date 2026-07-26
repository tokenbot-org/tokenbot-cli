import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLogin } from '../commands/login.js';
import { runLogout } from '../commands/logout.js';
import { runWhoami } from '../commands/whoami.js';
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

describe('runLogin', () => {
  it('prints the account when a config exists', async () => {
    const seed = await seedConfig();
    const out = await captureStdout(async () => runLogin());
    expect(out).toContain(seed.accountId);
  });

  it('throws CliUserError when no config exists', async () => {
    await seedConfig();
    clearSeed();
    await seedConfig();
    clearSeed();
    await expect(runLogin()).rejects.toBeInstanceOf(CliUserError);
  });

  it('emits JSON in json mode', async () => {
    const seed = await seedConfig();
    setJsonMode(true);
    const out = await captureStdout(async () => runLogin());
    const parsed = JSON.parse(out) as { accountId: string };
    expect(parsed.accountId).toBe(seed.accountId);
  });
});

describe('runLogout', () => {
  it('aborts when the confirm prompt declines', async () => {
    await seedConfig();
    await expect(
      runLogout({ promptConfirm: async () => false }),
    ).rejects.toBeInstanceOf(CliUserError);
  });

  it('removes both config + keys when confirmed', async () => {
    await seedConfig();
    const rmFn = vi.fn(async () => undefined);
    await captureStdout(async () => {
      await runLogout({
        promptConfirm: async (_msg, _double) => true,
        rmFn,
      });
    });
    expect(rmFn).toHaveBeenCalledTimes(2);
  });

  it('double-confirms by passing true to the prompt', async () => {
    await seedConfig();
    const promptConfirm = vi.fn(async () => true);
    await captureStdout(async () => {
      await runLogout({ promptConfirm, rmFn: async () => undefined });
    });
    expect(promptConfirm).toHaveBeenCalledWith(expect.any(String), true);
  });
});

describe('runWhoami', () => {
  it('prints account + pubkey + server payload', async () => {
    const seed = await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, {
      data: {
        user_id: 'usr-1',
        email: 'a@example.com',
        public_key: seed.identity.publicKey,
      },
    });
    const out = await captureStdout(async () =>
      runWhoami({ promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );
    expect(out).toContain(seed.accountId);
    expect(out).toContain(seed.identity.publicKey);
    expect(out).toContain('a@example.com');
  });

  it('emits a single JSON object in json mode', async () => {
    const seed = await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, {
      data: {
        user_id: 'usr-1',
      },
    });
    setJsonMode(true);
    const out = await captureStdout(async () =>
      runWhoami({ promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );
    const parsed = JSON.parse(out) as {
      accountId: string;
      server: { userId: string };
    };
    expect(parsed.accountId).toBe(seed.accountId);
    expect(parsed.server.userId).toBe('usr-1');
  });
});
