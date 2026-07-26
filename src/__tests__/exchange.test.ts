import { afterEach, describe, expect, it } from 'vitest';
import {
  runExchangeAdd,
  runExchangeList,
  runExchangeSupported,
} from '../commands/exchange.js';
import { CliUserError } from '../errors.js';
import {
  captureStdout,
  clearSeed,
  makeFakeFetch,
  makePassphrase,
  seedConfig,
} from './helpers.js';

afterEach(() => clearSeed());

describe('runExchangeList', () => {
  it('renders registered exchange accounts', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, {
      data: {
        get_exchange_accounts: {
          success: true,
          error: null,
          data: [
            {
              id: 'ea-1',
              user_id: 'u',
              exchange_name: 'binance',
              account_name: 'prod',
              trading_type: 'perpetual',
              is_active: true,
              created_at: '2026-05-17T00:00:00Z',
              updated_at: '2026-05-17T00:00:00Z',
            },
          ],
        },
      },
    });
    const out = await captureStdout(async () =>
      runExchangeList({ promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );
    expect(out).toContain('ea-1');
    expect(out).toContain('binance');
    expect(out).toContain('prod');
    expect(out).toContain('perpetual');
  });
});

describe('runExchangeSupported', () => {
  it('renders supported exchanges', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, {
      data: {
        get_supported_exchanges: {
          success: true,
          error: null,
          data: [{ id: 'binance', name: 'Binance', caption: 'The big one' }],
        },
      },
    });
    const out = await captureStdout(async () =>
      runExchangeSupported({ promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );
    expect(out).toContain('Binance');
  });
});

describe('runExchangeAdd', () => {
  it('creates an exchange account from explicit inputs', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, {
      data: {
        create_exchange_account: {
          success: true,
          error: null,
          data: {
            id: 'ea-1',
            user_id: 'u',
            exchange_name: 'binance',
            account_name: 'prod',
            trading_type: 'perpetual',
            is_active: true,
            created_at: '2026-05-17T00:00:00Z',
            updated_at: '2026-05-17T00:00:00Z',
          },
        },
      },
    });
    const inputs = ['apikey'];
    const passwords = ['secret', ''];
    await captureStdout(async () =>
      runExchangeAdd(
        { exchange: 'binance', accountName: 'prod', tradingType: 'perpetual' },
        {
          promptPassphrase: makePassphrase(),
          fetchImpl: fake.fetchImpl,
          promptInput: async () => inputs.shift() ?? '',
          promptPassword: async () => passwords.shift() ?? '',
        },
      ),
    );
    const body = JSON.parse(fake.calls[0]!.body) as {
      variables: { exchange_account: Record<string, unknown> };
    };
    expect(body.variables.exchange_account).toMatchObject({
      exchange_name: 'binance',
      account_name: 'prod',
      trading_type: 'perpetual',
      api_key: 'apikey',
      api_secret: 'secret',
    });
  });

  it('defaults trading_type to spot when omitted', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, {
      data: {
        create_exchange_account: {
          success: true,
          error: null,
          data: {
            id: 'ea-1',
            user_id: 'u',
            exchange_name: 'binance',
            account_name: 'prod',
            trading_type: 'spot',
            is_active: true,
            created_at: '2026-05-17T00:00:00Z',
            updated_at: '2026-05-17T00:00:00Z',
          },
        },
      },
    });
    const inputs = ['', 'apikey']; // trading-type prompt (enter), then api key
    const passwords = ['secret', ''];
    await captureStdout(async () =>
      runExchangeAdd(
        { exchange: 'binance', accountName: 'prod' },
        {
          promptPassphrase: makePassphrase(),
          fetchImpl: fake.fetchImpl,
          promptInput: async () => inputs.shift() ?? '',
          promptPassword: async () => passwords.shift() ?? '',
        },
      ),
    );
    const body = JSON.parse(fake.calls[0]!.body) as {
      variables: { exchange_account: Record<string, unknown> };
    };
    expect(body.variables.exchange_account.trading_type).toBe('spot');
  });

  it('rejects an invalid trading type', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    await expect(
      runExchangeAdd(
        { exchange: 'binance', accountName: 'prod', tradingType: 'futures' },
        {
          promptPassphrase: makePassphrase(),
          fetchImpl: fake.fetchImpl,
          promptInput: async () => 'k',
          promptPassword: async () => 'secret',
        },
      ),
    ).rejects.toBeInstanceOf(CliUserError);
  });

  it('rejects empty api key', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    await expect(
      runExchangeAdd(
        { exchange: 'binance', accountName: 'prod', tradingType: 'spot' },
        {
          promptPassphrase: makePassphrase(),
          fetchImpl: fake.fetchImpl,
          promptInput: async () => '',
          promptPassword: async () => 'secret',
        },
      ),
    ).rejects.toBeInstanceOf(CliUserError);
  });

  it('rejects empty api secret', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    await expect(
      runExchangeAdd(
        { exchange: 'binance', accountName: 'prod', tradingType: 'spot' },
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
