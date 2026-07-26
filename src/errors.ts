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
 * Map an arbitrary thrown value to a friendly message + exit code. Never
 * throws — always returns a `MappedError`.
 */
export function mapError(err: unknown): MappedError {
  if (err instanceof CliUserError) {
    return { message: err.message, exitCode: err.exitCode };
  }

  if (err instanceof CliAuthError || err instanceof SdkAuthError) {
    return {
      message:
        'Authentication failed. Run `tokenbot init` to register a new identity, or `tokenbot login` if your config already exists.',
      exitCode: 3,
      isAuth: true,
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
