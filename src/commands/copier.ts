/**
 * `tokenbot copier ...` — list / show / add / delete.
 *
 * Uses `sdk.copiers.*` (sdk@0.4.0+) which targets the real
 * `CreateCopierPayload` / `CopierResponse` shapes the live graphql-api
 * exposes. The allocation field is `allocationPercentage` (0–100), not
 * the pre-0.4.0 `allocationAmount` + `allocationCurrency` pair (which
 * never existed server-side).
 *
 * @module commands/copier
 */

import { Command } from 'commander';
import { confirm, input as inqInput } from '@tokenbot-org/cli-core';
import type { CreateCopierInput } from '@tokenbot-org/sdk';
import { getAuthenticatedContext, type ContextOptions } from '../context.js';
import { CliUserError } from '../errors.js';
import { renderList, renderObject, renderText } from '../util/output.js';

export interface CopierDeps extends ContextOptions {
  promptInput?: (msg: string, defaultValue?: string) => Promise<string>;
  promptConfirm?: (msg: string, double: boolean) => Promise<boolean>;
}

export function buildCopierCommand(deps: CopierDeps = {}): Command {
  const cmd = new Command('copier').description('Manage copy-trading subscriptions');

  cmd
    .command('list')
    .description('List all copiers you own')
    .action(async () => {
      await runCopierList(deps);
    });

  cmd
    .command('show <id>')
    .description('Show a single copier as JSON')
    .action(async (id: string) => {
      await runCopierShow(id, deps);
    });

  cmd
    .command('add')
    .description('Create a new copier (interactive)')
    .option('--strategy <id>', 'Strategy id to follow')
    .option('--exchange-account-id <id>', 'Exchange account id')
    .option('--name <name>', 'Human-readable copier name')
    .option('--allocation <percentage>', 'Allocation percentage of the exchange account (0-100)')
    .action(
      async (opts: {
        strategy?: string;
        exchangeAccountId?: string;
        name?: string;
        allocation?: string;
      }) => {
        await runCopierAdd(opts, deps);
      },
    );

  cmd
    .command('delete <id>')
    .description('Delete a copier (double-confirm)')
    .action(async (id: string) => {
      await runCopierDelete(id, deps);
    });

  return cmd;
}

export async function runCopierList(deps: CopierDeps = {}): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  const copiers = await sdk.copiers.list();
  const rows = copiers.map((c) => ({
    id: c.id,
    name: c.name,
    strategy: c.strategyId ?? '',
    exchange: c.exchange ?? '',
    status: c.status ?? '',
    active: c.isActive,
    allocation: c.allocationPercentage ?? '',
  }));
  renderList(rows, [
    { key: 'id', header: 'id' },
    { key: 'name', header: 'name' },
    { key: 'strategy', header: 'strategy' },
    { key: 'exchange', header: 'exchange' },
    { key: 'status', header: 'status' },
    { key: 'active', header: 'active' },
    { key: 'allocation', header: 'allocation %', align: 'right' },
  ]);
}

export async function runCopierShow(id: string, deps: CopierDeps = {}): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  renderObject(await sdk.copiers.get(id));
}

export async function runCopierAdd(
  opts: { strategy?: string; exchangeAccountId?: string; name?: string; allocation?: string },
  deps: CopierDeps = {},
): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  const promptInput = deps.promptInput ?? inqInput;

  const strategyId = opts.strategy ?? (await promptInput('Strategy id to follow:'));
  if (!strategyId) throw new CliUserError('Strategy id is required.');

  const exchangeAccountId =
    opts.exchangeAccountId ?? (await promptInput('Exchange account id:'));
  if (!exchangeAccountId) throw new CliUserError('Exchange account id is required.');

  const name = opts.name ?? (await promptInput('Copier name:'));
  if (!name) throw new CliUserError('Copier name is required.');

  const allocationStr = opts.allocation ?? (await promptInput('Allocation percentage (0-100):'));
  const allocationPercentage = Number(allocationStr);
  if (!Number.isFinite(allocationPercentage) || allocationPercentage <= 0 || allocationPercentage > 100) {
    throw new CliUserError(
      `Allocation percentage must be a number in (0, 100] (got "${allocationStr}").`,
    );
  }

  const input: CreateCopierInput = {
    strategyId,
    exchangeAccountId,
    name,
    allocationPercentage,
  };
  const created = await sdk.copiers.create(input);

  // A new copier is INACTIVE server-side and copies nothing until it is armed
  // (monitor-v2's watcher only follows leaders that have an active copier), so
  // say so and name the command that starts it — otherwise the plain "Created
  // copier ..." line reads as "it's running now".
  const startHint = created.isActive
    ? ''
    : ` (inactive — run \`tokenbot link --strategy ${strategyId} --copier ${created.id}\` to start it)`;
  renderText(
    `Created copier ${created.id} for strategy ${created.strategyId ?? '(none)'}.${startHint}`,
    created,
  );
}

export async function runCopierDelete(id: string, deps: CopierDeps = {}): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  const promptConfirm =
    deps.promptConfirm ?? ((msg: string, double: boolean) => confirm(msg, { double }));
  const ok = await promptConfirm(`Delete copier ${id}? This cannot be undone.`, true);
  if (!ok) throw new CliUserError('Aborted.');
  await sdk.copiers.delete(id);
  renderText(`Deleted copier ${id}.`, { deleted: id });
}
