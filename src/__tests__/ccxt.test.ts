import { describe, expect, it, vi } from 'vitest';
import type { KeyPayload } from '@tokenbot-org/cli-core';
import {
  buildCcxtClient,
  flattenBalance,
  type CcxtModuleLike,
} from '../util/ccxt.js';

describe('buildCcxtClient', () => {
  it('constructs the named exchange with apiKey + secret', () => {
    const ctor = vi.fn(function MockExchange(this: object, config: Record<string, unknown>) {
      Object.assign(this, { config, fetchBalance: async () => ({}) });
    }) as unknown as new (config: Record<string, unknown>) => { fetchBalance: () => Promise<unknown> };
    const mod: CcxtModuleLike = { binance: ctor };
    const payload: KeyPayload = {
      exchange: 'binance',
      apiKey: 'k',
      apiSecret: 's',
    };
    const client = buildCcxtClient(payload, mod) as unknown as { config: Record<string, unknown> };
    expect(client.config['apiKey']).toBe('k');
    expect(client.config['secret']).toBe('s');
    expect(client.config['enableRateLimit']).toBe(true);
    expect(client.config['password']).toBeUndefined();
  });

  it('passes through password when present', () => {
    const ctor = vi.fn(function MockExchange(this: object, config: Record<string, unknown>) {
      Object.assign(this, { config, fetchBalance: async () => ({}) });
    }) as unknown as new (config: Record<string, unknown>) => { fetchBalance: () => Promise<unknown> };
    const mod: CcxtModuleLike = { okx: ctor };
    const client = buildCcxtClient(
      { exchange: 'okx', apiKey: 'k', apiSecret: 's', password: 'pp' },
      mod,
    ) as unknown as { config: Record<string, unknown> };
    expect(client.config['password']).toBe('pp');
  });

  it('throws on unknown exchange', () => {
    const mod: CcxtModuleLike = {};
    expect(() =>
      buildCcxtClient({ exchange: 'doesnotexist', apiKey: 'k', apiSecret: 's' }, mod),
    ).toThrow(/doesnotexist/);
  });
});

describe('flattenBalance', () => {
  it('flattens a ccxt response into sorted rows', () => {
    const rows = flattenBalance({
      total: { BTC: 1, ETH: 10, USDT: 100 },
      free: { BTC: 1, ETH: 9, USDT: 50 },
      used: { BTC: 0, ETH: 1, USDT: 50 },
    });
    expect(rows.map((r) => r.currency)).toEqual(['USDT', 'ETH', 'BTC']);
    expect(rows[0]).toEqual({ currency: 'USDT', free: 50, used: 50, total: 100 });
  });

  it('drops zero-balance currencies', () => {
    const rows = flattenBalance({ total: { BTC: 0, ETH: 1 }, free: { BTC: 0, ETH: 1 }, used: { BTC: 0, ETH: 0 } });
    expect(rows.map((r) => r.currency)).toEqual(['ETH']);
  });

  it('handles a totally empty response', () => {
    expect(flattenBalance({})).toEqual([]);
  });

  it('falls back to 0 for missing free / used values', () => {
    const rows = flattenBalance({ total: { BTC: 1 } });
    expect(rows[0]).toEqual({ currency: 'BTC', free: 0, used: 0, total: 1 });
  });
});
