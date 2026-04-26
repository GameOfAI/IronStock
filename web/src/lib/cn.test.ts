import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('merges plain classes', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('drops falsy entries', () => {
    expect(cn('a', false && 'b', null, undefined, 'c')).toBe('a c');
  });

  it('resolves tailwind conflicts: later wins', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm text-muted-foreground', 'text-lg')).toBe(
      'text-muted-foreground text-lg',
    );
  });

  it('handles nested arrays / objects', () => {
    expect(cn(['a', { b: true, c: false }, 'd'])).toBe('a b d');
  });
});
