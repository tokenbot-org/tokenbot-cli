/**
 * `tokenbot whoami` — print identity / account info derived from local
 * config and a signed call to the server.
 *
 * @module commands/whoami
 */

import { Command } from 'commander';
import { getAuthenticatedContext, type ContextOptions } from '../context.js';
import { renderObject, isJsonMode, info } from '../util/output.js';

export function buildWhoamiCommand(deps: ContextOptions = {}): Command {
  return new Command('whoami')
    .description('Print the active CLI identity and server-side account info')
    .action(async () => {
      await runWhoami(deps);
    });
}

export async function runWhoami(deps: ContextOptions = {}): Promise<void> {
  const { config, sdk } = await getAuthenticatedContext(deps);
  const whoami = await sdk.identity.whoami();
  const payload = {
    accountId: config.accountId,
    publicKey: config.publicKey,
    apiUrl: config.apiUrl,
    server: whoami,
  };
  if (isJsonMode()) {
    renderObject(payload);
    return;
  }
  info(`account:   ${config.accountId}`);
  info(`pubkey:    ${config.publicKey}`);
  info(`apiUrl:    ${config.apiUrl}`);
  info('server:');
  renderObject(whoami);
}
