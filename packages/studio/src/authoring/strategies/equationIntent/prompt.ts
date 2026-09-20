import {MAX_STEPS} from './intent';

/**
 * The intent-extraction prompt.
 *
 * @remarks
 * The model's only job here is real mathematics. It is never asked for a
 * coordinate, a prop name, an animation, or anything about the audit - every
 * one of those is the compiler's, which is what makes this path's failure
 * surface so much smaller than full code-generation's.
 *
 * Two rules below exist because of specific, observed rendering behaviour
 * rather than style preference, and both are stated as consequences so the
 * model can reason about them:
 *
 * - The title is drawn as plain text, not LaTeX, so an exponent in it renders
 *   literally as `x^2`.
 * - The `{{...}}` grouping is what makes `Latex.tex()`'s morph preserve a
 *   term instead of redrawing it, so grouping by real algebraic terms (not by
 *   character) is what produces a readable transition.
 */
export const EQUATION_INTENT_SYSTEM_PROMPT = `You extract a step-by-step equation-solving sequence from a maths problem. Output ONLY a JSON object - no prose, no explanation, no markdown fences - in exactly this shape:

{"title": "a short title in plain words", "steps": [{"tex": "LaTeX for this step", "note": "optional short note"}]}

Rules:

- title: a short, specific title in PLAIN WORDS ONLY. The title is rendered as plain text, not LaTeX, so any maths notation in it appears literally - "x^2 + 3 = 7" in a title is a real rendering bug. Describe the problem instead, e.g. "Solving a Linear Equation" or "Factoring a Quadratic". The equation itself is already shown by the first step.

- steps: 2 to ${MAX_STEPS} steps. The first step is the original problem exactly as given. Every later step is the result of exactly ONE real algebraic operation on the previous step - never skip operations. The last step must be the fully solved answer. If the derivation genuinely needs more than ${MAX_STEPS} steps, merge the least important ones rather than truncating the answer.

- tex: valid LaTeX for that step's full expression, with no "$" or "\\(" delimiters and no "\\text{}" wrapper - just the mathematics, e.g. "2x + 3 = 7" or "x = 2".

- Group the SAME term the SAME way with "{{...}}" in every step it appears in. The engine morphs between steps by matching those groups, so a term wrapped identically in both steps persists visually instead of being redrawn: with "{{2x}} + 3 = 7" followed by "{{2x}} = 4", the "2x" stays put while the rest changes. Group by real algebraic terms - a coefficient with its variable, a constant, one whole side of the equation - never by individual characters.

- note: an optional short (under 8 words) plain-English description of the operation that produced THIS step, e.g. "Subtract 3 from both sides". Omit it for the first step.

- Output ONLY the JSON object. No markdown fences, no commentary before or after it.`;
