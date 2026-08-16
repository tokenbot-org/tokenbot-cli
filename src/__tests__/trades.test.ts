import { afterEach, describe, expect, it } from 'vitest';
import { buildFilter, emptyMessage, runTrades } from '../commands/trades.js';
import { CliUserError } from '../errors.js';
import { captureStdout, clearSeed, makeFakeFetch, makePassphrase, seedConfig } from './helpers.js';
import { setJsonMode } from '../util/output.js';

afterEach(() => clearSeed());

/** A wire-shape trade as graphql-api's `get_trades` returns it. */
const TRADE = {
  id: 'trade-0001-aaaa',
  strategy_id: 'strat-0001-bbbb',
  exchange_account_id: 'exch-1',
  trade_pair_id: 'pair-1',
  type: 'market',
  side: 'BUY',
  quantity: 0.5,
  price: 60000,
  executed_price: 60050.5,
  status: 'FILLED',
  profit_loss: 125.5,
  executed_at: '2026-05-17T10:00:00Z',
  created_at: '2026-05-17T10:00:00Z',
  updated_at: '2026-05-17T10:00:00Z',
  trade_pair: { symbol: 'BTC/USDT' },
};

const listOk = (trades: unknown[]) => ({
  data: { get_trades: { success: true, error: null, data: trades } },
});

describe('runTrades', () => {
  it('renders a table of trades', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, listOk([TRADE]));
    const out = await captureStdout(async () =>
      runTrades({}, { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );

    expect(out).toContain('BTC/USDT');
    expect(out).toContain('buy');
    expect(out).toContain('filled');
    // Formatted, not raw: trailing zeros trimmed, P&L explicitly signed.
    expect(out).toContain('60050.5');
    expect(out).toContain('+125.5');
    expect(out).toContain('2026-05-17 10:00');
  });

  it('emits JSON in json mode', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    setJsonMode(true);
    fake.respond(200, listOk([TRADE]));
    const out = await captureStdout(async () =>
      runTrades({}, { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );

    const parsed = JSON.parse(out) as Array<{ symbol: string; pnl: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.symbol).toBe('BTC/USDT');
  });

  it('queries the real get_trades field', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, listOk([TRADE]));
    await captureStdout(async () =>
      runTrades({}, { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );

    const body = JSON.parse(fake.calls[0]!.body) as { query: string };
    expect(body.query).toMatch(/get_trades\(/);
  });

  it('asks for the full history by default, not the server default of one month', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, listOk([]));
    await captureStdout(async () =>
      runTrades({}, { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );

    const body = JSON.parse(fake.calls[0]!.body) as {
      variables: { filters?: Record<string, unknown> };
    };
    expect(body.variables.filters?.['dateRange']).toBe('ALL');
  });

  it('forwards filters to the server in camelCase', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, listOk([TRADE]));
    await captureStdout(async () =>
      runTrades(
        { strategy: 'strat-1', status: 'filled', side: 'buy', since: '2026-01-01' },
        { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
      ),
    );

    const body = JSON.parse(fake.calls[0]!.body) as {
      variables: { filters: Record<string, unknown> };
    };
    expect(body.variables.filters['strategyIds']).toEqual(['strat-1']);
    expect(body.variables.filters['statuses']).toEqual(['FILLED']);
    expect(body.variables.filters['sides']).toEqual(['BUY']);
    expect(body.variables.filters['startDate']).toBe('2026-01-01T00:00:00.000Z');
  });

  it('filters by symbol client-side', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(
      200,
      listOk([TRADE, { ...TRADE, id: 't2', trade_pair: { symbol: 'ETH/USDT' } }]),
    );
    const out = await captureStdout(async () =>
      runTrades(
        { symbol: 'ETH' },
        { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
      ),
    );

    expect(out).toContain('ETH/USDT');
    expect(out).not.toContain('BTC/USDT');
  });

  describe('empty state', () => {
    it('explains why a new account has no trades', async () => {
      await seedConfig();
      const fake = makeFakeFetch();
      fake.respond(200, listOk([]));
      const out = await captureStdout(async () =>
        runTrades({}, { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
      );

      expect(out).toContain('No trades yet.');
      expect(out).toContain('tokenbot strategy list');
      expect(out).not.toContain('(empty)');
    });

    it('names the active filters when a filtered search comes back empty', async () => {
      await seedConfig();
      const fake = makeFakeFetch();
      fake.respond(200, listOk([]));
      const out = await captureStdout(async () =>
        runTrades(
          { symbol: 'DOGE/USDT', status: 'filled' },
          { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
        ),
      );

      expect(out).toContain('DOGE/USDT');
      expect(out).toContain('filled');
    });

    it('still emits an empty array in json mode', async () => {
      await seedConfig();
      const fake = makeFakeFetch();
      setJsonMode(true);
      fake.respond(200, listOk([]));
      const out = await captureStdout(async () =>
        runTrades({}, { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
      );

      expect(JSON.parse(out)).toEqual([]);
    });
  });

  it('surfaces the server message when the envelope reports failure', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, { data: { get_trades: { success: false, error: 'Not authenticated' } } });

    await expect(
      runTrades({}, { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    ).rejects.toThrow(/Not authenticated/);
  });
});

describe('buildFilter', () => {
  it('defaults to the full history and a readable page size', () => {
    const f = buildFilter({});
    expect(f.dateRange).toBe('ALL');
    expect(f.limit).toBe(25);
  });

  it('accepts filter values in any casing', () => {
    const f = buildFilter({ status: 'Filled', side: 'SELL', range: 'week' });
    expect(f.status).toBe('FILLED');
    expect(f.side).toBe('SELL');
    expect(f.dateRange).toBe('WEEK');
  });

  it.each([
    ['--status', { status: 'nonsense' }],
    ['--side', { side: 'sideways' }],
    ['--range', { range: 'fortnight' }],
  ])('rejects an invalid %s and lists the valid values', (flag, opts) => {
    try {
      buildFilter(opts);
      expect.unreachable('expected a CliUserError');
    } catch (err) {
      expect(err).toBeInstanceOf(CliUserError);
      expect((err as CliUserError).message).toContain(flag);
      expect((err as CliUserError).exitCode).toBe(1);
    }
  });

  it.each(['0', '-5', 'abc', '2.5'])('rejects --limit %s', (limit) => {
    expect(() => buildFilter({ limit })).toThrow(CliUserError);
  });

  it('rejects an unparseable --since', () => {
    expect(() => buildFilter({ since: 'last tuesday' })).toThrow(CliUserError);
  });

  it('validates before any network call or passphrase prompt', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    let prompted = false;

    await expect(
      runTrades(
        { status: 'nonsense' },
        {
          promptPassphrase: async () => {
            prompted = true;
            return 'test-passphrase';
          },
          fetchImpl: fake.fetchImpl,
        },
      ),
    ).rejects.toBeInstanceOf(CliUserError);

    expect(prompted).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});

describe('emptyMessage', () => {
  it('omits the default ALL range from the filter summary', () => {
    expect(emptyMessage({ dateRange: 'ALL', strategyId: 's1' })).not.toContain('range');
  });

  it('mentions a narrowed range', () => {
    expect(emptyMessage({ dateRange: 'WEEK' })).toContain('range week');
  });
});
