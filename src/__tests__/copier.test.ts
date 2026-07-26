import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runCopierAdd,
  runCopierDelete,
  runCopierList,
  runCopierShow,
} from '../commands/copier.js';
import { CliUserError } from '../errors.js';
import {
  captureStdout,
  clearSeed,
  makeFakeFetch,
  makePassphrase,
  seedConfig,
} from './helpers.js';

afterEach(() => clearSeed());

/** Wire shape for `get_copiers` rows (FormattedCopier). */
const FORMATTED = {
  id: 'c1',
  name: 'My Copier',
  exchange: 'binance',
  status: 'active',
  statusMessage: null,
  is_active: true,
  strategy: { id: 's1' },
};

/** Wire shape for mutation responses (raw Copier). */
const COP = {
  id: 'c1',
  user_id: 'u',
  strategy_id: 's1',
  exchange_account_id: 'e1',
  name: 'My Copier',
  allocation_percentage: 50,
  is_active: true,
  created_at: '2026-05-17T00:00:00Z',
  updated_at: '2026-05-17T00:00:00Z',
};

function listEnvelope(rows: Array<Record<string, unknown>>) {
  return { data: { get_copiers: { success: true, error: null, data: rows } } };
}

function mutationEnvelope(op: string, data: Record<string, unknown>) {
  return { data: { [op]: { success: true, error: null, data } } };
}

describe('runCopierList', () => {
  it('renders the copier rows', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, listEnvelope([FORMATTED]));
    const out = await captureStdout(async () =>
      runCopierList({ promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );
    expect(out).toContain('c1');
    expect(out).toContain('s1');
    expect(out).toContain('binance');
  });
});

describe('runCopierShow', () => {
  it('prints the copier JSON', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    // get() filters the list response client-side — no `copier(id:)` query.
    fake.respond(200, listEnvelope([FORMATTED]));
    const out = await captureStdout(async () =>
      runCopierShow('c1', { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );
    expect(JSON.parse(out)).toMatchObject({ id: 'c1', strategyId: 's1' });
  });
});

describe('runCopierAdd', () => {
  it('creates a copier with all fields supplied via options', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, mutationEnvelope('create_copier', COP));
    await captureStdout(async () =>
      runCopierAdd(
        {
          strategy: 's1',
          exchangeAccountId: 'e1',
          name: 'My Copier',
          allocation: '50',
        },
        { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
      ),
    );
    const body = JSON.parse(fake.calls[0]!.body) as {
      variables: { copier: Record<string, unknown> };
    };
    expect(body.variables.copier).toMatchObject({
      strategy_id: 's1',
      exchange_account_id: 'e1',
      name: 'My Copier',
      allocation_percentage: 50,
    });
  });

  // A new copier is created inactive server-side, so the success line has to
  // name the command that arms it — otherwise users assume it is already copying.
  it('flags a newly created copier as inactive and names the link command', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, mutationEnvelope('create_copier', { ...COP, is_active: false }));
    const out = await captureStdout(async () =>
      runCopierAdd(
        { strategy: 's1', exchangeAccountId: 'e1', name: 'My Copier', allocation: '50' },
        { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
      ),
    );
    expect(out).toContain('inactive');
    expect(out).toContain('tokenbot link --strategy s1 --copier c1');
  });

  it('omits the inactive hint when the server returns an active copier', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, mutationEnvelope('create_copier', { ...COP, is_active: true }));
    const out = await captureStdout(async () =>
      runCopierAdd(
        { strategy: 's1', exchangeAccountId: 'e1', name: 'My Copier', allocation: '50' },
        { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
      ),
    );
    expect(out).not.toContain('inactive');
  });

  it('rejects a non-positive allocation percentage', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    await expect(
      runCopierAdd(
        { strategy: 's1', exchangeAccountId: 'e1', name: 'n', allocation: '0' },
        { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
      ),
    ).rejects.toBeInstanceOf(CliUserError);
  });

  it('rejects an allocation greater than 100', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    await expect(
      runCopierAdd(
        { strategy: 's1', exchangeAccountId: 'e1', name: 'n', allocation: '150' },
        { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
      ),
    ).rejects.toBeInstanceOf(CliUserError);
  });

  it('rejects a non-numeric allocation', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    await expect(
      runCopierAdd(
        { strategy: 's1', exchangeAccountId: 'e1', name: 'n', allocation: 'NaN' },
        { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
      ),
    ).rejects.toBeInstanceOf(CliUserError);
  });
});

describe('runCopierDelete', () => {
  it('deletes after a double-confirm', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    // delete_copier returns only { success, error } — no echoed data.
    fake.respond(200, { data: { delete_copier: { success: true, error: null } } });
    const promptConfirm = vi.fn(async () => true);
    await captureStdout(async () =>
      runCopierDelete('c1', {
        promptPassphrase: makePassphrase(),
        fetchImpl: fake.fetchImpl,
        promptConfirm,
      }),
    );
    expect(promptConfirm).toHaveBeenCalledWith(expect.any(String), true);
  });

  it('aborts when confirm declines', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    await expect(
      runCopierDelete('c1', {
        promptPassphrase: makePassphrase(),
        fetchImpl: fake.fetchImpl,
        promptConfirm: async () => false,
      }),
    ).rejects.toBeInstanceOf(CliUserError);
  });
});
