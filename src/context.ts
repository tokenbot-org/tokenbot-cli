/**
 * Per-process CLI context.
 *
 * Lazily loads the local config, prompts for the passphrase exactly
 * once, decrypts the identity private key, and constructs a
 * `SignedHttpClient` + `TokenbotSdk`. Every command that needs to talk
 * to the API or the encrypted key store should call
 * `getAuthenticatedContext()`; one-shot commands that only need the
 * config can use `loadConfigOrThrow()`.
 *
 * The passphrase cache is process-local — once unlocked it lives in
 * memory for the duration of the CLI run so a multi-step command (e.g.
 * `tokenbot balance --all`) doesn't re-prompt between iterations.
 *
 * @module context
 */

import {
  KeyStore,
  SignedHttpClient,
  loadConfig,
  password as inqPassword,
  unlockIdentity,
  type CliConfig,
} from '@tokenbot-org/cli-core';
import { TokenbotSdk } from '@tokenbot-org/sdk';
import { CliUserError } from './errors.js';

/** Tunable bits of context construction (test seam). */
export interface ContextOptions {
  /**
   * Override the passphrase prompt. Tests pass a stub; CLI runs use
   * the default `cli-core` inquirer-based prompt.
   */
  promptPassphrase?: () => Promise<string>;
  /** Override `fetch` (forwarded into `SignedHttpClient`). Tests use this. */
  fetchImpl?: typeof fetch;
}

/** The handle returned by `getAuthenticatedContext`. */
export interface AuthenticatedContext {
  config: CliConfig;
  privateKey: Uint8Array;
  http: SignedHttpClient;
  sdk: TokenbotSdk;
  keyStore: KeyStore;
}

let cachedContext: AuthenticatedContext | null = null;

/** Reset the cache. Used by tests; not exported on the public surface. */
export function __resetContextCacheForTesting(): void {
  cachedContext = null;
}

/**
 * Load config from disk. Throws `CliUserError` (exit 1) when no config
 * is present so the top-level handler can print a friendly message.
 */
export async function loadConfigOrThrow(): Promise<CliConfig> {
  const cfg = await loadConfig();
  if (!cfg) {
    throw new CliUserError(
      'No CLI identity configured. Run `tokenbot init` to register one.',
    );
  }
  return cfg;
}

/**
 * Build a fully-wired context: config + unlocked private key + signed
 * HTTP client + SDK + key store. Caches the result for the lifetime of
 * the process so subsequent calls don't re-prompt.
 */
export async function getAuthenticatedContext(
  opts: ContextOptions = {},
): Promise<AuthenticatedContext> {
  if (cachedContext) return cachedContext;

  const config = await loadConfigOrThrow();

  const promptPassphrase = opts.promptPassphrase ?? (() => inqPassword('Passphrase:'));
  const passphrase = await promptPassphrase();
  if (!passphrase) {
    throw new CliUserError('Passphrase required to unlock identity.');
  }

  let privateKey: Uint8Array;
  try {
    privateKey = unlockIdentity(config.encryptedPrivateKey, config.privateKeySalt, passphrase);
  } catch (err) {
    throw new CliUserError(
      `Failed to unlock identity: ${err instanceof Error ? err.message : String(err)}`,
      3,
    );
  }

  const httpOpts: ConstructorParameters<typeof SignedHttpClient>[0] = {
    apiUrl: config.apiUrl,
    publicKey: config.publicKey,
    privateKey,
  };
  if (opts.fetchImpl) {
    httpOpts.fetchImpl = opts.fetchImpl;
  }
  const http = new SignedHttpClient(httpOpts);

  const sdk = new TokenbotSdk({
    http,
    // GraphQL now lives on its own host (carried by wsUrl, e.g.
    // gql-api.tokenbot.com); derive the HTTP GraphQL endpoint from the
    // WS URL via scheme-swap rather than from the REST apiUrl host.
    graphqlUrl: config.wsUrl.replace(/^ws/, 'http'),
    wsUrl: config.wsUrl,
  });

  const keyStore = new KeyStore(privateKey);

  cachedContext = { config, privateKey, http, sdk, keyStore };
  return cachedContext;
}
