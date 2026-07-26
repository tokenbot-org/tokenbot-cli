import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveLabel, runKeysAdd, runKeysList, runKeysRemove } from '../commands/keys.js';
import { CliUserError } from '../errors.js';
import {
  captureStdout,
  clearSeed,
  makeFakeFetch,
  makePassphrase,
  seedConfig,
} from './helpers.js';

afterEach(() => clearSeed());

describe('resolveLabel', () => {
  it('builds strategy:<id>', () => {
    expect(resolveLabel({ strategy: 's1' })).toBe('strategy:s1');
  });

  it('builds copier:<id>', () => {
    expect(resolveLabel({ copier: 'c1' })).toBe('copier:c1');
  });

  it('rejects both flags at once', () => {
    expect(() => resolveLabel({ strategy: 's', copier: 'c' })).toThrow(/exactly one/);
  });

  it('rejects neither flag', () => {
    expect(() => resolveLabel({})).toThrow(/strategy.+copier/);
  });
});

describe('runKeysAdd', () => {
  it('stores a credential under strategy:<id> after a fetchSupported round-trip', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    // graphql get_supported_exchanges response (envelope shape)
    fake.respond(200, {
      data: {
        get_supported_exchanges: {
          success: true,
          error: null,
          data: [{ id: 'binance', name: 'Binance' }],
        },
      },
    });
    const inputs = ['binance', 'apikey-value'];
    const passwords = ['secret-value', ''];
    const promptInput = vi.fn(async () => inputs.shift() ?? '');
    const promptPassword = vi.fn(async () => passwords.shift() ?? '');

    await captureStdout(async () => {
      await runKeysAdd(
        { strategy: 's-1' },
        {
          promptPassphrase: makePassphrase(),
          fetchImpl: fake.fetchImpl,
          promptInput,
          promptPassword,
        },
      );
    });

    // Verify the supported_exchanges query was issued.
    expect(fake.calls[0]!.url).toBe('https://api.example.com/graphql');
    const body = JSON.parse(fake.calls[0]!.body) as { query: string };
    expect(body.query).toMatch(/SdkSupportedExchanges/);
  });

  it('uses --exchange to skip the prompt', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    const inputs = ['apikey'];
    const passwords = ['sec', ''];
    const promptInput = vi.fn(async () => inputs.shift() ?? '');
    const promptPassword = vi.fn(async () => passwords.shift() ?? '');

    await captureStdout(async () => {
      await runKeysAdd(
        { strategy: 's-2', exchange: 'kraken' },
        {
          promptPassphrase: makePassphrase(),
          fetchImpl: fake.fetchImpl,
          promptInput,
          promptPassword,
        },
      );
    });
    expect(fake.calls.length).toBe(0); // never hit the network
  });

  it('rejects an empty api key', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    await expect(
      runKeysAdd(
        { strategy: 's-3', exchange: 'binance' },
        {
          promptPassphrase: makePassphrase(),
          fetchImpl: fake.fetchImpl,
          promptInput: async () => '',
          promptPassword: async () => 'sec',
        },
      ),
    ).rejects.toBeInstanceOf(CliUserError);
  });

  it('rejects an empty api secret', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    await expect(
      runKeysAdd(
        { strategy: 's-4', exchange: 'binance' },
        {
          promptPassphrase: makePassphrase(),
          fetchImpl: fake.fetchImpl,
          promptInput: async () => 'k',
          promptPassword: async () => '',
        },
      ),
    ).rejects.toBeInstanceOf(CliUserError);
  });
});

describe('runKeysList + remove', () => {
  it('lists labels added by addKey', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    const inputs = ['apikey'];
    const passwords = ['sec', ''];
    await runKeysAdd(
      { strategy: 'aaa', exchange: 'binance' },
      {
        promptPassphrase: makePassphrase(),
        fetchImpl: fake.fetchImpl,
        promptInput: async () => inputs.shift() ?? '',
        promptPassword: async () => passwords.shift() ?? '',
      },
    );

    const out = await captureStdout(async () =>
      runKeysList({ promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );
    expect(out).toContain('strategy:aaa');
  });

  it('removes a label after a double-confirm', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    const inputs = ['apikey'];
    const passwords = ['sec', ''];
    await runKeysAdd(
      { copier: 'cop-1', exchange: 'binance' },
      {
        promptPassphrase: makePassphrase(),
        fetchImpl: fake.fetchImpl,
        promptInput: async () => inputs.shift() ?? '',
        promptPassword: async () => passwords.shift() ?? '',
      },
    );

    const promptConfirm = vi.fn(async () => true);
    await captureStdout(async () => {
      await runKeysRemove('copier:cop-1', {
        promptPassphrase: makePassphrase(),
        fetchImpl: fake.fetchImpl,
        promptConfirm,
      });
    });
    expect(promptConfirm).toHaveBeenCalledWith(expect.any(String), true);

    const out = await captureStdout(async () =>
      runKeysList({ promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );
    expect(out).not.toContain('copier:cop-1');
  });

  it('aborts remove if the confirm declines', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    await expect(
      runKeysRemove('strategy:never', {
        promptPassphrase: makePassphrase(),
        fetchImpl: fake.fetchImpl,
        promptConfirm: async () => false,
      }),
    ).rejects.toBeInstanceOf(CliUserError);
  });
});
