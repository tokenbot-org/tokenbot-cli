/**
 * `tokenbot webhooks ...` — list / add / remove / test.
 *
 * @module commands/webhooks
 */

import { Command } from 'commander';
import { confirm, input as inqInput } from '@tokenbot-org/cli-core';
import type { CreateWebhookInput } from '@tokenbot-org/sdk';
import { getAuthenticatedContext, type ContextOptions } from '../context.js';
import { CliUserError } from '../errors.js';
import { renderList, renderText } from '../util/output.js';

export interface WebhooksDeps extends ContextOptions {
  promptInput?: (msg: string, defaultValue?: string) => Promise<string>;
  promptConfirm?: (msg: string, double: boolean) => Promise<boolean>;
}

export function buildWebhooksCommand(deps: WebhooksDeps = {}): Command {
  const cmd = new Command('webhooks').description('Manage outbound webhook endpoints');

  cmd
    .command('list')
    .description('List all webhook endpoints')
    .action(async () => {
      await runWebhooksList(deps);
    });

  cmd
    .command('add')
    .description('Register a new webhook endpoint')
    .option('--url <url>', 'Endpoint URL')
    .option('--events <events>', 'Comma-separated event types', '')
    .option('--description <desc>', 'Description')
    .action(async (opts: { url?: string; events?: string; description?: string }) => {
      await runWebhooksAdd(opts, deps);
    });

  cmd
    .command('remove <id>')
    .description('Delete a webhook endpoint (double-confirm)')
    .action(async (id: string) => {
      await runWebhooksRemove(id, deps);
    });

  cmd
    .command('test <id>')
    .description('Send a test event to a webhook endpoint')
    .action(async (id: string) => {
      await runWebhooksTest(id, deps);
    });

  return cmd;
}

export async function runWebhooksList(deps: WebhooksDeps = {}): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  const webhooks = await sdk.webhooks.list();
  renderList(
    webhooks.map((w) => ({
      id: w.id,
      url: w.url,
      events: w.events.join(','),
      active: w.isActive,
      description: w.description ?? '',
    })),
    [
      { key: 'id', header: 'id' },
      { key: 'url', header: 'url' },
      { key: 'events', header: 'events' },
      { key: 'active', header: 'active' },
      { key: 'description', header: 'description' },
    ],
  );
}

export async function runWebhooksAdd(
  opts: { url?: string; events?: string; description?: string },
  deps: WebhooksDeps = {},
): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  const promptInput = deps.promptInput ?? inqInput;

  const url = opts.url ?? (await promptInput('Endpoint URL:'));
  if (!url) throw new CliUserError('Endpoint URL is required.');

  const eventsStr = opts.events ?? (await promptInput('Events (comma-separated):'));
  const events = eventsStr
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (events.length === 0) {
    throw new CliUserError('At least one event type is required.');
  }

  const description = opts.description;
  const input: CreateWebhookInput = { url, events };
  if (description) input.description = description;
  const created = await sdk.webhooks.create(input);
  renderText(`Created webhook ${created.id}.`, created);
}

export async function runWebhooksRemove(id: string, deps: WebhooksDeps = {}): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  const promptConfirm =
    deps.promptConfirm ?? ((msg: string, double: boolean) => confirm(msg, { double }));
  const ok = await promptConfirm(`Delete webhook ${id}?`, true);
  if (!ok) throw new CliUserError('Aborted.');
  await sdk.webhooks.delete(id);
  renderText(`Deleted webhook ${id}.`, { deleted: id });
}

export async function runWebhooksTest(id: string, deps: WebhooksDeps = {}): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  const result = await sdk.webhooks.test(id);
  renderText(
    `Test event ${result.delivered ? 'delivered' : 'failed'}` +
      (result.status !== undefined ? ` (status ${result.status})` : '') +
      (result.message ? `: ${result.message}` : ''),
    result,
  );
}
