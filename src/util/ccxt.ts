/**
 * Local ccxt adapter — constructs an `Exchange` instance from a
 * decrypted {@link KeyPayload} and exposes `fetchBalance`.
 *
 * ccxt is called *locally* in the CLI process. Encrypted exchange
 * credentials live in `~/.tokenbot/keys.json` (via `cli-core`'s
 * `KeyStore`) and the user's secrets never leave the machine.
 *
 * The adapter accepts an injectable `ccxtModule` (the parsed namespace
 * object exported by `ccxt`) so tests can pass a fake without touching
 * the network.
 *
 * @module util/ccxt
 */

import type { KeyPayload } from '@tokenbot-org/cli-core';

/**
 * Minimal interface we need from a ccxt-style `Exchange` instance.
 * Kept narrow on purpose so tests don't have to mock the entire ccxt
 * API surface.
 */
export interface CcxtLikeExchange {
  fetchBalance: () => Promise<CcxtBalance>;
}

/** Shape of a ccxt `fetchBalance` response (subset). */
export interface CcxtBalance {
  /** Per-currency `{ free, used, total }` map. */
  total?: Record<string, number | undefined>;
  free?: Record<string, number | undefined>;
  used?: Record<string, number | undefined>;
  /** ccxt also includes per-currency objects alongside the rollups. */
  [currency: string]:
    | { free?: number; used?: number; total?: number }
    | Record<string, number | undefined>
    | unknown
    | undefined;
}

/** A flattened balance row used in CLI output. */
export interface FlattenedBalanceRow {
  currency: string;
  free: number;
  used: number;
  total: number;
}

/** Constructor map exposed by ccxt; each entry is a class. */
export type CcxtModuleLike = Record<
  string,
  new (config: Record<string, unknown>) => CcxtLikeExchange
>;

/**
 * Construct a ccxt exchange client from a stored key payload.
 * Throws when the exchange id is unknown.
 */
export function buildCcxtClient(
  payload: KeyPayload,
  ccxtModule: CcxtModuleLike,
): CcxtLikeExchange {
  const Ctor = ccxtModule[payload.exchange];
  if (typeof Ctor !== 'function') {
    throw new Error(
      `ccxt does not support exchange "${payload.exchange}" (no constructor exported)`,
    );
  }
  const config: Record<string, unknown> = {
    apiKey: payload.apiKey,
    secret: payload.apiSecret,
    enableRateLimit: true,
  };
  if (payload.password !== undefined) config['password'] = payload.password;
  return new Ctor(config);
}

/**
 * Flatten a ccxt balance into `{ currency, free, used, total }` rows
 * sorted by total descending. Skips currencies with zero total balance.
 */
export function flattenBalance(balance: CcxtBalance): FlattenedBalanceRow[] {
  const totalMap = (balance.total ?? {}) as Record<string, number | undefined>;
  const freeMap = (balance.free ?? {}) as Record<string, number | undefined>;
  const usedMap = (balance.used ?? {}) as Record<string, number | undefined>;

  const currencies = new Set<string>([
    ...Object.keys(totalMap),
    ...Object.keys(freeMap),
    ...Object.keys(usedMap),
  ]);

  const rows: FlattenedBalanceRow[] = [];
  for (const c of currencies) {
    const total = Number(totalMap[c] ?? 0);
    const free = Number(freeMap[c] ?? 0);
    const used = Number(usedMap[c] ?? 0);
    if (total === 0 && free === 0 && used === 0) continue;
    rows.push({ currency: c, free, used, total });
  }
  rows.sort((a, b) => b.total - a.total);
  return rows;
}
