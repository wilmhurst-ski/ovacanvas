/**
 * Console errors a page is allowed to produce.
 *
 * @remarks
 * This exists because of a real defect that hid for a long time behind a green
 * suite. A `@computed` that throws does not propagate: `ComputedContext`
 * catches it and logs it, and `useLogger()` falls back to `console` when no
 * scene is on the stack - which is exactly the case that caused the throw in
 * the first place. So the failure reached `console.error` and nothing else:
 * not `lastError`, not a page error, not any assertion. The node simply
 * rendered as nothing, and the symptom appeared in a completely different
 * place from the cause.
 *
 * Asserting on console errors is therefore not tidiness - it is the only thing
 * watching the one channel that class of bug actually reports to. Without it,
 * "the scene renders nothing" and "the scene renders an empty frame" are
 * indistinguishable from the outside.
 *
 * The list below is deliberately short and each entry is a specific,
 * understood piece of environment noise. Anything added here weakens the
 * guard, so it should be added only with a reason, never to make a red test
 * green.
 */
const BENIGN_PATTERNS: readonly RegExp[] = [
  // The dev server has no favicon; the browser asks anyway.
  /Failed to load resource.*favicon/i,
  // Vite's HMR client reconnects noisily when a dev server restarts.
  /\[vite\] connect|WebSocket closed without opened/i,
];

export function unexpectedConsoleErrors(errors: readonly string[]): string[] {
  return errors.filter(
    error => !BENIGN_PATTERNS.some(pattern => pattern.test(error)),
  );
}
