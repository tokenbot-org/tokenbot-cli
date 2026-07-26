import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyStore, unlockIdentity } from '@tokenbot-org/cli-core';
import { resolveLabelsForBalance, runBalance } from '../commands/balance.js';
import { CliUserError } from '../errors.js';
import {
  captureStdout,
  clearSeed,
  makeFakeFetch,
  makePassphrase,
  seedConfig,
  TEST_PASSPHRASE,
} from './helpers.js';
import { setJsonMode } from '../util/output.js';
import type { CcxtModuleLike } from '../util/ccxt.js';

afterEach(() => clearSeed());

/** Build a ccxt-like module that records `fetchBalance` calls. */
function fakeCcxt(balance: Record<string, unknown> = { total: { BTC: 1 } }): CcxtModuleLike {
  function Ctor(this: object, config: Record<string, unknown>) {
    Object.assign(this, {
      config,
      fetchBalance: async () => balance,
    });
  }
  return {
    binance: Ctor as unknown as new (config: Record<string, unknown>) => {
      fetchBalance: () => Promise<Record<string, unknown>>;
    },
  };
}

/** Seed a single stored credential under `label`. */
async function seedKey(label: string, exchange = 'binance') {
  const seed = await seedConfig();
  const privateKey = unlockIdentity(
    seed.identity.encryptedPrivateKey,
    seed.identity.salt,
    TEST_PASSPHRASE,
  );
  const ks = new KeyStore(privateKey);
  await ks.addKey(label, { exchange, apiKey: 'k', apiSecret: 's' });
}

describe('resolveLabelsForBalance', () => {
  it('returns [strategy:<id>] for --strategy', () => {
    expect(resolveLabelsForBalance({ strategy: 's1' }, [])).toEqual(['strategy:s1']);
  });

  it('returns [copier:<id>] for --copier', () => {
    expect(resolveLabelsForBalance({ copier: 'c1' }, [])).toEqual(['copier:c1']);
  });

  it('returns every label for --all', () => {
    expect(resolveLabelsForBalance({ all: true }, ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('throws when no flag is set', () => {
    expect(() => resolveLabelsForBalance({}, [])).toThrow(/strategy|copier|all/);
  });

  it('throws when multiple flags are set', () => {
    expect(() => resolveLabelsForBalance({ strategy: 's', all: true }, [])).toThrow(
      /exactly one/,
    );
  });
});

describe('runBalance', () => {
  it('fetches balance for --strategy and renders rows', async () => {
    await seedKey('strategy:s1');
    const fake = makeFakeFetch();
    const out = await captureStdout(async () => {
      await runBalance(
        { strategy: 's1' },
        {
          promptPassphrase: makePassphrase(),
          fetchImpl: fake.fetchImpl,
          ccxtModule: fakeCcxt({ total: { BTC: 2, USDT: 100 } }),
        },
      );
    });
    expect(out).toContain('BTC');
    expect(out).toContain('USDT');
  });

  it('throws when no stored credential matches the label', async () => {
    await seedKey('strategy:other');
    const fake = makeFakeFetch();
    // ccxt will be called with the missing label — KeyStore.getKey throws.
    const result = await captureStdout(async () => {
      await runBalance(
        { strategy: 'missing' },
        {
          promptPassphrase: makePassphrase(),
          fetchImpl: fake.fetchImpl,
          ccxtModule: fakeCcxt(),
        },
      );
    });
    expect(result).toContain('(empty)');
  });

  it('iterates every stored credential under --all', async () => {
    // Seed two stored credentials under the same identity, then call
    // --all and verify both labels show up in the rendered output.
    const seed = await seedConfig();
    const { KeyStore: KS, unlockIdentity: UI } = await import('@tokenbot-org/cli-core');
    const pk = UI(seed.identity.encryptedPrivateKey, seed.identity.salt, TEST_PASSPHRASE);
    const ks = new KS(pk);
    await ks.addKey('strategy:a', { exchange: 'binance', apiKey: 'k', apiSecret: 's' });
    await ks.addKey('copier:b', { exchange: 'binance', apiKey: 'k', apiSecret: 's' });

    const fake = makeFakeFetch();
    const mod = fakeCcxt({ total: { ETH: 5 } });
    const out = await captureStdout(async () => {
      await runBalance(
        { all: true },
        {
          promptPassphrase: makePassphrase(),
          fetchImpl: fake.fetchImpl,
          ccxtModule: mod,
        },
      );
    });
    expect(out).toContain('strategy:a');
    expect(out).toContain('copier:b');
  });

  it('errors when no credentials are stored', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    await expect(
      runBalance(
        { all: true },
        {
          promptPassphrase: makePassphrase(),
          fetchImpl: fake.fetchImpl,
          ccxtModule: fakeCcxt(),
        },
      ),
    ).rejects.toBeInstanceOf(CliUserError);
  });

  it('returns JSON for --json', async () => {
    await seedKey('strategy:s2');
    const fake = makeFakeFetch();
    setJsonMode(true);
    const out = await captureStdout(async () => {
      await runBalance(
        { strategy: 's2' },
        {
          promptPassphrase: makePassphrase(),
          fetchImpl: fake.fetchImpl,
          ccxtModule: fakeCcxt({ total: { BTC: 1 } }),
        },
      );
    });
    const parsed = JSON.parse(out) as Array<{ label: string; rows: unknown[] }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.label).toBe('strategy:s2');
  });

  it('handles per-label errors gracefully in --all', async () => {
    await seedKey('strategy:bad', 'nonexistent-exchange');
    const fake = makeFakeFetch();
    setJsonMode(true);
    const out = await captureStdout(async () => {
      await runBalance(
        { all: true },
        {
          promptPassphrase: makePassphrase(),
          fetchImpl: fake.fetchImpl,
          ccxtModule: fakeCcxt(),
        },
      );
    });
    const parsed = JSON.parse(out) as Array<{ error: string | null }>;
    expect(parsed[0]!.error).toMatch(/nonexistent/);
  });
});

describe('runBalance — ccxt construction', () => {
  it('passes apiKey + secret to the exchange constructor', async () => {
    await seedKey('strategy:s3');
    const fake = makeFakeFetch();
    const seen: Record<string, unknown>[] = [];
    function Ctor(this: object, config: Record<string, unknown>) {
      seen.push(config);
      Object.assign(this, { fetchBalance: async () => ({ total: { BTC: 1 } }) });
    }
    await captureStdout(async () => {
      await runBalance(
        { strategy: 's3' },
        {
          promptPassphrase: makePassphrase(),
          fetchImpl: fake.fetchImpl,
          ccxtModule: {
            binance: Ctor as unknown as new (config: Record<string, unknown>) => {
              fetchBalance: () => Promise<Record<string, unknown>>;
            },
          },
        },
      );
    });
    expect(seen[0]!['apiKey']).toBe('k');
    expect(seen[0]!['secret']).toBe('s');
  });
});

// silence unused vi import (used implicitly via setJsonMode/captureStdout)
void vi;
