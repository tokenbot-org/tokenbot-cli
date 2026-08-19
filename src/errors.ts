/**
 * CLI-level error mapping. Translates `cli-core` + `sdk` errors into
 * friendly messages plus the right exit code.
 *
 * Exit codes (matches the Wave 2A spec):
 *   - 0  success
 *   - 1  user error (bad input, missing config, unknown command)
 *   - 2  network / server error
 *   - 3  auth error (run `tokenbot init` or `tokenbot login`)
 *
 * @module errors
 */

import {
  CliAuthError,
  CliConfigError,
  CliKeyStoreError,
  CliNetworkError,
} from '@tokenbot-org/cli-core';
import {
  SdkAuthError,
  SdkGraphqlError,
  SdkNetworkError,
  SdkNotFoundError,
  SdkPermissionError,
} from '@tokenbot-org/sdk';

/** A user-facing error that the CLI catches and converts to a clean exit. */
export class CliUserError extends Error {
  public readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliUserError';
    this.exitCode = exitCode;
  }
}

/** Structured result of mapping an unknown thrown value. */
export interface MappedError {
  message: string;
  exitCode: number;
  /** If true, suggest `tokenbot init`/`login` in the printed message. */
  isAuth?: boolean;
}

/**
 * Pull the server's own error code out of a rejected signed request.
 *
 * `cli-core` throws `CliAuthError` with the raw 401 body appended to the
 * message, and rest-api / graphql-api both answer with a structured
 * `{ statusCode, code, message }`. repos/CLAUDE.md requires the CLI to
 * surface that exact code rather than a blanket "auth failed", so we dig
 * it back out instead of dropping it on the floor.
 *
 * Returns `null` when the body isn't JSON or carries no `code` — callers
 * fall back to the generic guidance in that case.
 */
export function extractServerError(message: string): { code: string; detail?: string } | null {
  const start = message.indexOf('{');
  const end = message.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  let body: unknown;
  try {
    body = JSON.parse(message.slice(start, end + 1));
  } catch {
    return null;
  }
  if (body === null || typeof body !== 'object') return null;

  const { code, message: detail } = body as { code?: unknown; message?: unknown };
  if (typeof code !== 'string' || code.length === 0) return null;

  return typeof detail === 'string' && detail.length > 0 ? { code, detail } : { code };
}

/** `[CODE] detail` when we have a code, else the fallback text. */
function withServerCode(
  server: { code: string; detail?: string } | null,
  fallback: string,
): string {
  if (!server) return fallback;
  return server.detail ? `[${server.code}] ${server.detail}` : `[${server.code}]`;
}

/**
 * Map an arbitrary thrown value to a friendly message + exit code. Never
 * throws — always returns a `MappedError`.
 */
export function mapError(err: unknown): MappedError {
  if (err instanceof CliUserError) {
    return { message: err.message, exitCode: err.exitCode };
  }

  if (err instanceof CliAuthError || err instanceof SdkAuthError) {
    const server = extractServerError(err.message);
    const guidance =
      'Run `tokenbot init` to register a new identity, or `tokenbot login` if your config already exists.';
    return {
      message: `Authentication failed: ${withServerCode(server, err.message)}. ${guidance}`,
      exitCode: 3,
      isAuth: true,
    };
  }

  // GraphQL errors arrive HTTP 200 with an `errors` array; the server's
  // code lives in `extensions.code`. Surface it verbatim.
  if (err instanceof SdkGraphqlError) {
    // `SdkGraphqlError.errors` is declared without `extensions`, but the
    // transport preserves it (see GraphqlErrorEntry in sdk/src/graphql.ts).
    const first = err.errors[0] as
      | { message?: string; extensions?: { code?: unknown } }
      | undefined;
    const code = first?.extensions?.code;
    const detail = first?.message ?? err.message;
    return {
      message: typeof code === 'string' ? `Server error [${code}]: ${detail}` : `Server error: ${detail}`,
      exitCode: 2,
    };
  }

  if (err instanceof SdkPermissionError) {
    return {
      message: `Permission denied: ${err.message}`,
      exitCode: 3,
    };
  }

  if (err instanceof SdkNotFoundError) {
    return { message: err.message, exitCode: 1 };
  }

  if (err instanceof CliNetworkError || err instanceof SdkNetworkError) {
    return {
      message: `Network error: ${err.message}. Check your internet connection and the API URL in your config.`,
      exitCode: 2,
    };
  }

  if (err instanceof CliConfigError) {
    return {
      message: `Config error: ${err.message}. Try \`tokenbot init\` to start fresh.`,
      exitCode: 1,
    };
  }

  if (err instanceof CliKeyStoreError) {
    return {
      message: `Key store error: ${err.message}`,
      exitCode: 1,
    };
  }

  if (err instanceof Error) {
    return { message: err.message, exitCode: 2 };
  }

  return { message: String(err), exitCode: 2 };
}
