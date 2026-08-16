/**
 * `tokenbot trades` — list the trades TokenBot has executed for you.
 *
 * This is the first of the read-only observability commands. Until it
 * shipped, a user could configure a strategy and get no feedback at all
 * about whether it had done anything — so the empty state here is a
 * real answer ("nothing yet, and here's why that might be"), not a
 * blank table.
 *
 * ## Notes for `positions` / `portfolio`
 *
 * These commands are meant to look and behave identically, so the
 * structure below is the template: parse-and-validate every flag up
 * front via `util/filters`, hand the SDK a single filter object, render
 * through `renderList` with an `empty` message, and let `mapError` at
 * the top level turn transport failures into exit codes. Formatting
 * lives in `util/format` so a price reads the same in every command.
 *
 * Deliberately *not* here: anything operator-only. Trade signals stay
 * in the private `tokenbot-trading` CLI.
 *
 * @module commands/trades
 */

import { Command } from 'commander';
import {
  TRADE_DATE_RANGES,
  TRADE_SIDES,
  TRADE_STATUSES,
  type Trade,
  type TradeDateRange,
  type TradeFilter,
} from '@tokenbot-org/sdk';
import { getAuthenticatedContext, type ContextOptions } from '../context.js';
import { renderList } from '../util/output.js';
import { formatDateTime, formatId, formatNumber, formatSigned } from '../util/format.js';
import { parseDateOption, parseEnumOption, parsePositiveInt } from '../util/filters.js';

export type TradesDeps = ContextOptions;

/** Raw flag values as Commander hands them over. */
export interface TradesOptions {
  strategy?: string;
  symbol?: string;
  status?: string;
  side?: string;
  range?: string;
  since?: string;
  until?: string;
  limit?: string;
  page?: string;
}

/**
 * Default page size. Small enough to read in a terminal without
 * scrolling; `--limit` raises it.
 */
const DEFAULT_LIMIT = 25;

/**
 * We ask the server for the full history by default.
 *
 * graphql-api's `get_trades` defaults `dateRange` to `MONTH` when the
 * field is omitted. Inheriting that would mean a user whose bot last
 * traded five weeks ago sees an empty table and concludes the CLI —
 * or their strategy — is broken. `--range` narrows it back down.
 */
const DEFAULT_RANGE: TradeDateRange = 'ALL';

export function buildTradesCommand(deps: TradesDeps = {}): Command {
  return new Command('trades')
    .description('List trades executed on your account')
    .option('--strategy <id>', 'Only show trades from this strategy')
    .option('--symbol <pair>', 'Only show trades for this pair (e.g. BTC/USDT)')
    .option(
      '--status <status>',
      `Filter by status (${TRADE_STATUSES.map((s) => s.toLowerCase()).join(', ')})`,
    )
    .option('--side <side>', `Filter by side (${TRADE_SIDES.map((s) => s.toLowerCase()).join(', ')})`)
    .option(
      '--range <window>',
      `Time window (${TRADE_DATE_RANGES.map((r) => r.toLowerCase()).join(', ')})`,
      DEFAULT_RANGE.toLowerCase(),
    )
    .option('--since <date>', 'Only show trades executed on or after this date')
    .option('--until <date>', 'Only show trades executed on or before this date')
    .option('--limit <n>', `Maximum rows to show (default ${DEFAULT_LIMIT})`)
    .option('--page <n>', 'Page number, for paging past the first --limit rows')
    .action(async (opts: TradesOptions) => {
      await runTrades(opts, deps);
    });
}

/**
 * Translate raw flags into an SDK {@link TradeFilter}, validating as we
 * go. Exported so the sibling observability commands can crib the shape
 * and so tests can assert on the filter without a round trip.
 */
export function buildFilter(opts: TradesOptions): TradeFilter {
  const filter: TradeFilter = {
    dateRange: parseEnumOption('--range', opts.range, TRADE_DATE_RANGES) ?? DEFAULT_RANGE,
    limit: parsePositiveInt('--limit', opts.limit) ?? DEFAULT_LIMIT,
  };

  if (opts.strategy) filter.strategyId = opts.strategy;
  if (opts.symbol) filter.symbol = opts.symbol;

  const status = parseEnumOption('--status', opts.status, TRADE_STATUSES);
  if (status) filter.status = status;

  const side = parseEnumOption('--side', opts.side, TRADE_SIDES);
  if (side) filter.side = side;

  const since = parseDateOption('--since', opts.since);
  if (since) filter.fromDate = since;

  const until = parseDateOption('--until', opts.until);
  if (until) filter.toDate = until;

  const page = parsePositiveInt('--page', opts.page);
  if (page !== undefined) filter.page = page;

  return filter;
}

/**
 * Build the empty-state message. Which filters are active changes what
 * "no trades" most likely means, so the hint changes with it.
 */
export function emptyMessage(filter: TradeFilter): string {
  const active: string[] = [];
  if (filter.strategyId) active.push(`strategy ${filter.strategyId}`);
  if (filter.symbol) active.push(`symbol ${filter.symbol}`);
  if (filter.status) active.push(`status ${filter.status.toLowerCase()}`);
  if (filter.side) active.push(`side ${filter.side.toLowerCase()}`);
  if (filter.dateRange && filter.dateRange !== 'ALL') active.push(`range ${filter.dateRange.toLowerCase()}`);
  if (filter.fromDate) active.push('a --since date');
  if (filter.toDate) active.push('an --until date');

  if (active.length > 0) {
    return `No trades matched ${active.join(', ')}. Try widening the filters, or run \`tokenbot trades\` with none.`;
  }
  return [
    'No trades yet.',
    "TokenBot records a trade once one of your strategies or copiers actually places an order — a newly created one won't have traded yet.",
    'Check that yours are running with `tokenbot strategy list` and `tokenbot copier list`.',
  ].join('\n');
}

/** Shape of one rendered table row. */
interface TradeRow extends Record<string, unknown> {
  executed: string;
  symbol: string;
  side: string;
  status: string;
  quantity: string;
  price: string;
  pnl: string;
  strategy: string;
  id: string;
}

function toRow(trade: Trade): TradeRow {
  return {
    executed: formatDateTime(trade.executedAt ?? trade.createdAt),
    symbol: trade.symbol,
    side: trade.side.toLowerCase(),
    status: trade.status.toLowerCase(),
    quantity: formatNumber(trade.quantity),
    // Prefer the price actually filled at; fall back to the requested one.
    price: formatNumber(trade.executedPrice ?? trade.price),
    pnl: formatSigned(trade.profitLoss),
    strategy: formatId(trade.strategyId),
    id: formatId(trade.id),
  };
}

export async function runTrades(opts: TradesOptions, deps: TradesDeps = {}): Promise<void> {
  // Validate before unlocking the identity, so a typo in --status costs
  // the user an error message rather than a passphrase prompt.
  const filter = buildFilter(opts);

  const { sdk } = await getAuthenticatedContext(deps);
  const trades = await sdk.trades.list({ filter });

  renderList(
    trades.map(toRow),
    [
      { key: 'executed', header: 'executed (utc)' },
      { key: 'symbol', header: 'symbol' },
      { key: 'side', header: 'side' },
      { key: 'status', header: 'status' },
      { key: 'quantity', header: 'qty', align: 'right' },
      { key: 'price', header: 'price', align: 'right' },
      { key: 'pnl', header: 'pnl', align: 'right' },
      { key: 'strategy', header: 'strategy' },
      { key: 'id', header: 'id' },
    ],
    {
      empty: emptyMessage(filter),
      ...(trades.length === filter.limit
        ? { footer: `Showing ${trades.length} trades. Use --limit or --page to see more.` }
        : {}),
    },
  );
}
