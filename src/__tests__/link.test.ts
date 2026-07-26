import { afterEach, describe, expect, it } from 'vitest';
import { runLink, runLinksList, runUnlink } from '../commands/link.js';
import {
  captureStdout,
  clearSeed,
  makeFakeFetch,
  makePassphrase,
  seedConfig,
} from './helpers.js';
import { setJsonMode } from '../util/output.js';

afterEach(() => clearSeed());

/**
 * Wire-shape fixture matching the server's `update_copier` response —
 * a `CopierResponse { success, data, error }` envelope around the raw
 * Mongoose Copier document.
 */
function copierResponse(extra: Record<string, unknown> = {}) {
  return {
    data: {
      update_copier: {
        success: true,
        error: null,
        data: {
          id: 'c1',
          user_id: 'u1',
          strategy_id: 's1',
          exchange_account_id: 'e1',
          name: 'My Copier',
          allocation_percentage: 50,
          is_active: true,
          created_at: '2026-05-17T00:00:00Z',
          updated_at: '2026-05-17T00:00:00Z',
          ...extra,
        },
      },
    },
  };
}

describe('runLink', () => {
  it('issues update_copier(copier:) with strategy_id + is_active=true', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, copierResponse({ strategy_id: 's1', is_active: true }));

    await captureStdout(async () =>
      runLink(
        { strategy: 's1', copier: 'c1' },
        { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
      ),
    );
    const body = JSON.parse(fake.calls[0]!.body) as {
      query: string;
      variables: { copier: Record<string, unknown> };
    };
    expect(body.query).toMatch(/update_copier\(copier: \$copier\)/);
    expect(body.variables.copier).toEqual({
      id: 'c1',
      strategy_id: 's1',
      is_active: true,
    });
  });

  it('emits a friendly status line', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, copierResponse({ strategy_id: 's1', is_active: true }));
    const out = await captureStdout(async () =>
      runLink(
        { strategy: 's1', copier: 'c1' },
        { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
      ),
    );
    expect(out).toContain('Linked copier c1');
  });

  it('emits JSON in json mode', async () => {
    await seedConfig();
    setJsonMode(true);
    const fake = makeFakeFetch();
    fake.respond(200, copierResponse({ strategy_id: 's1', is_active: true }));
    const out = await captureStdout(async () =>
      runLink(
        { strategy: 's1', copier: 'c1' },
        { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
      ),
    );
    const parsed = JSON.parse(out) as { linked: boolean };
    expect(parsed.linked).toBe(true);
  });
});

describe('runUnlink', () => {
  it('issues update_copier(copier:) with strategy_id: null + is_active=false', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, copierResponse({ strategy_id: null, is_active: false }));

    await captureStdout(async () =>
      runUnlink(
        { strategy: 's1', copier: 'c1' },
        { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
      ),
    );
    const body = JSON.parse(fake.calls[0]!.body) as {
      variables: { copier: Record<string, unknown> };
    };
    // The SDK preserves explicit `null` so the server sees the field
    // present-and-null rather than absent (Mongoose model allows null
    // strategy_id; see graphql-api/src/models/Copier.js).
    expect(body.variables.copier.id).toBe('c1');
    expect(body.variables.copier.strategy_id).toBeNull();
    expect(body.variables.copier.is_active).toBe(false);
  });
});

describe('runLinksList', () => {
  /** `get_copiers` envelope helper. */
  function copiersListResponse(rows: Array<Record<string, unknown>>) {
    return {
      data: {
        get_copiers: {
          success: true,
          error: null,
          data: rows,
        },
      },
    };
  }

  it('joins copiers with strategy names', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    // First request: strategies list. Second: copiers list (Promise.all
    // dispatches strategies first per the source order).
    fake.respond(200, {
      data: {
        strategies: [
          {
            id: 's1',
            user_id: 'u',
            exchange_account_id: 'e',
            name: 'Stratty',
            is_public: false,
            is_active: true,
            status: 'active',
            created_at: '2026-05-17T00:00:00Z',
            updated_at: '2026-05-17T00:00:00Z',
          },
        ],
      },
    });
    fake.respond(
      200,
      copiersListResponse([
        {
          id: 'c1',
          name: 'My Copier',
          exchange: 'binance',
          status: 'active',
          statusMessage: null,
          is_active: true,
          strategy: { id: 's1' },
        },
      ]),
    );

    const out = await captureStdout(async () =>
      runLinksList({ promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );
    expect(out).toContain('Stratty');
    expect(out).toContain('c1');
  });

  it('falls back to "(unknown)" when the strategy isnt in the user-visible list', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, { data: { strategies: [] } });
    fake.respond(
      200,
      copiersListResponse([
        {
          id: 'c2',
          name: 'Orphan Copier',
          exchange: 'binance',
          status: 'error',
          statusMessage: 'no strategy',
          is_active: false,
          strategy: { id: 'orphan' },
        },
      ]),
    );
    const out = await captureStdout(async () =>
      runLinksList({ promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );
    expect(out).toContain('(unknown)');
  });
});
