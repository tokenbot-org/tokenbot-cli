import { describe, expect, it } from 'vitest';
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
import { CliUserError, mapError } from '../errors.js';

describe('mapError', () => {
  it('maps CliUserError to its own exit code', () => {
    const r = mapError(new CliUserError('bad input', 1));
    expect(r.exitCode).toBe(1);
    expect(r.message).toBe('bad input');
  });

  it('maps CliAuthError to exit 3 with an init/login hint', () => {
    const r = mapError(new CliAuthError('boom'));
    expect(r.exitCode).toBe(3);
    expect(r.message).toMatch(/tokenbot init/);
  });

  it('maps SdkAuthError to exit 3', () => {
    const r = mapError(new SdkAuthError('nope'));
    expect(r.exitCode).toBe(3);
  });

  // repos/CLAUDE.md: signed-request failures must surface the exact
  // server error code, never a bare "auth failed".
  it('surfaces the server error code from a rejected signed request', () => {
    const body = JSON.stringify({
      statusCode: 401,
      code: 'CLI_SIG_INVALID',
      message: 'CLI signature rejected: timestamp outside allowed skew',
    });
    const r = mapError(new CliAuthError(`signed request rejected (401): ${body}`));

    expect(r.exitCode).toBe(3);
    expect(r.message).toContain('CLI_SIG_INVALID');
    expect(r.message).toContain('timestamp outside allowed skew');
    expect(r.message).toMatch(/tokenbot init/);
  });

  it('distinguishes an unknown public key from a bad signature', () => {
    const body = JSON.stringify({ code: 'CLI_IDENTITY_UNKNOWN', message: 'Public key is not registered' });
    const r = mapError(new CliAuthError(`signed request rejected (401): ${body}`));
    expect(r.message).toContain('CLI_IDENTITY_UNKNOWN');
  });

  it('falls back to the raw message when the 401 body is not JSON', () => {
    const r = mapError(new CliAuthError('signed request rejected (401): <empty body>'));
    expect(r.exitCode).toBe(3);
    expect(r.message).toContain('<empty body>');
  });

  it('surfaces extensions.code from a GraphQL error', () => {
    const r = mapError(
      new SdkGraphqlError('graphql operation failed: Not authenticated', [
        { message: 'Not authenticated', extensions: { code: 'UNAUTHENTICATED' } },
      ] as never),
    );

    expect(r.exitCode).toBe(2);
    expect(r.message).toContain('UNAUTHENTICATED');
    expect(r.message).toContain('Not authenticated');
  });

  it('still reports a GraphQL error that carries no code', () => {
    const r = mapError(new SdkGraphqlError('graphql operation failed: boom', [{ message: 'boom' }]));
    expect(r.exitCode).toBe(2);
    expect(r.message).toContain('boom');
  });

  it('maps SdkPermissionError to exit 3 with the original message', () => {
    const r = mapError(new SdkPermissionError('no admin'));
    expect(r.exitCode).toBe(3);
    expect(r.message).toContain('no admin');
  });

  it('maps SdkNotFoundError to exit 1', () => {
    const r = mapError(new SdkNotFoundError('strategy not found'));
    expect(r.exitCode).toBe(1);
  });

  it('maps CliNetworkError to exit 2 with a network hint', () => {
    const r = mapError(new CliNetworkError('dns fail'));
    expect(r.exitCode).toBe(2);
    expect(r.message).toMatch(/Network/);
  });

  it('maps SdkNetworkError to exit 2', () => {
    const r = mapError(new SdkNetworkError('tcp closed'));
    expect(r.exitCode).toBe(2);
  });

  it('maps CliConfigError to exit 1 with an init hint', () => {
    const r = mapError(new CliConfigError('bad config'));
    expect(r.exitCode).toBe(1);
    expect(r.message).toMatch(/tokenbot init/);
  });

  it('maps CliKeyStoreError to exit 1', () => {
    const r = mapError(new CliKeyStoreError('label missing'));
    expect(r.exitCode).toBe(1);
  });

  it('maps an unknown Error to exit 2', () => {
    const r = mapError(new Error('random'));
    expect(r.exitCode).toBe(2);
    expect(r.message).toBe('random');
  });

  it('maps a non-Error to a string', () => {
    const r = mapError('weird');
    expect(r.exitCode).toBe(2);
    expect(r.message).toBe('weird');
  });
});

describe('CliUserError', () => {
  it('defaults to exit code 1', () => {
    expect(new CliUserError('x').exitCode).toBe(1);
  });

  it('respects an explicit exit code', () => {
    expect(new CliUserError('x', 3).exitCode).toBe(3);
  });
});
