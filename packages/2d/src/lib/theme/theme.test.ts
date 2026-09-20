import {afterEach, describe, expect, it} from 'vitest';
import {defaultTheme, resetTheme, setTheme, theme} from './theme';

describe('theme', () => {
  afterEach(() => resetTheme());

  it('ships the documented default palette', () => {
    expect(theme()).toEqual(defaultTheme);
    expect(theme().ink).toBe('#151922');
    expect(theme().paper).toBe('#F7F4EC');
  });

  it('setTheme overrides only the given tokens, leaving the rest at default', () => {
    setTheme({ink: '#000000'});
    expect(theme().ink).toBe('#000000');
    expect(theme().paper).toBe(defaultTheme.paper);
  });

  it('resetTheme discards overrides and restores the documented default', () => {
    setTheme({ink: '#000000', paper: '#ffffff'});
    resetTheme();
    expect(theme()).toEqual(defaultTheme);
  });

  it('setTheme is cumulative across calls, not a full replacement each time', () => {
    setTheme({ink: '#000000'});
    setTheme({paper: '#ffffff'});
    expect(theme().ink).toBe('#000000');
    expect(theme().paper).toBe('#ffffff');
  });
});
