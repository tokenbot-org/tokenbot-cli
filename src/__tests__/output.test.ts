import { afterEach, describe, expect, it } from 'vitest';
import {
  info,
  isJsonMode,
  renderList,
  renderObject,
  renderText,
  setJsonMode,
} from '../util/output.js';
import { captureStdout } from './helpers.js';

afterEach(() => setJsonMode(false));

describe('output mode', () => {
  it('starts in table mode (json off)', () => {
    setJsonMode(false);
    expect(isJsonMode()).toBe(false);
  });

  it('setJsonMode flips the flag', () => {
    setJsonMode(true);
    expect(isJsonMode()).toBe(true);
    setJsonMode(false);
    expect(isJsonMode()).toBe(false);
  });
});

describe('info()', () => {
  it('writes to stdout in table mode', async () => {
    setJsonMode(false);
    const out = await captureStdout(async () => info('hello'));
    expect(out).toBe('hello');
  });

  it('is silent in json mode', async () => {
    setJsonMode(true);
    const out = await captureStdout(async () => info('hello'));
    expect(out).toBe('');
  });
});

describe('renderList()', () => {
  const rows = [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
  ];
  const columns = [
    { key: 'id' as const, header: 'id' },
    { key: 'name' as const, header: 'name' },
  ];

  it('renders a table by default', async () => {
    setJsonMode(false);
    const out = await captureStdout(async () => renderList(rows, columns));
    expect(out).toContain('id');
    expect(out).toContain('Alice');
    expect(out).toContain('Bob');
  });

  it('renders JSON in json mode', async () => {
    setJsonMode(true);
    const out = await captureStdout(async () => renderList(rows, columns));
    const parsed = JSON.parse(out) as typeof rows;
    expect(parsed).toEqual(rows);
  });

  it('prints "(empty)" for an empty list in table mode', async () => {
    setJsonMode(false);
    const out = await captureStdout(async () => renderList([], columns));
    expect(out).toBe('(empty)');
  });

  it('emits an empty array in json mode for an empty list', async () => {
    setJsonMode(true);
    const out = await captureStdout(async () => renderList([], columns));
    expect(JSON.parse(out)).toEqual([]);
  });
});

describe('renderObject()', () => {
  it('always emits JSON', async () => {
    setJsonMode(false);
    const out = await captureStdout(async () => renderObject({ id: 'x', n: 1 }));
    expect(JSON.parse(out)).toEqual({ id: 'x', n: 1 });
  });
});

describe('renderText()', () => {
  it('prints plain text in table mode', async () => {
    setJsonMode(false);
    const out = await captureStdout(async () => renderText('hi', { hi: true }));
    expect(out).toBe('hi');
  });

  it('prints JSON payload in json mode', async () => {
    setJsonMode(true);
    const out = await captureStdout(async () => renderText('hi', { hi: true }));
    expect(JSON.parse(out)).toEqual({ hi: true });
  });
});
