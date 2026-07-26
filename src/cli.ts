#!/usr/bin/env node
/**
 * `tokenbot` CLI entry point.
 *
 * Wires Commander.js with every sub-command and a top-level error
 * handler that maps cli-core / SDK errors to friendly messages and the
 * exit codes the Wave 2A spec calls for.
 *
 * @module cli
 */

import { Command } from 'commander';
import { mapError } from './errors.js';
import { setJsonMode } from './util/output.js';
import { buildInitCommand } from './commands/init.js';
import { buildWhoamiCommand } from './commands/whoami.js';
import { buildLoginCommand } from './commands/login.js';
import { buildLogoutCommand } from './commands/logout.js';
import { buildKeysCommand } from './commands/keys.js';
import { buildBalanceCommand } from './commands/balance.js';
import {
  buildLinkCommand,
  buildLinksCommand,
  buildUnlinkCommand,
} from './commands/link.js';
import { buildStrategyCommand } from './commands/strategy.js';
import { buildCopierCommand } from './commands/copier.js';
import { buildExchangeCommand } from './commands/exchange.js';
import { buildWebhooksCommand } from './commands/webhooks.js';
import { buildRewardsCommand } from './commands/rewards.js';
import { buildApiKeyCommand } from './commands/apikey.js';

/**
 * Read `package.json` lazily so the bundle doesn't pin the version at
 * build time. Falls back to "0.0.0" if the file can't be located.
 */
function readVersion(): string {
  // dist/cli.js sits next to dist/package.json only if the publish step
  // packs it; in dev we read from the source-tree package.json instead.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../package.json') as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Build the root `Command` with every sub-command wired up. */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name('tokenbot')
    .description('TokenBot — manage strategies, copiers, balances, and webhooks from your terminal')
    .version(readVersion())
    .option('--json', 'Output results as JSON for piping to other tools')
    .option('--config <path>', 'Override the config directory (sets TOKENBOT_HOME)')
    .hook('preAction', (thisCmd) => {
      const opts = thisCmd.opts<{ json?: boolean; config?: string }>();
      if (opts.json) setJsonMode(true);
      if (opts.config) {
        process.env['TOKENBOT_HOME'] = opts.config;
      }
    });

  program.addCommand(buildInitCommand());
  program.addCommand(buildWhoamiCommand());
  program.addCommand(buildLoginCommand());
  program.addCommand(buildLogoutCommand());
  program.addCommand(buildKeysCommand());
  program.addCommand(buildBalanceCommand());
  program.addCommand(buildLinkCommand());
  program.addCommand(buildUnlinkCommand());
  program.addCommand(buildLinksCommand());
  program.addCommand(buildStrategyCommand());
  program.addCommand(buildCopierCommand());
  program.addCommand(buildExchangeCommand());
  program.addCommand(buildWebhooksCommand());
  program.addCommand(buildRewardsCommand());
  program.addCommand(buildApiKeyCommand());

  return program;
}

/**
 * Run the CLI with the supplied argv. Exported for tests; the bin
 * shebang script below calls this with `process.argv`.
 */
export async function main(argv: readonly string[]): Promise<number> {
  const program = buildProgram();
  // Commander default behaviour exits the process on `--help` and
  // unknown commands. We let it — those are exit-0 / exit-1 paths that
  // the framework already handles correctly.
  program.exitOverride();
  try {
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (err) {
    // Commander throws `CommanderError` for help/version/usage exits.
    // Treat those as exit code 0 (help) / 1 (usage) per Commander's
    // own `exitCode` field.
    if (isCommanderError(err)) {
      return err.exitCode ?? 1;
    }
    const mapped = mapError(err);
    // eslint-disable-next-line no-console -- CLI error output.
    console.error(`error: ${mapped.message}`);
    return mapped.exitCode;
  }
}

interface CommanderErrorShape {
  name: string;
  exitCode?: number;
}

function isCommanderError(err: unknown): err is CommanderErrorShape {
  return (
    err !== null &&
    typeof err === 'object' &&
    'name' in err &&
    typeof (err as { name: unknown }).name === 'string' &&
    (err as { name: string }).name === 'CommanderError'
  );
}

// Direct bin invocation — when this file is the entry module, kick off
// the CLI immediately. `require.main === module` works under CJS;
// under ESM we fall back to comparing the import.meta URL.
if (typeof require !== 'undefined' && require.main === module) {
  // argv[0] is "node", argv[1] is the script path.
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      // eslint-disable-next-line no-console -- last-resort error reporter.
      console.error(err);
      process.exit(2);
    },
  );
}
