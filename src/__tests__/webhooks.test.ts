import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runWebhooksAdd,
  runWebhooksList,
  runWebhooksRemove,
  runWebhooksTest,
} from '../commands/webhooks.js';
import { CliUserError } from '../errors.js';
import {
  captureStdout,
  clearSeed,
  makeFakeFetch,
  makePassphrase,
  seedConfig,
} from './helpers.js';

afterEach(() => clearSeed());

const WH = {
  id: 'wh-1',
  user_id: 'u',
  url: 'https://example.com/wh',
  events: ['trade.executed'],
  is_active: true,
  description: 'd',
  created_at: '2026-05-17T00:00:00Z',
  updated_at: '2026-05-17T00:00:00Z',
};

describe('runWebhooksList', () => {
  it('renders the webhook table', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, { data: [WH] });
    const out = await captureStdout(async () =>
      runWebhooksList({ promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );
    expect(out).toContain('wh-1');
    expect(out).toContain('https://example.com/wh');
  });
});

describe('runWebhooksAdd', () => {
  it('parses comma-separated events', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, { data: WH });
    await captureStdout(async () =>
      runWebhooksAdd(
        { url: 'https://h', events: 'a, b ,c', description: 'd' },
        { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
      ),
    );
    const body = JSON.parse(fake.calls[0]!.body) as Record<string, unknown>;
    expect(body['events']).toEqual(['a', 'b', 'c']);
    expect(body['description']).toBe('d');
  });

  it('rejects empty events list', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    await expect(
      runWebhooksAdd(
        { url: 'https://h', events: '' },
        { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
      ),
    ).rejects.toBeInstanceOf(CliUserError);
  });

  it('rejects empty url', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    await expect(
      runWebhooksAdd(
        { url: '', events: 'a' },
        { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl },
      ),
    ).rejects.toBeInstanceOf(CliUserError);
  });
});

describe('runWebhooksRemove', () => {
  it('issues DELETE after a double-confirm', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(204, '');
    const promptConfirm = vi.fn(async () => true);
    await captureStdout(async () =>
      runWebhooksRemove('wh-1', {
        promptPassphrase: makePassphrase(),
        fetchImpl: fake.fetchImpl,
        promptConfirm,
      }),
    );
    expect(fake.calls[0]!.method).toBe('DELETE');
    expect(promptConfirm).toHaveBeenCalledWith(expect.any(String), true);
  });

  it('aborts when confirm declines', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    await expect(
      runWebhooksRemove('wh-1', {
        promptPassphrase: makePassphrase(),
        fetchImpl: fake.fetchImpl,
        promptConfirm: async () => false,
      }),
    ).rejects.toBeInstanceOf(CliUserError);
  });
});

describe('runWebhooksTest', () => {
  it('prints delivery status', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, { data: { delivered: true, status: 200 } });
    const out = await captureStdout(async () =>
      runWebhooksTest('wh-1', { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );
    expect(out).toContain('delivered');
  });

  it('prints failure status', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, {
      data: { delivered: false, status: 500, message: 'boom' },
    });
    const out = await captureStdout(async () =>
      runWebhooksTest('wh-1', { promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );
    expect(out).toContain('failed');
    expect(out).toContain('boom');
  });
});
