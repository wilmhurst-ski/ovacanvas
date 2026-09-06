import {vi} from 'vitest';

// jsdom ships no DOMMatrix, and Matrix2D narrows on `instanceof DOMMatrix`
// before it can read a plain tuple. The same stub is what the core suite
// uses; nothing under test constructs one.
vi.stubGlobal('DOMMatrix', class {});
