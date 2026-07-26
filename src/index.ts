/**
 * `tokenbot` programmatic entry point. Re-exports the program builder
 * and the `main(...)` runner so other code (tests, bot CLIs that want
 * to embed sub-commands) can drive the same parser.
 *
 * @module index
 */

export { buildProgram, main } from './cli.js';
export { mapError, CliUserError } from './errors.js';
