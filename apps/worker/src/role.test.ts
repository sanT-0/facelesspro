import { describe, expect, it } from 'vitest';

import { serviceRole } from './role';

describe('serviceRole', () => {
  it('treats an unset or unknown value as the single-process role', () => {
    expect(serviceRole(undefined)).toBe('all');
    expect(serviceRole('')).toBe('all');
    expect(serviceRole('   ')).toBe('all');
    expect(serviceRole('something-else')).toBe('all');
    expect(serviceRole('false')).toBe('all');
  });

  it('reads the dedicated render spellings', () => {
    expect(serviceRole('render')).toBe('render');
    expect(serviceRole('RENDER')).toBe('render');
    expect(serviceRole('true')).toBe('render');
    expect(serviceRole('1')).toBe('render');
    expect(serviceRole(' true ')).toBe('render');
  });

  it('reads the pipeline worker spelling', () => {
    expect(serviceRole('worker')).toBe('worker');
    expect(serviceRole('WORKER')).toBe('worker');
  });
});
