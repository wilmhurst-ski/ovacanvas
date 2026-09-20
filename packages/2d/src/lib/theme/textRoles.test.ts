import {afterEach, describe, expect, it} from 'vitest';
import {mockScene2D} from '../components/__tests__/mockScene2D';
import {
  bodyText,
  denseLabel,
  diagramLabel,
  heading,
  subtitle,
  title,
} from './textRoles';
import {resetTheme, setTheme, theme, typeScale} from './theme';

describe('textRoles', () => {
  mockScene2D();
  afterEach(() => resetTheme());

  it("title defaults to the type scale's title preset and the theme ink color", () => {
    const node = title({text: 'The Pythagorean Theorem'});
    expect(node.fontSize()).toBe(typeScale.title.fontSize);
    expect(node.fontWeight()).toBe(typeScale.title.fontWeight);
    expect(node.fill()?.hex()).toBe(theme().ink.toLowerCase());
  });

  it('subtitle and denseLabel default to secondary ink, not primary ink', () => {
    expect(subtitle({text: 'x'}).fill()?.hex()).toBe(
      theme().secondaryInk.toLowerCase(),
    );
    expect(denseLabel({text: 'x'}).fill()?.hex()).toBe(
      theme().secondaryInk.toLowerCase(),
    );
  });

  it('heading, bodyText, and diagramLabel default to primary ink', () => {
    expect(heading({text: 'x'}).fill()?.hex()).toBe(theme().ink.toLowerCase());
    expect(bodyText({text: 'x'}).fill()?.hex()).toBe(theme().ink.toLowerCase());
    expect(diagramLabel({text: 'x'}).fill()?.hex()).toBe(
      theme().ink.toLowerCase(),
    );
  });

  it('every role preset is a plain default: an explicit prop still wins', () => {
    const node = title({text: 'x', fontSize: 90, fill: '#ff0000'});
    expect(node.fontSize()).toBe(90);
    expect(node.fill()?.hex()).toBe('#ff0000');
  });

  it('a role picks up an active theme override, not just the shipped default', () => {
    setTheme({ink: '#000000'});
    expect(heading({text: 'x'}).fill()?.hex()).toBe('#000000');
  });
});
