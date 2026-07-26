/**
 * `tokenbot login` — in Wave 2A this is a thin shim that confirms an
 * identity is already configured (and points to `tokenbot init`
 * otherwise). OAuth/browser-based login is a Wave 5 enhancement.
 *
 * @module commands/login
 */

import { Command } from 'commander';
import { loadConfig } from '@tokenbot-org/cli-core';
import { CliUserError } from '../errors.js';
import { renderText } from '../util/output.js';

export function buildLoginCommand(): Command {
  return new Command('login')
    .description('Confirm CLI identity is configured (use `tokenbot init` to register)')
    .action(async () => {
      await runLogin();
    });
}

export async function runLogin(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg) {
    throw new CliUserError(
      'No identity configured. Run `tokenbot init` to register one.',
    );
  }
  renderText(`Already logged in as ${cfg.accountId}.`, {
    accountId: cfg.accountId,
    publicKey: cfg.publicKey,
    apiUrl: cfg.apiUrl,
  });
}
