import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runStrategyAdd,
  runStrategyDelete,
  runStrategyList,
  runStrategyShow,
} from '../commands/strategy.js';
import { CliUserError } from '../errors.js';
import {
  captureStdout,
  clearSeed,
  makeFakeFetch,
  makePassphrase,
  seedConfig,
} from './helpers.js';
import { setJsonMode } from '../util/output.js';

afterEach(() => clearSeed());

const STRAT = {
  id: 's1',
  user_id: 'u',
  exchange_account_id: 'e',
  name: 'Strat',
  is_public: false,
  is_active: true,
  status: 'active',
  created_at: '2026-05-17T00:00:00Z',
  updated_at: '2026-05-17T00:00:00Z',
};

describe('runStrategyList', () => {
  it('renders a table of strategies', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, { data: { strategies: [STRAT] } });
    const out = await captureStdout(async () =>
      runStrategyList({ promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );
    expect(out).toContain('Strat');
    expect(out).toContain('s1');
  });

  it('emits JSON in json mode', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    setJsonMode(true);
    fake.respond(200, { data: { strategies: [STRAT] } });
    const out = await captureStdout(async () =>
      runStrategyList({ promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );
    const parsed = JSON.parse(out) as Array<{ id: string }>;
    expect(parsed[0]!.id).toBe('s1');
  });
});

describe('runStrategyShow', () => {
  it('prints the strategy as JSON', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, { data: { strategy: STRAT } });
    const out = await captureStdout(async () =>
      runStrategyShow('s1', { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );
    const parsed = JSON.parse(out) as { id: string };
    expect(parsed.id).toBe('s1');
  });
});

describe('runStrategyAdd', () => {
  it('creates a strategy from explicit options', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, { data: { create_strategy: STRAT } });
    await captureStdout(async () =>
      runStrategyAdd(
        { name: 'Strat', exchangeAccountId: 'e', description: 'd', public: true },
        { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
      ),
    );
    const body = JSON.parse(fake.calls[0]!.body) as {
      variables: { input: Record<string, unknown> };
    };
    expect(body.variables.input).toMatchObject({
      name: 'Strat',
      exchange_account_id: 'e',
      description: 'd',
      is_public: true,
    });
  });

  it('prompts for missing fields', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, { data: { create_strategy: STRAT } });
    const inputs = ['name-from-prompt', 'eid-from-prompt', ''];
    const promptInput = vi.fn(async () => inputs.shift() ?? '');
    await captureStdout(async () =>
      runStrategyAdd(
        {},
        {
          promptPassphrase: makePassphrase(),
          fetchImpl: fake.fetchImpl,
          promptInput,
        },
      ),
    );
    expect(promptInput).toHaveBeenCalledTimes(3);
  });

  it('rejects empty name', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    await expect(
      runStrategyAdd(
        {},
        {
          promptPassphrase: makePassphrase(),
          fetchImpl: fake.fetchImpl,
          promptInput: async () => '',
        },
      ),
    ).rejects.toBeInstanceOf(CliUserError);
  });
});

describe('runStrategyDelete', () => {
  it('deletes after a double-confirm', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, { data: { delete_strategy: { id: 's1' } } });
    const promptConfirm = vi.fn(async () => true);
    await captureStdout(async () =>
      runStrategyDelete('s1', {
        promptPassphrase: makePassphrase(),
        fetchImpl: fake.fetchImpl,
        promptConfirm,
      }),
    );
    expect(promptConfirm).toHaveBeenCalledWith(expect.any(String), true);
    const body = JSON.parse(fake.calls[0]!.body) as { query: string };
    expect(body.query).toMatch(/SdkDeleteStrategy/);
  });

  it('aborts on decline', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    await expect(
      runStrategyDelete('s1', {
        promptPassphrase: makePassphrase(),
        fetchImpl: fake.fetchImpl,
        promptConfirm: async () => false,
      }),
    ).rejects.toBeInstanceOf(CliUserError);
  });
});
