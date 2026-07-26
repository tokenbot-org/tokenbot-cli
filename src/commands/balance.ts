/**
 * `tokenbot balance` — fetch exchange balances locally via ccxt.
 *
 * The server is never told about the user's exchange credentials. We
 * load the encrypted payload from `~/.tokenbot/keys.json`, construct a
 * ccxt client in-process, call `fetchBalance()`, and render the result.
 *
 * `--all` walks every stored credential in parallel and shows a
 * combined table with a `label` column.
 *
 * @module commands/balance
 */

import { Command } from 'commander';
import { getAuthenticatedContext, type ContextOptions } from '../context.js';
import { CliUserError } from '../errors.js';
import { isJsonMode, renderList, renderObject } from '../util/output.js';
import {
  buildCcxtClient,
  flattenBalance,
  type CcxtModuleLike,
  type FlattenedBalanceRow,
} from '../util/ccxt.js';

export interface BalanceDeps extends ContextOptions {
  /** Inject a pre-loaded ccxt namespace; defaults to dynamic-import('ccxt'). */
  ccxtModule?: CcxtModuleLike;
}

export interface BalanceOptions {
  strategy?: string;
  copier?: string;
  all?: boolean;
}

export function buildBalanceCommand(deps: BalanceDeps = {}): Command {
  return new Command('balance')
    .description('Fetch exchange balances locally via ccxt')
    .option('--strategy <id>', 'Show balance for the strategy with this id')
    .option('--copier <id>', 'Show balance for the copier with this id')
    .option('--all', 'Show balances for every stored credential')
    .action(async (opts: BalanceOptions) => {
      await runBalance(opts, deps);
    });
}

/** Resolve the label set this invocation should operate on. */
export function resolveLabelsForBalance(
  opts: BalanceOptions,
  allLabels: readonly string[],
): string[] {
  const flags = [opts.strategy, opts.copier, opts.all].filter(Boolean).length;
  if (flags === 0) {
    throw new CliUserError(
      'Pass --strategy <id>, --copier <id>, or --all to choose which balance(s) to fetch.',
    );
  }
  if (flags > 1) {
    throw new CliUserError('Pass exactly one of --strategy, --copier, or --all.');
  }
  if (opts.all) return [...allLabels];
  if (opts.strategy) return [`strategy:${opts.strategy}`];
  return [`copier:${opts.copier}`];
}

/** Dynamically import ccxt unless an override was injected. */
async function resolveCcxt(deps: BalanceDeps): Promise<CcxtModuleLike> {
  if (deps.ccxtModule) return deps.ccxtModule;
  // ccxt v4 ships a giant namespace; exchange constructors hang off
  // either the default export (ESM consumers) or the namespace object
  // itself (CJS). We don't model the full surface here — `CcxtModuleLike`
  // is the narrow `Record<string, ctor>` shape we actually use.
  const mod = (await import('ccxt')) as unknown as {
    default?: Record<string, unknown>;
    [k: string]: unknown;
  };
  const ns = (mod.default ?? mod) as unknown as CcxtModuleLike;
  return ns;
}

export async function runBalance(
  opts: BalanceOptions,
  deps: BalanceDeps = {},
): Promise<void> {
  const { keyStore } = await getAuthenticatedContext(deps);
  const allLabels = await keyStore.listKeys();
  const labels = resolveLabelsForBalance(opts, allLabels);
  if (labels.length === 0) {
    throw new CliUserError('No stored credentials. Use `tokenbot keys add ...` first.');
  }

  const ccxtModule = await resolveCcxt(deps);

  const results = await Promise.all(
    labels.map(async (label) => {
      try {
        const payload = await keyStore.getKey(label);
        const client = buildCcxtClient(payload, ccxtModule);
        const raw = await client.fetchBalance();
        const rows = flattenBalance(raw);
        return { label, exchange: payload.exchange, rows, error: null as string | null };
      } catch (err) {
        return {
          label,
          exchange: '',
          rows: [] as FlattenedBalanceRow[],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  if (isJsonMode()) {
    renderObject(results);
    return;
  }

  // Combined view: prepend the label column and concatenate rows.
  interface CombinedRow extends Record<string, unknown> {
    label: string;
    exchange: string;
    currency: string;
    free: number;
    used: number;
    total: number;
  }
  const combined: CombinedRow[] = [];
  for (const r of results) {
    if (r.error) {
      // eslint-disable-next-line no-console -- CLI output.
      console.error(`! ${r.label}: ${r.error}`);
      continue;
    }
    for (const row of r.rows) {
      combined.push({
        label: r.label,
        exchange: r.exchange,
        currency: row.currency,
        free: row.free,
        used: row.used,
        total: row.total,
      });
    }
  }

  renderList(combined, [
    { key: 'label', header: 'label' },
    { key: 'exchange', header: 'exchange' },
    { key: 'currency', header: 'currency' },
    { key: 'free', header: 'free', align: 'right' },
    { key: 'used', header: 'used', align: 'right' },
    { key: 'total', header: 'total', align: 'right' },
  ]);
}
