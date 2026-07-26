import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliUserError } from '../errors.js';
import {
  __resetContextCacheForTesting,
  getAuthenticatedContext,
  loadConfigOrThrow,
} from '../context.js';
import { clearSeed, makeFakeFetch, makePassphrase, seedConfig } from './helpers.js';

afterEach(() => clearSeed());

describe('loadConfigOrThrow', () => {
  it('throws CliUserError when no config exists', async () => {
    await seedConfig(); // produces a seed dir, then we wipe it
    clearSeed();
    await expect(loadConfigOrThrow()).rejects.toBeInstanceOf(CliUserError);
  });

  it('returns the config when present', async () => {
    const seed = await seedConfig();
    const cfg = await loadConfigOrThrow();
    expect(cfg.accountId).toBe(seed.accountId);
    expect(cfg.publicKey).toBe(seed.identity.publicKey);
  });
});

describe('getAuthenticatedContext', () => {
  it('returns SDK + key store after unlocking', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    const ctx = await getAuthenticatedContext({
      promptPassphrase: makePassphrase(),
      fetchImpl: fake.fetchImpl,
    });
    expect(ctx.sdk).toBeDefined();
    expect(ctx.keyStore).toBeDefined();
    expect(ctx.privateKey.length).toBe(32);
  });

  it('caches the context across calls (no second prompt)', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    const prompt = vi.fn(makePassphrase());
    const first = await getAuthenticatedContext({
      promptPassphrase: prompt,
      fetchImpl: fake.fetchImpl,
    });
    const second = await getAuthenticatedContext({
      promptPassphrase: prompt,
      fetchImpl: fake.fetchImpl,
    });
    expect(first).toBe(second);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('throws CliUserError on a wrong passphrase', async () => {
    await seedConfig();
    await expect(
      getAuthenticatedContext({
        promptPassphrase: makePassphrase('wrong-pp'),
      }),
    ).rejects.toBeInstanceOf(CliUserError);
  });

  it('rejects an empty passphrase', async () => {
    await seedConfig();
    await expect(
      getAuthenticatedContext({ promptPassphrase: async () => '' }),
    ).rejects.toBeInstanceOf(CliUserError);
  });
});

describe('__resetContextCacheForTesting', () => {
  it('drops the cache so the next call re-prompts', async () => {
    await seedConfig();
    const prompt = vi.fn(makePassphrase());
    const fake = makeFakeFetch();
    await getAuthenticatedContext({
      promptPassphrase: prompt,
      fetchImpl: fake.fetchImpl,
    });
    __resetContextCacheForTesting();
    await getAuthenticatedContext({
      promptPassphrase: prompt,
      fetchImpl: fake.fetchImpl,
    });
    expect(prompt).toHaveBeenCalledTimes(2);
  });
});
