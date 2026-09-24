import type {AuditFinding, AuditableNode} from './types';
import {DEFAULT_VISIBLE_OPACITY_THRESHOLD} from './types';

// Raw LaTeX command syntax that leaked into plain text unrendered - zero
// ambiguity, nobody writes a literal backslash-command or brace-subscript
// as intentional prose.
const LATEX_COMMAND_LEAK = /\\[a-zA-Z]+|[_^]\{/;
// Natural language essentially never contains an inequality chain.
const INEQUALITY_CHAIN = /[a-zA-Z0-9]\s*(<=|>=|!=)\s*[a-zA-Z0-9]/;
// Caret-exponent notation ("x^2", "10^-3") - not an English construction.
const CARET_EXPONENT = /[a-zA-Z0-9]\^[a-zA-Z0-9]/;
// A short algebraic left-hand side, "=", then an algebraic right-hand side
// ("y = 1/x", "x = 4"). Bounded to a short variable-like token on the left
// so ordinary prose using "=" in a non-algebraic sense mostly falls outside it.
const SHORT_EQUATION =
  /\b[a-zA-Z]\w{0,3}\s*=\s*[a-zA-Z0-9][a-zA-Z0-9+\-*/^.]*\b/;

function looksLikeMathNotation(text: string): string | null {
  if (LATEX_COMMAND_LEAK.test(text)) {
    return 'looks like un-rendered LaTeX command syntax';
  }
  if (INEQUALITY_CHAIN.test(text)) return 'looks like an inequality chain';
  if (CARET_EXPONENT.test(text)) return 'looks like caret-exponent notation';
  if (SHORT_EQUATION.test(text)) return 'looks like an algebraic equation';
  return null;
}

/**
 * Refuse plain text that reads as mathematical notation - it belongs in a
 * `Latex` node, not a `Txt`.
 *
 * @remarks
 * The concrete trigger: an equation-bearing heading was authored as plain
 * `Txt` (`"y = 1/x rotated around the x-axis, 1 <= x <= 4"`) instead of a
 * real `Latex` node, and nothing caught it - not the compile gate (it's
 * valid TypeScript), not any existing geometry check (it's not a collision
 * or a coverage gap). If the author building this exact pipeline can make
 * that mistake without noticing, any other author - human or an LLM
 * working from the same skill docs - can make it too. Prose instructions
 * ("always use Latex for equations") already failed as a strategy this
 * project relied on before; this is the same move every other check in
 * this module already made: read the actual rendered content and refuse,
 * rather than trust the author remembered the rule.
 *
 * Walks the full visible tree from `root`, not just registered items - the
 * same closed-world reach as {@link collectUnregisteredVisibleNodes}, so a
 * plain-text equation cannot escape detection just because it also forgot
 * to be registered.
 */
export function collectPlainTextMathNotation(
  root: AuditableNode,
  opacityThreshold = DEFAULT_VISIBLE_OPACITY_THRESHOLD,
): AuditFinding[] {
  const findings: AuditFinding[] = [];

  const visit = (node: AuditableNode): void => {
    if (node.absoluteOpacity() <= opacityThreshold) return;

    if (typeof node.text === 'function') {
      const content = node.text();
      if (typeof content === 'string') {
        const reason = looksLikeMathNotation(content);
        if (reason) {
          findings.push({
            ruleId: 'plain-text-math-notation',
            severity: 'blocking',
            entities: [node.key],
            message: `${node.key} ${reason} but is plain text, not Latex: "${content}"`,
          });
        }
      }
    }

    for (const child of node.children()) visit(child);
  };

  for (const child of root.children()) visit(child);
  return findings;
}
