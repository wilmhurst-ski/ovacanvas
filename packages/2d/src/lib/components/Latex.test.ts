import {afterEach, describe, expect, it} from 'vitest';
import {resetTheme, setTheme, theme} from '../theme/theme';
import {Latex} from './Latex';
import {mockScene2D} from './__tests__/mockScene2D';

describe('Latex', () => {
  mockScene2D();
  afterEach(() => resetTheme());

  it("defaults its fill to the theme's ink color when none is given", () => {
    const node = new Latex({tex: 'x^2'});
    expect(node.fill()?.hex()).toBe(theme().ink.toLowerCase());
  });

  it('still lets an explicit fill win over the theme default', () => {
    const node = new Latex({tex: 'x^2', fill: '#F05A3C'});
    expect(node.fill()?.hex()).toBe('#f05a3c');
  });

  it('follows an active theme override, not just the shipped default', () => {
    setTheme({ink: '#000000'});
    const node = new Latex({tex: 'x^2'});
    expect(node.fill()?.hex()).toBe('#000000');
  });
});
