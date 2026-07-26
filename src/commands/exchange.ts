/**
 * `tokenbot exchange ...` — list / add / supported.
 *
 * `add` *does* send credentials to the server, because the server-side
 * `ExchangeAccount` is how strategies/copiers reference exchange
 * connections in the GraphQL schema. (The local-only flow lives in
 * `tokenbot keys ...`, which is for client-side balance checks only.)
 *
 * @module commands/exchange
 */

import { Command } from 'commander';
import { input as inqInput, password as inqPassword } from '@tokenbot-org/cli-core';
import { TradingType } from '@tokenbot-org/data-models';
import type { CreateExchangeAccountInput } from '@tokenbot-org/sdk';
import { getAuthenticatedContext, type ContextOptions } from '../context.js';
import { CliUserError } from '../errors.js';
import { renderList, renderText } from '../util/output.js';

export interface ExchangeDeps extends ContextOptions {
  promptInput?: (msg: string, defaultValue?: string) => Promise<string>;
  promptPassword?: (msg: string) => Promise<string>;
}

/** Valid `trading_type` values, lifted from the data-models enum. */
const TRADING_TYPES = Object.values(TradingType) as TradingType[];
const TRADING_TYPE_LIST = TRADING_TYPES.join(' | ');

/**
 * Coerce/validate a raw trading-type string into the {@link TradingType}
 * enum. Empty input falls back to `spot`. Throws {@link CliUserError} on
 * an unrecognized value.
 */
function resolveTradingType(raw: string | undefined): TradingType {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return TradingType.SPOT;
  if ((TRADING_TYPES as string[]).includes(value)) {
    return value as TradingType;
  }
  throw new CliUserError(
    `Invalid trading type "${raw}". Expected one of: ${TRADING_TYPE_LIST}.`,
  );
}

export function buildExchangeCommand(deps: ExchangeDeps = {}): Command {
  const cmd = new Command('exchange').description('Manage server-side exchange account links');

  cmd
    .command('list')
    .description('List your registered exchange accounts')
    .action(async () => {
      await runExchangeList(deps);
    });

  cmd
    .command('add')
    .description('Register a new exchange account on the server (interactive)')
    .option('--exchange <name>', 'Exchange id (e.g. binance)')
    .option('--account-name <name>', 'Friendly account name')
    .option('--trading-type <type>', `Trading mode (${TRADING_TYPE_LIST})`)
    .action(async (opts: { exchange?: string; accountName?: string; tradingType?: string }) => {
      await runExchangeAdd(opts, deps);
    });

  cmd
    .command('supported')
    .description('List exchanges the server is willing to connect to')
    .action(async () => {
      await runExchangeSupported(deps);
    });

  return cmd;
}

export async function runExchangeList(deps: ExchangeDeps = {}): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  const accounts = await sdk.exchanges.listAccounts();
  renderList(
    accounts.map((a) => ({
      id: a.id,
      exchange: a.exchangeName,
      name: a.accountName ?? '',
      tradingType: a.tradingType,
      active: a.isActive,
    })),
    [
      { key: 'id', header: 'id' },
      { key: 'exchange', header: 'exchange' },
      { key: 'name', header: 'name' },
      { key: 'tradingType', header: 'trading_type' },
      { key: 'active', header: 'active' },
    ],
  );
}

export async function runExchangeSupported(deps: ExchangeDeps = {}): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  const supported = await sdk.exchanges.listSupported();
  renderList(
    supported.map((s) => ({
      id: s.id,
      name: s.name,
      caption: s.caption ?? '',
    })),
    [
      { key: 'id', header: 'id' },
      { key: 'name', header: 'name' },
      { key: 'caption', header: 'caption' },
    ],
  );
}

export async function runExchangeAdd(
  opts: { exchange?: string; accountName?: string; tradingType?: string },
  deps: ExchangeDeps = {},
): Promise<void> {
  const { sdk } = await getAuthenticatedContext(deps);
  const promptInput = deps.promptInput ?? inqInput;
  const promptPassword = deps.promptPassword ?? inqPassword;

  const exchangeName = opts.exchange ?? (await promptInput('Exchange id (e.g. binance):'));
  if (!exchangeName) throw new CliUserError('Exchange id is required.');

  const accountName = opts.accountName ?? (await promptInput('Friendly account name (optional):'));

  const tradingTypeRaw =
    opts.tradingType ??
    (await promptInput(`Trading type (${TRADING_TYPE_LIST}) [spot]:`, TradingType.SPOT));
  const tradingType = resolveTradingType(tradingTypeRaw);

  const apiKey = (await promptInput('API key:')).trim();
  if (!apiKey) throw new CliUserError('API key is required.');
  const apiSecret = (await promptPassword('API secret:')).trim();
  if (!apiSecret) throw new CliUserError('API secret is required.');
  const apiPassphrase = (
    await promptPassword('API passphrase (optional, press enter to skip):')
  ).trim();

  const input: CreateExchangeAccountInput = {
    exchangeName,
    tradingType,
    apiKey,
    apiSecret,
  };
  if (accountName) input.accountName = accountName;
  if (apiPassphrase) input.apiPassphrase = apiPassphrase;

  const created = await sdk.exchanges.createAccount(input);
  renderText(
    `Registered exchange account ${created.id} (${created.exchangeName}, ${created.tradingType}).`,
    created,
  );
}
