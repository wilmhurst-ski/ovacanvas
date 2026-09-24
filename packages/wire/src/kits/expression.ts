/**
 * A small, safe maths expression language for the plot kit: numbers, `x`,
 * `+ - * / ^`, parentheses, implicit multiplication (`2x`, `3(x+1)`,
 * `2sin(x)`), constants `pi` and `e`, and the usual functions.
 *
 * @remarks
 * Parsed once into a tree and evaluated as many times as a curve is sampled.
 * Nothing is ever passed to `eval`/`Function`, so a model-written expression
 * cannot run code; an unparseable one is a located validation issue.
 */

type Node =
  | {kind: 'num'; value: number}
  | {kind: 'var'; name: string}
  | {kind: 'neg'; arg: Node}
  | {kind: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: Node; right: Node}
  | {kind: 'call'; fn: string; arg: Node};

const FUNCTIONS: Readonly<Record<string, (x: number) => number>> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  sqrt: Math.sqrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
};

const CONSTANTS: Readonly<Record<string, number>> = {pi: Math.PI, e: Math.E};

export class ExpressionError extends Error {}

export interface Expression {
  readonly source: string;
  /** The value at x (the first variable). */
  evaluate(x: number): number;
  /** The value with every variable given by name. */
  evaluateWith(values: Readonly<Record<string, number>>): number;
}

/**
 * Parse an expression in the given variables - `x` for a curve, `x` and
 * `y` for a surface, `t` for a parametric path.
 */
export function parseExpression(
  source: string,
  variables: readonly string[] = ['x'],
): Expression {
  const text = source
    .replace(/\s+/g, '')
    .replace(/\*\*/g, '^')
    .replace(/π/g, 'pi');
  let i = 0;
  const peek = () => text[i];
  const fail = (message: string): never => {
    throw new ExpressionError(`${message} at position ${i + 1} of "${source}"`);
  };

  // expr := term (('+'|'-') term)*
  const expr = (): Node => {
    let left = term();
    while (peek() === '+' || peek() === '-') {
      const op = text[i++] as '+' | '-';
      left = {kind: 'bin', op, left, right: term()};
    }
    return left;
  };
  // term := unary (('*'|'/'|implicit) unary)*
  const term = (): Node => {
    let left = unary();
    for (;;) {
      if (peek() === '*' || peek() === '/') {
        const op = text[i++] as '*' | '/';
        left = {kind: 'bin', op, left, right: unary()};
      } else if (peek() !== undefined && /[0-9.a-zA-Z(]/.test(peek()!)) {
        left = {kind: 'bin', op: '*', left, right: unary()};
      } else return left;
    }
  };
  // unary := '-' unary | power
  const unary = (): Node => {
    if (peek() === '-') {
      i++;
      return {kind: 'neg', arg: unary()};
    }
    if (peek() === '+') {
      i++;
      return unary();
    }
    return power();
  };
  // power := atom ('^' unary)?   (right-associative)
  const power = (): Node => {
    const base = atom();
    if (peek() === '^') {
      i++;
      return {kind: 'bin', op: '^', left: base, right: unary()};
    }
    return base;
  };
  const atom = (): Node => {
    const c = peek();
    if (c === undefined) return fail('expression ends too early');
    if (c === '(') {
      i++;
      const inner = expr();
      if (peek() !== ')') fail('missing ")"');
      i++;
      return inner;
    }
    if (/[0-9.]/.test(c)) {
      const m = text.slice(i).match(/^(\d+\.?\d*|\.\d+)/);
      if (!m) return fail('bad number');
      i += m[0].length;
      return {kind: 'num', value: Number(m[0])};
    }
    if (/[a-zA-Z]/.test(c)) {
      // Longest known name first, so "sinx" reads as sin(x) and "pix" as pi*x.
      const rest = text.slice(i);
      const name = [
        ...Object.keys(FUNCTIONS),
        ...Object.keys(CONSTANTS),
        ...variables,
      ]
        .sort((a, b) => b.length - a.length)
        .find(n => rest.startsWith(n));
      if (!name) {
        return fail(
          `unknown name "${rest.match(/^[a-zA-Z]+/)![0]}" (use ${variables.join(', ')}, pi, e, or ${Object.keys(FUNCTIONS).join(', ')})`,
        );
      }
      i += name.length;
      if (variables.includes(name)) return {kind: 'var', name};
      if (name in CONSTANTS) return {kind: 'num', value: CONSTANTS[name]};
      // A function takes a parenthesised argument, or a bare power-level one ("sin x").
      return {kind: 'call', fn: name, arg: peek() === '(' ? atom() : power()};
    }
    return fail(`unexpected "${c}"`);
  };

  const tree = expr();
  if (i < text.length) fail(`unexpected "${text[i]}"`);

  const run = (
    node: Node,
    values: Readonly<Record<string, number>>,
  ): number => {
    switch (node.kind) {
      case 'num':
        return node.value;
      case 'var':
        return values[node.name] ?? NaN;
      case 'neg':
        return -run(node.arg, values);
      case 'call':
        return FUNCTIONS[node.fn](run(node.arg, values));
      case 'bin': {
        const a = run(node.left, values);
        const b = run(node.right, values);
        switch (node.op) {
          case '+':
            return a + b;
          case '-':
            return a - b;
          case '*':
            return a * b;
          case '/':
            return a / b;
          case '^':
            return Math.pow(a, b);
        }
      }
    }
  };
  return {
    source,
    evaluate: x => run(tree, {[variables[0]]: x}),
    evaluateWith: values => run(tree, values),
  };
}

/** A central-difference derivative, for tangent lines. */
export function derivative(f: Expression, x: number): number {
  const h = 1e-4 * Math.max(1, Math.abs(x));
  return (f.evaluate(x + h) - f.evaluate(x - h)) / (2 * h);
}
