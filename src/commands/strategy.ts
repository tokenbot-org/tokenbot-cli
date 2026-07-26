/**
 * `tokenbot strategy ...` — list / show / add / delete.
 *
 * @module commands/strategy
 */

import { Command } from 'commander';
import { confirm, input as inqInput } from '@tokenbot-org/cli-core';
import type { CreateStrategyInput } from '@tokenbot-org/sdk';
import { getAuthenticatedContext, type ContextOptions } from '../context.js';
import { CliUserError } from '../errors.js';
import { renderList, renderObject, renderText } from '../util/output.js';

export interface StrategyDeps extends ContextOptions {
  promptInput?: (msg: string, defaultValue?: string) => Promise<string>;
  promptConfirm?: (msg: string, double: boolean) => Promise<boolean>;
}

export function buildStrategyCommand(deps: StrategyDeps = {}): Command {
  const cmd = new Command('strategy').description('Manage trading strategies');

  cmd
    .command('list')
    .description('List all strategies you own')
    .action(async () => {
      await runStrategyList(deps);
    });

  cmd
    .command('show <id>')
    .description('Show a single strategy as JSON')
    .action(async (id: string) => {
      await runStrategyShow(id, deps);
    });

  cmd
    .command('add')
    .description('Create a new strategy (interactive)')
    .option('--name <name>', 'Strategy name')
    .option('--description <desc>', 'Description')
    .option('--exchange-account-id <id>', 'Exchange account id')
    .option('--public', 'Mark the strategy as public', false)
    .action(
      async (opts: {
        name?: string;
        description?: string;
        exchangeAccountId?: string;
        public?: boolean;
      }) => {
        await runStrategyAdd(opts, deps);
      },
    );

  cmd
    .command('delete <id>')
    .description('Delete a strategy (double-confirm)')
    .action(async (id: string) => {
      await runStrategyDelete(id, deps);
    });

  return cmd;
}

export async function runStrategyList(deps: StrategyDeps = {}): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  const strategies = await sdk.strategies.list();
  const rows = strategies.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    active: s.isActive,
    public: s.isPublic,
    exchange: s.exchangeAccountId,
  }));
  renderList(rows, [
    { key: 'id', header: 'id' },
    { key: 'name', header: 'name' },
    { key: 'status', header: 'status' },
    { key: 'active', header: 'active' },
    { key: 'public', header: 'public' },
    { key: 'exchange', header: 'exchange' },
  ]);
}

export async function runStrategyShow(id: string, deps: StrategyDeps = {}): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  const s = await sdk.strategies.get(id);
  renderObject(s);
}

export async function runStrategyAdd(
  opts: { name?: string; description?: string; exchangeAccountId?: string; public?: boolean },
  deps: StrategyDeps = {},
): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  const promptInput = deps.promptInput ?? inqInput;

  const name = opts.name ?? (await promptInput('Strategy name:'));
  if (!name) throw new CliUserError('Strategy name is required.');

  const exchangeAccountId =
    opts.exchangeAccountId ?? (await promptInput('Exchange account id:'));
  if (!exchangeAccountId) {
    throw new CliUserError('Exchange account id is required.');
  }

  const description = opts.description ?? (await promptInput('Description (optional):'));

  const input: CreateStrategyInput = {
    name,
    exchangeAccountId,
    isPublic: !!opts.public,
  };
  if (description) input.description = description;

  const created = await sdk.strategies.create(input);
  renderText(`Created strategy ${created.id} ("${created.name}").`, created);
}

export async function runStrategyDelete(id: string, deps: StrategyDeps = {}): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  const promptConfirm =
    deps.promptConfirm ?? ((msg: string, double: boolean) => confirm(msg, { double }));
  const ok = await promptConfirm(`Delete strategy ${id}? This cannot be undone.`, true);
  if (!ok) throw new CliUserError('Aborted.');
  await sdk.strategies.delete(id);
  renderText(`Deleted strategy ${id}.`, { deleted: id });
}
