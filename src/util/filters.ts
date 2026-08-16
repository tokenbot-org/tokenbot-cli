/**
 * Shared option parsing for read-only listing commands.
 *
 * `trades` is the first of three observability commands (`positions` and
 * `portfolio` follow) that take the same shape of filter flags. These
 * helpers exist so all three validate identically and, more importantly,
 * fail identically: every bad value produces a `CliUserError` (exit 1)
 * that names the flag, echoes what the user typed, and lists what is
 * accepted — rather than a stack trace or a silently-ignored flag.
 *
 * @module util/filters
 */

import { CliUserError } from '../errors.js';

/**
 * Validate a flag value against a fixed set, case-insensitively, and
 * return it in the casing the server expects (upper-case, matching the
 * GraphQL enum members).
 *
 * @param flag  User-facing flag name, used in the error message.
 * @param value Raw value as typed; `undefined` passes through.
 * @param allowed Accepted enum members, upper-case.
 */
export function parseEnumOption<T extends string>(
  flag: string,
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined) return undefined;

  const normalized = value.trim().toUpperCase();
  const match = allowed.find((a) => a === normalized);
  if (!match) {
    throw new CliUserError(
      `Invalid value for ${flag}: "${value}". Expected one of: ${allowed
        .map((a) => a.toLowerCase())
        .join(', ')}.`,
    );
  }
  return match;
}

/**
 * Parse a positive-integer flag (`--limit`, `--page`).
 *
 * Rejects zero, negatives, fractions, and non-numeric input rather than
 * coercing them — `--limit 0` silently returning everything, or
 * `--limit abc` being dropped, are both worse than an explicit error.
 */
export function parsePositiveInt(
  flag: string,
  value: string | undefined,
  opts: { max?: number } = {},
): number | undefined {
  if (value === undefined) return undefined;

  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new CliUserError(
      `Invalid value for ${flag}: "${value}". Expected a whole number of 1 or more.`,
    );
  }
  if (opts.max !== undefined && n > opts.max) {
    throw new CliUserError(
      `Invalid value for ${flag}: "${value}". The maximum is ${opts.max}.`,
    );
  }
  return n;
}

/**
 * Parse a date flag (`--since`, `--until`). Accepts anything `Date` can
 * parse — `2026-07-01`, `2026-07-01T12:00:00Z` — and rejects the rest
 * instead of forwarding an `Invalid Date` to the API.
 */
export function parseDateOption(flag: string, value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new CliUserError(
      `Invalid value for ${flag}: "${value}". Expected a date like 2026-07-01 or 2026-07-01T12:00:00Z.`,
    );
  }
  return parsed;
}
