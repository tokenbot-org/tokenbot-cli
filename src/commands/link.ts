/**
 * `tokenbot link / unlink / links list` — strategy↔copier relationship
 * management.
 *
 * Delegates to `sdk.copiers.link` / `sdk.copiers.unlink` (added in
 * sdk@0.4.0 alongside the CopiersNamespace reconciliation with the
 * real graphql-api schema). The raw `sdk.gql(...)` mutations used by
 * the earlier draft pointed at a `(id, input)` mutation shape the
 * server never actually exposed; the SDK now wraps the real
 * `update_copier(copier:)` shape and unwraps the `CopierResponse`
 * envelope behind a typed API.
 *
 * @module commands/link
 */

import { Command } from 'commander';
import { getAuthenticatedContext, type ContextOptions } from '../context.js';
import { CliUserError } from '../errors.js';
import { renderList, renderText } from '../util/output.js';

export interface LinkOptions {
  strategy: string;
  copier: string;
}

export function buildLinkCommand(deps: ContextOptions = {}): Command {
  return new Command('link')
    .description('Bind a copier to a strategy')
    .requiredOption('--strategy <id>', 'Strategy id')
    .requiredOption('--copier <id>', 'Copier id')
    .action(async (opts: LinkOptions) => {
      await runLink(opts, deps);
    });
}

export function buildUnlinkCommand(deps: ContextOptions = {}): Command {
  return new Command('unlink')
    .description('Detach a copier from a strategy')
    .requiredOption('--strategy <id>', 'Strategy id (for clarity; the copier id is the lookup key)')
    .requiredOption('--copier <id>', 'Copier id')
    .action(async (opts: LinkOptions) => {
      await runUnlink(opts, deps);
    });
}

export function buildLinksCommand(deps: ContextOptions = {}): Command {
  const cmd = new Command('links').description('Inspect strategy↔copier relationships');
  cmd
    .command('list')
    .description('List every copier alongside the strategy it follows')
    .action(async () => {
      await runLinksList(deps);
    });
  return cmd;
}

export async function runLink(opts: LinkOptions, deps: ContextOptions = {}): Promise<void> {
  if (!opts.strategy || !opts.copier) {
    throw new CliUserError('Both --strategy and --copier are required.');
  }
  const { sdk } = await getAuthenticatedContext(deps);
  await sdk.copiers.link(opts.strategy, opts.copier);
  renderText(`Linked copier ${opts.copier} → strategy ${opts.strategy}.`, {
    strategy: opts.strategy,
    copier: opts.copier,
    linked: true,
  });
}

export async function runUnlink(opts: LinkOptions, deps: ContextOptions = {}): Promise<void> {
  if (!opts.strategy || !opts.copier) {
    throw new CliUserError('Both --strategy and --copier are required.');
  }
  const { sdk } = await getAuthenticatedContext(deps);
  await sdk.copiers.unlink(opts.strategy, opts.copier);
  renderText(`Unlinked copier ${opts.copier} from strategy ${opts.strategy}.`, {
    strategy: opts.strategy,
    copier: opts.copier,
    linked: false,
  });
}

export async function runLinksList(deps: ContextOptions = {}): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  const [strategies, copiers] = await Promise.all([
    sdk.strategies.list(),
    sdk.copiers.list(),
  ]);
  const strategyById = new Map(strategies.map((s) => [s.id, s]));

  const rows = copiers.map((c) => {
    const strategy = c.strategyId ? strategyById.get(c.strategyId) : undefined;
    return {
      copier: c.id,
      strategy: c.strategyId ?? '',
      strategyName: strategy?.name ?? (c.strategyId ? '(unknown)' : '(none)'),
      status: c.status ?? '',
      active: c.isActive,
    };
  });

  renderList(rows, [
    { key: 'copier', header: 'copier' },
    { key: 'strategy', header: 'strategy' },
    { key: 'strategyName', header: 'name' },
    { key: 'status', header: 'status' },
    { key: 'active', header: 'active' },
  ]);
}
