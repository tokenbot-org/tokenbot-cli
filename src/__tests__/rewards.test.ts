import { afterEach, describe, expect, it } from 'vitest';
import { runRewardsRefer, runRewardsShow } from '../commands/rewards.js';
import {
  captureStdout,
  clearSeed,
  makeFakeFetch,
  makePassphrase,
  seedConfig,
} from './helpers.js';

afterEach(() => clearSeed());

describe('runRewardsShow', () => {
  it('prints the rewards summary as JSON', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, {
      data: {
        rewards_summary: {
          user_id: 'u',
          total_earned: 10,
          pending_amount: 1,
          paid_amount: 9,
          currency: 'USDT',
        },
      },
    });
    const out = await captureStdout(async () =>
      runRewardsShow({ promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );
    const parsed = JSON.parse(out) as { totalEarned: number };
    expect(parsed.totalEarned).toBe(10);
  });
});

describe('runRewardsRefer', () => {
  it('prints the referral code', async () => {
    await seedConfig();
    const fake = makeFakeFetch();
    fake.respond(200, {
      data: { referral_code: { code: 'TB-XYZ', user_id: 'u' } },
    });
    const out = await captureStdout(async () =>
      runRewardsRefer({ promptPassphrase: makePassphrase(), fetchImpl: fake.fetchImpl }),
    );
    expect(out).toContain('TB-XYZ');
  });
});
