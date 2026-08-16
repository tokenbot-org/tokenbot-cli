/**
 * `tokenbot init` — generate a CLI identity, register it with the
 * tokenbot API, and persist `~/.tokenbot/config.json`.
 *
 * @module commands/init
 */

import { hostname } from 'node:os';
import { Command } from 'commander';
import {
  SignedHttpClient,
  confirm,
  generateIdentity,
  loadConfig,
  password as inqPassword,
  saveConfig,
  signCanonicalString,
} from '@tokenbot-org/cli-core';
import { TokenbotSdk } from '@tokenbot-org/sdk';
import { CliUserError } from '../errors.js';
import { renderText } from '../util/output.js';

/** Default API + WS endpoints. Overridable via CLI flags. */
export const DEFAULT_API_URL = 'https://api.tokenbot.com';
export const DEFAULT_WS_URL = 'wss://gql-api.tokenbot.com/graphql';

/** Dependency injection seam for tests. */
export interface InitDeps {
  /** Override the passphrase prompt. */
  promptPassphrase?: () => Promise<string>;
  /** Override the API-key prompt. */
  promptApiKey?: () => Promise<string>;
  /** Override the confirm prompt used when overwriting existing config. */
  promptConfirm?: (msg: string, double: boolean) => Promise<boolean>;
  /** Override fetch (so the registration round-trip is mockable). */
  fetchImpl?: typeof fetch;
  /** Override the hostname used to label the identity. */
  hostnameFn?: () => string;
}

/** Options accepted by {@link runInit}. */
export interface InitOptions {
  apiUrl: string;
  wsUrl: string;
  label?: string;
  apiKey?: string;
}

/** Build a `Command` for `tokenbot init`. */
export function buildInitCommand(deps: InitDeps = {}): Command {
  return new Command('init')
    .description('Generate a CLI identity and register it with TokenBot')
    .option('--api-url <url>', 'Override the TokenBot API URL', DEFAULT_API_URL)
    .option('--ws-url <url>', 'Override the TokenBot WebSocket URL', DEFAULT_WS_URL)
    .option('--label <label>', 'Human-friendly label for this CLI identity')
    .option(
      '--api-key <key>',
      'API key authorizing this registration. Falls back to $TOKENBOT_API_KEY, ' +
        'otherwise prompted. Prefer the prompt — an argv-supplied key is visible ' +
        'in shell history and the process table.',
    )
    .action(async (options: InitOptions) => {
      await runInit(options, deps);
    });
}

/** Programmatic entry — exposed for unit testing. */
export async function runInit(
  options: InitOptions,
  deps: InitDeps = {},
): Promise<void> {
  const existing = await loadConfig();
  const promptConfirm =
    deps.promptConfirm ?? ((msg: string, double: boolean) => confirm(msg, { double }));

  if (existing) {
    const ok = await promptConfirm(
      'A config already exists. Overwrite and register a new identity?',
      true,
    );
    if (!ok) {
      throw new CliUserError('Aborted — existing identity left in place.');
    }
  }

  const promptPassphrase =
    deps.promptPassphrase ??
    (() => inqPassword('Choose a passphrase to encrypt your private key:'));
  const passphrase = await promptPassphrase();
  if (!passphrase) {
    throw new CliUserError('Passphrase is required to encrypt the private key.');
  }

  // Registration must be authorized by a credential that already exists.
  // The keypair generated below is by definition not yet registered, so
  // signing with it proves nothing to the server: rest-api keeps
  // /v1/auth/cli-identity outside PUBLIC_ROUTES and its handler requires
  // "an API key OR an existing CLI identity". Without one, registration
  // fails with 401 CLI_IDENTITY_UNKNOWN.
  const promptApiKey =
    deps.promptApiKey ??
    (() => inqPassword('API key authorizing this registration:'));
  const apiKey =
    options.apiKey ?? process.env['TOKENBOT_API_KEY'] ?? (await promptApiKey());
  if (!apiKey) {
    throw new CliUserError(
      'An API key is required to register a new CLI identity. Pass --api-key, ' +
        'set TOKENBOT_API_KEY, or enter one when prompted.',
    );
  }

  const id = generateIdentity(passphrase);

  // Build a transient SDK against the new identity so we can sign the
  // challenge round-trip in one place.
  const httpOpts: ConstructorParameters<typeof SignedHttpClient>[0] = {
    apiUrl: options.apiUrl,
    publicKey: id.publicKey,
    privateKey: id.privateKey,
    apiKey,
  };
  if (deps.fetchImpl) {
    httpOpts.fetchImpl = deps.fetchImpl;
  }
  const http = new SignedHttpClient(httpOpts);
  const sdk = new TokenbotSdk({ http });

  const challenge = await sdk.identity.getChallenge();
  const signature = signCanonicalString(id.privateKey, challenge.nonce);
  const label = options.label ?? (deps.hostnameFn ?? hostname)();

  const identity = await sdk.identity.register({
    publicKey: id.publicKey,
    signatureOverChallenge: signature,
    challengeId: challenge.challengeId,
    label,
  });

  await saveConfig({
    accountId: identity.accountId,
    publicKey: id.publicKey,
    encryptedPrivateKey: id.encryptedPrivateKey,
    privateKeySalt: id.salt,
    apiUrl: options.apiUrl,
    wsUrl: options.wsUrl,
    createdAt: identity.createdAt,
  });

  renderText(
    `Identity registered.\n  account: ${identity.accountId}\n  pubkey:  ${id.publicKey}\n  label:   ${label}`,
    {
      accountId: identity.accountId,
      publicKey: id.publicKey,
      label,
      apiUrl: options.apiUrl,
    },
  );
}
