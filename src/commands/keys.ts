/**
 * `tokenbot keys ...` — local-only exchange API credential management.
 *
 * Credentials are stored in `~/.tokenbot/keys.json`, encrypted with a
 * key derived from the unlocked CLI identity (see `cli-core`'s
 * `KeyStore`). The server **never** sees these — they live exclusively
 * on the user's machine and are used by `tokenbot balance` (and future
 * client-side commands) to talk to exchanges via ccxt.
 *
 * Labels are `strategy:<id>` or `copier:<id>` so the CLI knows which
 * stored credential to load when running `tokenbot balance --strategy ...`.
 *
 * @module commands/keys
 */

import { Command } from 'commander';
import { confirm, input as inqInput, password as inqPassword, type KeyPayload } from '@tokenbot-org/cli-core';
import { getAuthenticatedContext, type ContextOptions } from '../context.js';
import { CliUserError } from '../errors.js';
import { renderList, renderText } from '../util/output.js';

export interface KeysDeps extends ContextOptions {
  /** Override the interactive prompts (test seam). */
  promptInput?: (msg: string, defaultValue?: string) => Promise<string>;
  promptPassword?: (msg: string) => Promise<string>;
  promptConfirm?: (msg: string, double: boolean) => Promise<boolean>;
}

/** Build the `tokenbot keys` parent command with `add`, `list`, `remove`. */
export function buildKeysCommand(deps: KeysDeps = {}): Command {
  const cmd = new Command('keys').description('Manage local-only exchange API credentials');

  cmd
    .command('add')
    .description('Add or replace an exchange API credential for a strategy or copier')
    .option('--strategy <id>', 'Strategy id to bind this credential to')
    .option('--copier <id>', 'Copier id to bind this credential to')
    .option('--exchange <name>', 'Exchange id (e.g. binance, kraken). Prompted if omitted.')
    .action(async (opts: { strategy?: string; copier?: string; exchange?: string }) => {
      await runKeysAdd(opts, deps);
    });

  cmd
    .command('list')
    .description('List all stored credential labels')
    .action(async () => {
      await runKeysList(deps);
    });

  cmd
    .command('remove <label>')
    .description('Delete the credential stored under <label>')
    .action(async (label: string) => {
      await runKeysRemove(label, deps);
    });

  return cmd;
}

/** Resolve the label string from the `--strategy` / `--copier` flag pair. */
export function resolveLabel(opts: { strategy?: string; copier?: string }): string {
  const hasStrategy = typeof opts.strategy === 'string' && opts.strategy.length > 0;
  const hasCopier = typeof opts.copier === 'string' && opts.copier.length > 0;
  if (hasStrategy && hasCopier) {
    throw new CliUserError('Pass exactly one of --strategy or --copier, not both.');
  }
  if (!hasStrategy && !hasCopier) {
    throw new CliUserError('You must pass --strategy <id> or --copier <id>.');
  }
  return hasStrategy ? `strategy:${opts.strategy}` : `copier:${opts.copier}`;
}

export async function runKeysAdd(
  opts: { strategy?: string; copier?: string; exchange?: string },
  deps: KeysDeps = {},
): Promise<void> {
  const label = resolveLabel(opts);
  const { sdk, keyStore } = await getAuthenticatedContext(deps);
  const promptInput = deps.promptInput ?? inqInput;
  const promptPassword = deps.promptPassword ?? inqPassword;

  let exchange = opts.exchange;
  if (!exchange) {
    const supported = await sdk.exchanges.listSupported();
    const known = supported.map((s) => s.id).join(', ');
    exchange = (await promptInput(`Exchange (one of: ${known}):`)).trim();
  }
  if (!exchange) throw new CliUserError('Exchange is required.');

  const apiKey = (await promptInput('API key:')).trim();
  if (!apiKey) throw new CliUserError('API key is required.');
  const apiSecret = (await promptPassword('API secret:')).trim();
  if (!apiSecret) throw new CliUserError('API secret is required.');
  const passwordValue = (
    await promptPassword('API passphrase (optional, press enter to skip):')
  ).trim();

  const payload: KeyPayload = {
    exchange,
    apiKey,
    apiSecret,
  };
  if (passwordValue.length > 0) payload.password = passwordValue;

  await keyStore.addKey(label, payload);

  renderText(`Stored credential under "${label}".`, { label, exchange });
}

export async function runKeysList(deps: KeysDeps = {}): Promise<void> {
  const { keyStore } = await getAuthenticatedContext(deps);
  const labels = await keyStore.listKeys();
  const rows = labels.map((label) => {
    const [kind = '', id = ''] = label.split(':', 2);
    return { label, kind, id };
  });
  renderList(rows, [
    { key: 'label', header: 'label' },
    { key: 'kind', header: 'kind' },
    { key: 'id', header: 'id' },
  ]);
}

export async function runKeysRemove(label: string, deps: KeysDeps = {}): Promise<void> {
  const { keyStore } = await getAuthenticatedContext(deps);
  const promptConfirm =
    deps.promptConfirm ?? ((msg: string, double: boolean) => confirm(msg, { double }));
  const ok = await promptConfirm(`Delete credential "${label}"?`, true);
  if (!ok) throw new CliUserError('Aborted.');
  await keyStore.removeKey(label);
  renderText(`Removed "${label}".`, { removed: label });
}
