import { describe, expect, it } from 'vitest';
import { textTex } from '../../packages/animlib/src/render-geometry.ts';
import { layoutLatex } from '../../packages/animlib/src/latex.ts';

describe('German animation labels', () => {
  it('lays out actual umlaut glyphs instead of literal text-accent commands', () => {
    const heading=layoutLatex(textTex('B nähert sich A'));
    const broken=layoutLatex(String.raw`\text{B n\"{a}hert sich A}`);
    expect(heading.paths.length).toBeGreaterThan(10);
    // Literal backslash/quote/braces make the broken label visibly wider.
    expect(heading.width).toBeLessThan(broken.width * 0.85);
    expect(textTex('B rückt näher')).not.toContain(String.raw`\"`);
    for (const letter of ['ä','ö','ü','Ä','Ö','Ü']) {
      const glyph=layoutLatex(textTex(letter));
      expect(glyph.paths.length).toBeGreaterThanOrEqual(2);
      expect(glyph.width).toBeLessThan(1.5);
    }
  });
  it('treats decomposed umlauts the same and retains literal TeX punctuation', () => {
    expect(textTex('na\u0308her')).toBe(textTex('näher'));
    expect(() => layoutLatex(textTex('A & B: 50%'))).not.toThrow();
  });
  it('renders scientific notation used in novel lesson labels', () => {
    for(const text of ['CO₂ und H₂O','Fläche = πr²','ΔE ≥ 0','20 °C','α × β ≠ Ω']) {
      const glyphs=layoutLatex(textTex(text));
      expect(glyphs.paths.length,text).toBeGreaterThan(0);
      expect(glyphs.width,text).toBeLessThan(14);
    }
  });
});
