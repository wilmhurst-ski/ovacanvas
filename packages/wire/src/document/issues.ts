/**
 * One thing wrong with a document, located precisely enough that a model can
 * fix exactly that spot without regenerating anything else.
 *
 * @remarks
 * This is ManimWire's `Issue` idea: every problem names the node, prop or
 * timeline step it is about. `step` is a path into the timeline, e.g. `"3"`
 * for the fourth top-level step or `"3.steps.1"` for the second step inside
 * it. `hint` carries a concrete suggestion (a close catalogue name, the
 * accepted value forms) whenever one exists.
 */
export interface Issue {
  readonly code: IssueCode;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly node?: string;
  readonly prop?: string;
  readonly step?: string;
  readonly hint?: string;
}

export type IssueCode =
  // document shape
  | 'bad_document'
  | 'bad_version'
  // nodes
  | 'bad_id'
  | 'duplicate_id'
  | 'unknown_component'
  | 'unknown_prop'
  | 'unsupported_prop'
  | 'bad_value'
  | 'missing_required'
  | 'unknown_parent'
  | 'parent_cycle'
  | 'unknown_ref'
  | 'bad_ref'
  | 'ref_cycle'
  | 'bad_role'
  | 'bad_halo'
  | 'empty_content'
  | 'outside_safe_area'
  | 'plain_text_math'
  | 'bad_tex'
  // timeline
  | 'bad_step'
  | 'unknown_node'
  | 'not_tweenable'
  | 'bad_easing'
  | 'bad_duration'
  | 'too_long'
  | 'long'
  | 'moves_node'
  | 'blank_first_frame'
  | 'ends_blank'
  // touches
  | 'bad_touch'
  // backstops
  | 'typescript'
  | 'json_escape';

export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some(issue => issue.severity === 'error');
}

/** One line per issue, located, for logs and for feeding back to a model. */
export function formatIssues(issues: readonly Issue[]): string {
  return issues
    .map(issue => {
      const where = [
        issue.node !== undefined ? `node "${issue.node}"` : null,
        issue.prop !== undefined ? `prop "${issue.prop}"` : null,
        issue.step !== undefined
          ? issue.step.startsWith('beats.')
            ? `beats[${issue.step.slice(6)}]`
            : `timeline[${issue.step}]`
          : null,
      ]
        .filter(Boolean)
        .join(', ');
      const hint = issue.hint ? ` (${issue.hint})` : '';
      return `${issue.severity.toUpperCase()} ${issue.code}${where ? ` at ${where}` : ''}: ${issue.message}${hint}`;
    })
    .join('\n');
}
