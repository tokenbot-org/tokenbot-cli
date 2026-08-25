/**
 * `tokenbot portfolio` — what the platform is holding on your behalf.
 *
 * Reads the SERVER-SIDE view: the balance snapshot graphql-api last synced
 * from each exchange account registered with `tokenbot exchange add`. It is
 * deliberately NOT the same thing as `tokenbot balance`, and the two will
 * disagree:
 *
 *   | | `balance`                          | `portfolio`                       |
 *   |-|------------------------------------|-----------------------------------|
 *   | source   | local ~/.tokenbot/keys.json + ccxt | graphql-api, server-side  |
 *   | freshness| live, at time of call        | as of each account's last sync    |
 *   | scope    | credentials on THIS machine  | accounts registered to the user   |
 *
 * Every row therefore carries its own `synced` timestamp — that column is the
 * explanation for any divergence, so it is never omitted.
 *
 * Scoping is enforced server-side: `get_exchange_accounts` calls
 * `requireAuth(user)` and filters on `{ user_id: user.id }` (plus the RLS
 * tenant filter) from the signed-request identity. This command sends no
 * identity of its own and has no flag that could widen the result set.
 *
 * @module commands/portfolio
 */

import { Command } from 'commander';
import type { TableColumn } from '@tokenbot-org/cli-core';
import { getAuthenticatedContext, type ContextOptions } from '../context.js';
import { CliUserError } from '../errors.js';
import { isJsonMode, info, renderList, renderObject } from '../util/output.js';

export type PortfolioDeps = ContextOptions;

export interface PortfolioOptions {
  exchange?: string;
  asset?: string;
  all?: boolean;
}

/**
 * Selection set.
 *
 * `balance` is graphql-api's external name for the stored `balance_snapshot`
 * — a flat per-asset quantity map taken from CCXT `fetchBalance().total`, in
 * each asset's own units. It is NOT fiat-valued, so this command computes no
 * total and shows no portfolio "value"; there is nothing in the platform that
 * prices assets.
 *
 * Issued as a raw document rather than via `sdk.exchanges.listAccounts()`
 * because that namespace's selection set omits `balance` entirely, and its
 * Zod schema has no field for it.
 */
const PORTFOLIO_QUERY = `
  query TokenbotPortfolio {
    get_exchange_accounts {
      success
      error
      data {
        id
        exchange_name
        account_name
        trading_type
        is_active
        last_sync_at
        balance
      }
    }
  }
`;

/** Wire shape of one account in the response. Keys are NOT camel-cased. */
interface WireAccount {
  id?: string | null;
  exchange_name?: string | null;
  account_name?: string | null;
  trading_type?: string | null;
  is_active?: boolean | null;
  last_sync_at?: string | number | null;
  balance?: Record<string, unknown> | null;
}

interface WireEnvelope {
  get_exchange_accounts?: {
    success?: boolean;
    error?: string | null;
    data?: WireAccount[] | null;
  } | null;
}

/** One rendered row: a single asset held in a single exchange account. */
export interface PortfolioRow extends Record<string, unknown> {
  exchange: string;
  account: string;
  type: string;
  asset: string;
  quantity: number;
  synced: string;
}

/** An account that yielded no asset rows, and why. */
export interface PortfolioGap {
  exchange: string;
  account: string;
  reason: 'never-synced' | 'empty';
  active: boolean;
}

/**
 * Parse graphql-api's `last_sync_at`.
 *
 * The GraphQL type declares it `String` while the model stores a `Date`, and
 * graphql-js coerces a Date through `valueOf()` — so the wire value is epoch
 * MILLISECONDS as a string (`"1784541600000"`), not ISO-8601. Verified
 * against `GraphQLString.serialize(new Date(...))`.
 *
 * ISO-8601 is accepted too, so this keeps working if the server is fixed to
 * emit it. Anything unparseable is treated as "never synced" rather than
 * rendered as a bogus date.
 */
export function parseSyncedAt(raw: string | number | null | undefined): Date | null {
  if (raw === null || raw === undefined || raw === '') return null;

  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? new Date(raw) : null;
  }

  // Epoch-ms arrives as an all-digit string; Date(string) would reject it.
  if (/^\d+$/.test(raw)) {
    const ms = Number(raw);
    return Number.isFinite(ms) ? new Date(ms) : null;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Render a parsed sync time, or say plainly that there isn't one. */
export function formatSyncedAt(at: Date | null): string {
  return at ? at.toISOString().replace('.000Z', 'Z') : 'never';
}

/**
 * Coerce one asset quantity.
 *
 * CCXT emits numbers, but the snapshot is `Mixed` in Mongo and round-trips
 * through JSON, so numeric strings are possible. Anything that isn't a finite
 * number is dropped rather than rendered as `NaN`.
 */
function toQuantity(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A display label for an account that may have no name set. */
function accountLabel(account: WireAccount): string {
  return account.account_name?.trim() || account.id || '(unnamed)';
}

/**
 * Flatten accounts into per-asset rows, reporting accounts that produced none.
 *
 * The gap list exists because an empty table is ambiguous: "you hold nothing"
 * and "we have never successfully read this account" look identical, and only
 * one of them is the user's problem to act on.
 */
export function flattenPortfolio(
  accounts: readonly WireAccount[],
  opts: PortfolioOptions = {},
): { rows: PortfolioRow[]; gaps: PortfolioGap[]; hiddenZeros: number } {
  const rows: PortfolioRow[] = [];
  const gaps: PortfolioGap[] = [];
  let hiddenZeros = 0;

  const wantExchange = opts.exchange?.trim().toLowerCase();
  const wantAsset = opts.asset?.trim().toUpperCase();

  for (const account of accounts) {
    const exchange = account.exchange_name ?? '(unknown)';
    if (wantExchange && exchange.toLowerCase() !== wantExchange) continue;

    const label = accountLabel(account);
    const active = account.is_active !== false;
    const synced = formatSyncedAt(parseSyncedAt(account.last_sync_at));

    // `balance` is null until the account has been synced at least once.
    // Distinct from a synced-but-empty account, so it gets its own reason.
    if (account.balance == null) {
      gaps.push({ exchange, account: label, reason: 'never-synced', active });
      continue;
    }

    let emitted = 0;
    for (const [asset, rawQty] of Object.entries(account.balance)) {
      if (wantAsset && asset.toUpperCase() !== wantAsset) continue;

      const quantity = toQuantity(rawQty);
      if (quantity === null) continue;

      // Exchanges report every listed asset, most at zero. Hidden by default
      // for legibility, surfaced by --all, and always counted so the footer
      // can say how many were suppressed.
      if (quantity === 0 && !opts.all) {
        hiddenZeros += 1;
        continue;
      }

      rows.push({ exchange, account: label, type: account.trading_type ?? '-', asset, quantity, synced });
      emitted += 1;
    }

    if (emitted === 0 && !wantAsset) {
      gaps.push({ exchange, account: label, reason: 'empty', active });
    }
  }

  rows.sort(
    (a, b) =>
      a.exchange.localeCompare(b.exchange) ||
      a.account.localeCompare(b.account) ||
      a.asset.localeCompare(b.asset),
  );

  return { rows, gaps, hiddenZeros };
}

const COLUMNS: readonly TableColumn<PortfolioRow>[] = [
  { key: 'exchange', header: 'exchange' },
  { key: 'account', header: 'account' },
  { key: 'type', header: 'type' },
  { key: 'asset', header: 'asset' },
  { key: 'quantity', header: 'quantity', align: 'right' },
  { key: 'synced', header: 'synced' },
];

export function buildPortfolioCommand(deps: PortfolioDeps = {}): Command {
  return new Command('portfolio')
    .description("Show the platform's server-side view of your exchange holdings")
    .option('--exchange <name>', 'Only show accounts on this exchange')
    .option('--asset <code>', 'Only show this asset')
    .option('--all', 'Include assets with a zero balance')
    .action(async (opts: PortfolioOptions) => {
      await runPortfolio(opts, deps);
    });
}

/** Fetch, flatten and render the caller's server-side holdings. */
export async function runPortfolio(
  opts: PortfolioOptions = {},
  deps: PortfolioDeps = {},
): Promise<void> {
  const { graphql } = await getAuthenticatedContext(deps);

  const payload = await graphql.request<WireEnvelope>(PORTFOLIO_QUERY);
  const envelope = payload?.get_exchange_accounts;

  if (!envelope) {
    throw new CliUserError('portfolio: server returned no response envelope.', 2);
  }
  if (envelope.success === false) {
    throw new CliUserError(
      `portfolio: server rejected the request: ${envelope.error ?? '<no error message>'}`,
      2,
    );
  }

  const accounts = envelope.data ?? [];
  const { rows, gaps, hiddenZeros } = flattenPortfolio(accounts, opts);

  if (isJsonMode()) {
    // Machine consumers get the gaps too — an empty `holdings` array on its
    // own would erase the never-synced/empty distinction the text mode makes.
    renderObject({
      source: 'graphql-api:get_exchange_accounts',
      note: 'Server-side snapshot per account, as of each row\'s syncedAt. Not live, not fiat-valued. `tokenbot balance` reads local keys via ccxt and will differ.',
      accounts: accounts.length,
      holdings: rows.map((r) => ({
        exchange: r.exchange,
        account: r.account,
        tradingType: r.type,
        asset: r.asset,
        quantity: r.quantity,
        syncedAt: r.synced === 'never' ? null : r.synced,
      })),
      gaps,
      zeroBalancesHidden: opts.all ? 0 : hiddenZeros,
    });
    return;
  }

  if (accounts.length === 0) {
    info('No exchange accounts registered with the platform.');
    info('Add one with `tokenbot exchange add` — note that `tokenbot balance` reads');
    info('local keys from ~/.tokenbot/keys.json and is a separate store.');
    return;
  }

  if (rows.length === 0) {
    info('No holdings to show.');
  } else {
    renderList(rows, COLUMNS);
  }

  // Provenance is printed every time. Without it a user comparing this against
  // `tokenbot balance` has no way to explain a discrepancy.
  info('');
  info('Server-side snapshot, as of each row\'s SYNCED time — not live.');
  info('Quantities are in each asset\'s own units; the platform computes no fiat value.');
  info('`tokenbot balance` queries your exchanges live with local keys and will differ.');

  if (hiddenZeros > 0 && !opts.all) {
    info(`${hiddenZeros} zero-balance asset${hiddenZeros === 1 ? '' : 's'} hidden — use --all to show.`);
  }

  for (const gap of gaps) {
    const suffix = gap.active ? '' : ' (account inactive)';
    if (gap.reason === 'never-synced') {
      info(`${gap.exchange}/${gap.account}: never synced — no snapshot to show${suffix}.`);
    } else {
      info(`${gap.exchange}/${gap.account}: synced, holding nothing${suffix}.`);
    }
  }
}
