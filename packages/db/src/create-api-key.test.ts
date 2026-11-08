import { describe, expect, it } from 'vitest';

import { parseOptions } from './create-api-key';
import { DEV_WORKSPACE_ID } from './seed';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';

describe('key:create argument parsing', () => {
  it('defaults to the dev workspace and trims the label', () => {
    expect(parseOptions(['--name', '  CI renderer  '])).toEqual({
      name: 'CI renderer',
      workspaceId: DEV_WORKSPACE_ID,
    });
  });

  it('accepts --name=value and an explicit workspace', () => {
    expect(parseOptions(['--name=CI', '--workspace', WORKSPACE])).toEqual({
      name: 'CI',
      workspaceId: WORKSPACE,
    });
    expect(parseOptions([`--workspace=${WORKSPACE}`, '--name=CI'])).toEqual({
      name: 'CI',
      workspaceId: WORKSPACE,
    });
  });

  it('requires a non-blank name', () => {
    expect(() => parseOptions([])).toThrow(/missing --name/);
    expect(() => parseOptions(['--name'])).toThrow(/missing --name/);
    expect(() => parseOptions(['--name', '   '])).toThrow(/invalid --name/);
  });

  it('rejects a name over the contract limit', () => {
    expect(() => parseOptions(['--name', 'x'.repeat(101)])).toThrow(/invalid --name/);
  });

  it('rejects a workspace that is not a UUID', () => {
    expect(() => parseOptions(['--name', 'CI', '--workspace', 'nope'])).toThrow(
      /invalid --workspace/,
    );
    expect(() => parseOptions(['--name', 'CI', '--workspace'])).toThrow(
      /invalid --workspace/,
    );
  });

  it('does not read the next flag as a value', () => {
    expect(() => parseOptions(['--name', '--workspace', WORKSPACE])).toThrow(
      /missing --name/,
    );
  });
});
