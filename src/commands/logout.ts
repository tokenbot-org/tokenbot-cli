/**
 * `tokenbot logout` — destroys the local config + key store.
 *
 * Requires a double-confirm because both files are unrecoverable once
 * deleted: the encrypted private key cannot be regenerated, and the
 * stored exchange credentials are forever lost.
 *
 * @module commands/logout
 */

import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { Command } from 'commander';
import { confirm, getConfigDir } from '@tokenbot-org/cli-core';
import { CliUserError } from '../errors.js';
import { renderText } from '../util/output.js';

export interface LogoutDeps {
  promptConfirm?: (msg: string, double: boolean) => Promise<boolean>;
  /** rm wrapper — test seam. */
  rmFn?: (path: string) => Promise<void>;
}

export function buildLogoutCommand(deps: LogoutDeps = {}): Command {
  return new Command('logout')
    .description('Delete local CLI config and encrypted key store')
    .action(async () => {
      await runLogout(deps);
    });
}

export async function runLogout(deps: LogoutDeps = {}): Promise<void> {
  const promptConfirm =
    deps.promptConfirm ?? ((msg: string, double: boolean) => confirm(msg, { double }));
  const ok = await promptConfirm(
    'Delete local identity and exchange keys? This cannot be undone.',
    true,
  );
  if (!ok) throw new CliUserError('Aborted — nothing was deleted.');

  const dir = getConfigDir();
  const configPath = join(dir, 'config.json');
  const keysPath = join(dir, 'keys.json');
  const rmFn = deps.rmFn ?? ((p: string) => rm(p, { force: true }));
  await rmFn(configPath);
  await rmFn(keysPath);

  renderText('Logged out. Local identity and key store removed.', {
    removed: [configPath, keysPath],
  });
}
