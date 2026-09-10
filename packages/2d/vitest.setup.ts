import {vi} from 'vitest';

// jsdom ships no DOMMatrix, and Matrix2D narrows on `instanceof DOMMatrix`
// before it can read a plain tuple. The same stub is what the core suite
// uses; nothing under test constructs one.
vi.stubGlobal('DOMMatrix', class {});

if (typeof Path2D === 'undefined') {
  vi.stubGlobal(
    'Path2D',
    class Path2D {
      public addPath() {}
      public closePath() {}
      public moveTo() {}
      public lineTo() {}
      public bezierCurveTo() {}
      public quadraticCurveTo() {}
      public arc() {}
      public arcTo() {}
      public ellipse() {}
      public rect() {}
    },
  );
}
