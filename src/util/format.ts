/**
 * Cell formatters for table output.
 *
 * Shared by the read-only observability commands (`trades`, and the
 * `positions` / `portfolio` commands that follow it) so a price reads
 * the same everywhere. All of these return `''` for missing values —
 * `cli-table3` renders that as a blank cell, which scans far better in
 * a dense table than `null` or `undefined`.
 *
 * Everything here is deliberately locale- and timezone-independent so
 * output is stable across machines and in CI.
 *
 * @module util/format
 */

/**
 * Format a number for a table cell, trimming trailing zeros.
 *
 * Crypto quantities need more precision than prices, so `maxDecimals`
 * is caller-controlled. Non-finite values render blank rather than
 * `NaN` / `Infinity`.
 */
export function formatNumber(value: number | undefined, maxDecimals = 8): string {
  if (value === undefined || !Number.isFinite(value)) return '';
  // toFixed then strip trailing zeros (and a bare trailing '.').
  return value.toFixed(maxDecimals).replace(/\.?0+$/, '');
}

/**
 * Format a P&L figure with an explicit sign, so a loss is unmistakable
 * at a glance in a column of numbers.
 */
export function formatSigned(value: number | undefined, maxDecimals = 2): string {
  if (value === undefined || !Number.isFinite(value)) return '';
  const body = formatNumber(Math.abs(value), maxDecimals) || '0';
  if (value > 0) return `+${body}`;
  if (value < 0) return `-${body}`;
  return body;
}

/**
 * Format a timestamp as `YYYY-MM-DD HH:MM` in UTC.
 *
 * UTC rather than local time: trading timestamps are compared against
 * exchange records and server logs, which are UTC, and a table that
 * silently shifts by the reader's timezone invites misreading.
 */
export function formatDateTime(value: Date | undefined): string {
  if (!value || Number.isNaN(value.getTime())) return '';
  return value.toISOString().replace('T', ' ').slice(0, 16);
}

/**
 * Shorten a long opaque id for display, keeping the leading characters
 * that make it recognisable. Full ids remain available via `--json`.
 */
export function formatId(value: string | undefined, keep = 8): string {
  if (!value) return '';
  return value.length <= keep ? value : `${value.slice(0, keep)}…`;
}
