/**
 * `tokenbot rewards ...` — show summary / print referral code.
 *
 * @module commands/rewards
 */

import { Command } from 'commander';
import { getAuthenticatedContext, type ContextOptions } from '../context.js';
import { renderObject, renderText } from '../util/output.js';

export function buildRewardsCommand(deps: ContextOptions = {}): Command {
  const cmd = new Command('rewards').description('View rewards and referral info');

  cmd
    .command('show')
    .description('Show the rewards summary')
    .action(async () => {
      await runRewardsShow(deps);
    });

  cmd
    .command('refer')
    .description('Print your referral code')
    .action(async () => {
      await runRewardsRefer(deps);
    });

  return cmd;
}

export async function runRewardsShow(deps: ContextOptions = {}): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  renderObject(await sdk.rewards.summary());
}

export async function runRewardsRefer(deps: ContextOptions = {}): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  const code = await sdk.rewards.referralCode();
  renderText(`Referral code: ${code.code}`, code);
}
