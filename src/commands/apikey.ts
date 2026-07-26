/**
 * `tokenbot apikey ...` — server-side API key management (for
 * programmatic access via the rest-api).
 *
 * Distinct from the local `tokenbot keys ...` family, which manages
 * *exchange* credentials that never leave the user's machine.
 *
 * @module commands/apikey
 */

import { Command } from 'commander';
import { confirm, input as inqInput } from '@tokenbot-org/cli-core';
import type { CreateApiKeyInput } from '@tokenbot-org/sdk';
import { getAuthenticatedContext, type ContextOptions } from '../context.js';
import { CliUserError } from '../errors.js';
import { renderList, renderObject, renderText } from '../util/output.js';

export interface ApiKeyDeps extends ContextOptions {
  promptInput?: (msg: string, defaultValue?: string) => Promise<string>;
  promptConfirm?: (msg: string, double: boolean) => Promise<boolean>;
}

export function buildApiKeyCommand(deps: ApiKeyDeps = {}): Command {
  const cmd = new Command('apikey').description('Manage server-side API keys');

  cmd
    .command('list')
    .description('List your active API keys (without secrets)')
    .action(async () => {
      await runApiKeyList(deps);
    });

  cmd
    .command('create')
    .description('Create a new API key (the secret is printed exactly once)')
    .option('--name <name>', 'Key name')
    .option('--description <desc>', 'Description')
    .option('--env <env>', 'Environment: live or test', 'live')
    .option('--permissions <permissions>', 'Comma-separated permission strings', '')
    .action(
      async (opts: {
        name?: string;
        description?: string;
        env?: string;
        permissions?: string;
      }) => {
        await runApiKeyCreate(opts, deps);
      },
    );

  cmd
    .command('revoke <id>')
    .description('Revoke an API key (double-confirm)')
    .action(async (id: string) => {
      await runApiKeyRevoke(id, deps);
    });

  return cmd;
}

export async function runApiKeyList(deps: ApiKeyDeps = {}): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  const keys = await sdk.apiKeys.list();
  renderList(
    keys.map((k) => ({
      id: k.id,
      name: k.name,
      env: k.environment,
      prefix: k.keyPrefix,
      status: k.status,
      perms: k.permissions.join(','),
    })),
    [
      { key: 'id', header: 'id' },
      { key: 'name', header: 'name' },
      { key: 'env', header: 'env' },
      { key: 'prefix', header: 'prefix' },
      { key: 'status', header: 'status' },
      { key: 'perms', header: 'perms' },
    ],
  );
}

export async function runApiKeyCreate(
  opts: { name?: string; description?: string; env?: string; permissions?: string },
  deps: ApiKeyDeps = {},
): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  const promptInput = deps.promptInput ?? inqInput;

  const name = opts.name ?? (await promptInput('Key name:'));
  if (!name) throw new CliUserError('Key name is required.');

  const env = (opts.env ?? 'live').toLowerCase();
  if (env !== 'live' && env !== 'test') {
    throw new CliUserError('--env must be "live" or "test".');
  }

  const permsStr = opts.permissions ?? (await promptInput('Permissions (comma-separated):'));
  const permissions = permsStr
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (permissions.length === 0) {
    throw new CliUserError('At least one permission is required.');
  }

  const input: CreateApiKeyInput = {
    name,
    environment: env as 'live' | 'test',
    permissions,
  };
  if (opts.description) input.description = opts.description;

  const created = await sdk.apiKeys.create(input);
  renderText(
    `Created API key ${created.id}.\nKEY (shown ONCE — store it now): ${created.key}`,
    created,
  );
  // Output the full object so users can pipe through jq if they want.
  renderObject(created);
}

export async function runApiKeyRevoke(id: string, deps: ApiKeyDeps = {}): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  const promptConfirm =
    deps.promptConfirm ?? ((msg: string, double: boolean) => confirm(msg, { double }));
  const ok = await promptConfirm(`Revoke API key ${id}? This cannot be undone.`, true);
  if (!ok) throw new CliUserError('Aborted.');
  await sdk.apiKeys.revoke(id);
  renderText(`Revoked API key ${id}.`, { revoked: id });
}
