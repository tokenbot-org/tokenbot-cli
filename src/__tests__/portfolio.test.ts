import { afterEach, describe, expect, it } from 'vitest';
import {
  flattenPortfolio,
  formatSyncedAt,
  parseSyncedAt,
  runPortfolio,
} from '../commands/portfolio.js';
import { CliUserError } from '../errors.js';
import { setJsonMode } from '../util/output.js';
import {
  captureStdout,
  clearSeed,
  makeFakeFetch,
  makePassphrase,
  parseBody,
  seedConfig,
} from './helpers.js';

afterEach(() => clearSeed());

/** epoch-ms as a string — what graphql-api actually puts on the wire. */
const SYNCED_MS = '1784541600000'; // 2026-07-20T10:00:00.000Z

const account = (over: Record<string, unknown> = {}) => ({
  id: 'ea-1',
  exchange_name: 'binance',
  account_name: 'prod',
  trading_type: 'spot',
  is_active: true,
  last_sync_at: SYNCED_MS,
  balance: { BTC: 1.5, USDT: 5000 },
  ...over,
});

const respondAccounts = (fake: ReturnType<typeof makeFakeFetch>, data: unknown[]) =>
  fake.respond(200, { data: { get_exchange_accounts: { success: true, error: null, data } } });

const run = (fake: ReturnType<typeof makeFakeFetch>, opts = {}) =>
  captureStdout(async () =>
    runPortfolio(opts, { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
  );

describe('parseSyncedAt', () => {
  it('parses epoch-ms strings, which is what the server actually sends', () => {
    // graphql-api types last_sync_at as String while storing a Date, and
    // graphql-js coerces Date via valueOf() -> epoch ms. `new Date(str)`
    // would reject this, so it needs its own branch.
    expect(parseSyncedAt(SYNCED_MS)?.toISOString()).toBe('2026-07-20T10:00:00.000Z');
  });

  it('still accepts ISO-8601 so a server-side fix does not break it', () => {
    expect(parseSyncedAt('2026-07-20T10:00:00.000Z')?.toISOString()).toBe(
      '2026-07-20T10:00:00.000Z',
    );
  });

  it('accepts a raw number', () => {
    expect(parseSyncedAt(1784541600000)?.toISOString()).toBe('2026-07-20T10:00:00.000Z');
  });

  it('treats missing or unparseable values as never-synced, not as a bogus date', () => {
    expect(parseSyncedAt(null)).toBeNull();
    expect(parseSyncedAt(undefined)).toBeNull();
    expect(parseSyncedAt('')).toBeNull();
    expect(parseSyncedAt('not-a-date')).toBeNull();
    expect(formatSyncedAt(null)).toBe('never');
  });
});

describe('flattenPortfolio', () => {
  it('emits one row per asset held', () => {
    const { rows } = flattenPortfolio([account()]);
    expect(rows.map((r) => r.asset)).toEqual(['BTC', 'USDT']);
    expect(rows[0]).toMatchObject({ exchange: 'binance', account: 'prod', quantity: 1.5 });
  });

  it('preserves asset tickers containing underscores', () => {
    // The SDK's fromWire runs a snake->camel walk that rewrites object KEYS,
    // turning LUNA_2 into LUNA2 and usdt_e into usdtE. Balance keys are
    // user-facing exchange tickers, so this command bypasses fromWire
    // entirely. Pinned here because the corruption would be silent.
    const { rows } = flattenPortfolio([
      account({ balance: { LUNA_2: 7, usdt_e: 3 } }),
    ]);
    expect(rows.map((r) => r.asset).sort()).toEqual(['LUNA_2', 'usdt_e'].sort());
  });

  it('reports a never-synced account instead of showing it as empty', () => {
    const { rows, gaps } = flattenPortfolio([account({ balance: null, last_sync_at: null })]);
    expect(rows).toEqual([]);
    expect(gaps).toEqual([
      { exchange: 'binance', account: 'prod', reason: 'never-synced', active: true },
    ]);
  });

  it('distinguishes synced-but-empty from never-synced', () => {
    const { gaps } = flattenPortfolio([account({ balance: {} })]);
    expect(gaps[0]).toMatchObject({ reason: 'empty' });
  });

  it('hides zero balances by default but counts them', () => {
    const { rows, hiddenZeros } = flattenPortfolio([
      account({ balance: { BTC: 1.5, DOGE: 0, XRP: 0 } }),
    ]);
    expect(rows.map((r) => r.asset)).toEqual(['BTC']);
    expect(hiddenZeros).toBe(2);
  });

  it('includes zero balances under --all', () => {
    const { rows, hiddenZeros } = flattenPortfolio(
      [account({ balance: { BTC: 1.5, DOGE: 0 } })],
      { all: true },
    );
    expect(rows.map((r) => r.asset)).toEqual(['BTC', 'DOGE']);
    expect(hiddenZeros).toBe(0);
  });

  it('drops non-numeric quantities rather than rendering NaN', () => {
    const { rows } = flattenPortfolio([
      account({ balance: { BTC: 1.5, BAD: 'not-a-number', NIL: null } }),
    ]);
    expect(rows.map((r) => r.asset)).toEqual(['BTC']);
  });

  it('coerces numeric strings, which Mixed + JSON round-tripping can produce', () => {
    const { rows } = flattenPortfolio([account({ balance: { BTC: '1.5' } })]);
    expect(rows[0]?.quantity).toBe(1.5);
  });

  it('surfaces inactive accounts rather than hiding them', () => {
    const { gaps } = flattenPortfolio([account({ is_active: false, balance: {} })]);
    expect(gaps[0]).toMatchObject({ active: false });
  });

  it('filters by exchange and by asset', () => {
    const accounts = [
      account({ id: 'a', exchange_name: 'binance', balance: { BTC: 1 } }),
      account({ id: 'b', exchange_name: 'kraken', balance: { BTC: 2, ETH: 3 } }),
    ];
    expect(flattenPortfolio(accounts, { exchange: 'kraken' }).rows).toHaveLength(2);
    expect(flattenPortfolio(accounts, { asset: 'eth' }).rows).toMatchObject([
      { exchange: 'kraken', asset: 'ETH' },
    ]);
  });
});

describe('runPortfolio', () => {
  it('renders holdings with their sync time', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    respondAccounts(fake, [account()]);

    const out = await run(fake);

    expect(out).toContain('binance');
    expect(out).toContain('BTC');
    expect(out).toContain('1.5');
    expect(out).toContain('2026-07-20T10:00:00Z');
  });

  it('always explains that figures are server-side and differ from `balance`', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    respondAccounts(fake, [account()]);

    const out = await run(fake);

    // The whole point of the command name split. If this line ever goes
    // missing, a user comparing the two totals has no way to explain them.
    expect(out).toContain('not live');
    expect(out).toContain('tokenbot balance');
    expect(out).toContain('no fiat value');
  });

  it('queries the GraphQL host and asks for the balance field', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    respondAccounts(fake, [account()]);

    await run(fake);

    const call = fake.calls[0];
    expect(call?.url).toContain('/graphql');
    const body = parseBody<{ query: string }>(call!);
    expect(body.query).toContain('get_exchange_accounts');
    expect(body.query).toContain('balance');
  });

  it('sends the signed identity headers and no caller-supplied user id', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    respondAccounts(fake, [account()]);

    await run(fake);

    const headers = Object.fromEntries(
      Object.entries(fake.calls[0]?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    expect(headers['x-tb-pubkey']).toBeTruthy();
    expect(headers['x-tb-sig']).toBeTruthy();
    // Scoping is the server's job, derived from the signature. The command
    // must never offer an identity of its own for the server to trust.
    expect(headers['x-user-id']).toBeUndefined();
  });

  it('says so plainly when no exchange accounts are registered', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    respondAccounts(fake, []);

    const out = await run(fake);

    // Not "(empty)" — that reads as "you hold nothing" rather than
    // "you have not connected anything yet".
    expect(out).toContain('No exchange accounts registered');
    expect(out).toContain('tokenbot exchange add');
  });

  it('reports a never-synced account instead of implying an empty balance', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    respondAccounts(fake, [account({ balance: null, last_sync_at: null })]);

    const out = await run(fake);

    expect(out).toContain('never synced');
  });

  it('notes how many zero balances were hidden', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    respondAccounts(fake, [account({ balance: { BTC: 1, DOGE: 0 } })]);

    const out = await run(fake);

    expect(out).toContain('1 zero-balance asset hidden');
  });

  it('fails with a clear message when the server rejects the request', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, {
      data: { get_exchange_accounts: { success: false, error: 'Not authenticated', data: null } },
    });

    await expect(
      runPortfolio({}, { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    ).rejects.toBeInstanceOf(CliUserError);
  });

  it('surfaces an auth failure rather than rendering an empty portfolio', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(401, { statusCode: 401, code: 'CLI_SIG_INVALID', message: 'bad signature' });

    // Must not degrade to "you hold nothing" — an unauthenticated caller and
    // an empty account are completely different situations.
    await expect(
      runPortfolio({}, { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    ).rejects.toThrow();
  });

  it('emits machine-readable output under --json, keeping the gaps', async () => {
    await seedConfig();
    setJsonMode(true);
    const fake = makeFakeFetch();
    respondAccounts(fake, [
      account(),
      account({ id: 'ea-2', account_name: 'cold', balance: null, last_sync_at: null }),
    ]);

    const out = await run(fake);
    const parsed = JSON.parse(out) as {
      holdings: { asset: string; syncedAt: string | null }[];
      gaps: { reason: string }[];
    };

    expect(parsed.holdings.map((h) => h.asset)).toEqual(['BTC', 'USDT']);
    expect(parsed.holdings[0]?.syncedAt).toBe('2026-07-20T10:00:00Z');
    // An empty holdings array alone would erase this distinction.
    expect(parsed.gaps).toMatchObject([{ reason: 'never-synced' }]);
  });
});
