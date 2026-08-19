/**
 * Output helpers tailored to the user CLI. Wrap `cli-core`'s
 * `output.{json,table}` with a `--json` flag-aware front door.
 *
 * @module util/output
 */

import { json as coreJson, table as coreTable, type TableColumn } from '@tokenbot-org/cli-core';

/** True when `--json` is active on the root program. */
let jsonMode = false;

/** Switch global output mode (called once by the root command). */
export function setJsonMode(on: boolean): void {
  jsonMode = on;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

/** Print plain text to stdout. Suppressed entirely in JSON mode. */
export function info(message: string): void {
  if (jsonMode) return;
  // eslint-disable-next-line no-console -- CLI output.
  console.log(message);
}

/** Optional presentation tweaks for {@link renderList}. */
export interface RenderListOptions {
  /**
   * Replaces the bare `(empty)` placeholder when there are no rows.
   *
   * Read-only listing commands should always set this: a first-time
   * user running `tokenbot trades` needs to know their account is empty
   * and what to do next, not stare at `(empty)` wondering whether the
   * command failed. Ignored in `--json` mode, which always emits `[]`
   * so scripts can parse unconditionally.
   */
  empty?: string;
  /**
   * Trailing note printed under the table (e.g. a truncation warning).
   * Suppressed in `--json` mode.
   */
  footer?: string;
}

/**
 * Render a list either as a table (default) or as raw JSON when
 * `--json` is active. Header text comes from the column descriptors.
 */
export function renderList<T extends Record<string, unknown>>(
  rows: readonly T[],
  columns: readonly TableColumn<T>[],
  options: RenderListOptions = {},
): void {
  if (jsonMode) {
    coreJson(rows);
    return;
  }
  if (rows.length === 0) {
    info(options.empty ?? '(empty)');
    return;
  }
  // eslint-disable-next-line no-console -- CLI output.
  console.log(coreTable(rows, columns));
  if (options.footer) info(options.footer);
}

/**
 * Render a single object — JSON by default whether or not the user
 * passed `--json`. (Tables don't read well for "show" commands.)
 */
export function renderObject(value: unknown): void {
  coreJson(value);
}

/** Print a structured payload as JSON in JSON mode, plain text otherwise. */
export function renderText(plain: string, jsonPayload: unknown): void {
  if (jsonMode) {
    coreJson(jsonPayload);
    return;
  }
  info(plain);
}
