import type { ReviewMode, WorkflowDefinition, WorkflowPhaseDefinition } from './types';

export type CanonicalReviewMode = Extract<ReviewMode, 'content_review' | 'first_review' | 'final_review'>;

/** Legacy route names are accepted at the storage boundary, never separate behavior. */
export function normalizeReviewMode(value: unknown): CanonicalReviewMode {
  if (value === 'content_review') return 'content_review';
  if (value === 'final_review' || value === 'direct_to_ad' || value === 'final_approval') return 'final_review';
  return 'first_review';
}

/** Keep saved graph/ownership/custom work intact; infer only missing legacy kinds. */
export function normalizeReviewPhase(phase: WorkflowPhaseDefinition): WorkflowPhaseDefinition {
  const name = (phase.name || '').trim();
  const phaseKind = phase.phaseKind || (
    phase.reviewStyle === 'final_review' || phase.reviewStyle === 'final_approval' || phase.roleIds?.includes('art_director') || /^final rev\.?$/i.test(name)
      ? 'final_review'
      : phase.reviewStyle === 'content_review' || /^content rev\.?$/i.test(name) || /content.*review/i.test(name)
        ? 'content_review'
        : phase.reviewStyle === 'first_review' || phase.reviewStyle === 'full_review'
          || phase.roleIds?.includes('reviewer') || /^first rev\.?$/i.test(name) || /review|approval/i.test(name)
          ? 'first_review'
          : 'work'
  );
  return {
    ...phase,
    phaseKind,
    // Work nodes historically carried quick_look; the explicit kind, not this
    // compatibility style, determines whether an upload or review is required.
    reviewStyle: phaseKind === 'content_review' ? 'content_review'
      : phaseKind === 'final_review' ? 'final_review' : 'first_review',
  };
}

export function isContentReviewPhase(phase: WorkflowPhaseDefinition | null | undefined): boolean {
  return Boolean(phase && (phase.nodeType || 'step') === 'step' && normalizeReviewPhase(phase).phaseKind === 'content_review');
}

/** Apply a new form choice once. Saved booleans never reinterpret a snapshot on reload. */
export function applyContentReviewChoice(
  workflow: WorkflowDefinition | null | undefined,
  skippedPhaseIds: string[] | undefined,
  choice?: boolean | null,
): string[] {
  const skipped = new Set(skippedPhaseIds || []);
  if (typeof choice === 'boolean') {
    for (const phase of workflow?.phases || []) {
      if (!isContentReviewPhase(phase) || phase.roleIds?.includes('art_director')) continue;
      if (choice) skipped.delete(phase.id);
      else skipped.add(phase.id);
    }
  }
  return [...skipped];
}
