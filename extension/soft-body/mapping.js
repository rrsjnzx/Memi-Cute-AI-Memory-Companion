// V3 governs semantic decisions; V2.1 remains the complete 224-expression catalog.
// Sharing a face does not merge distinct operation evidence or status text.
import { V3_SEMANTICS, getExpression } from './catalog.js';

export const SEMANTICS = V3_SEMANTICS;
export const V3_TO_V2 = Object.freeze({
  idle: 'idle',
  attentive: 'notice',
  expectant: 'notice',
  rest: 'sleepy',
  loading: 'focused',
  thinking: 'focused',
  validating: 'focused',
  awaiting_result: 'waiting',
  save_success: 'success',
  package_success: 'great_success',
  insert_success: 'success',
  send_success: 'success',
  copy_success: 'success',
  conflict_resolved: 'retry_success',
  task_success: 'great_success',
  missing_field: 'missing_input',
  target_unselected: 'target_ambiguous',
  page_not_ready: 'waiting',
  permission_required: 'permission_required',
  conflict_detected: 'conflict',
  unverified: 'unknown_result',
  partial_success: 'partial_success',
  network_error: 'connection_lost',
  write_error: 'unknown_result',
  insert_error: 'failure',
  parse_error: 'failure',
  permission_error: 'permission_required',
  timeout: 'unknown_result',
  canceled: 'cancelled',
});

export const INTERACTION_TO_V2 = Object.freeze({
  none: 'idle',
  poke: 'tap',
  press_hold: 'press_hold',
  rub_soft: 'gentle_rub',
  rub_fast: 'rapid_rub',
  rub_overload: 'overstimulated',
  drag_pull: 'stretch',
  release_bounce: 'release_dazed',
  cancelled_reset: 'release_dazed',
});

// A recipe may refine the face without changing the verified V3 meaning/text.
// This is called by the single presentation reducer, so both renderers receive
// the same recipe rather than applying independent, unsynchronised overrides.
export function getPresentationExpression(personaId, semanticState, details = {}) {
  const base = getSemanticExpression(personaId, semanticState);
  if (!base) return null;
  let state = null;
  if (semanticState === 'task_success' && details.statusCode === 'site_connected') state = 'greeting';
  else if (semanticState === 'task_success' && details.statusCode === 'empty_result') state = 'empty';
  else if (semanticState === 'loading' && details.statusCode === 'feedback_reconnecting') state = 'reconnecting';
  else if (semanticState === 'task_success' && details.statusCode === 'feedback_reconnected') state = 'retry_success';
  else if (['loading','thinking','validating','awaiting_result'].includes(semanticState) && details.statusCode === 'repeat_click') state = 'repeat_click';
  else if (semanticState === 'insert_error' && details.statusCode === 'editor_unsupported') state = 'unsupported';
  else if (details.retry === true && ['save_success','insert_success','copy_success','conflict_resolved'].includes(semanticState)) state = 'retry_success';
  const entry = state && getExpression(personaId, state);
  return entry ? Object.freeze({...base, ...entry, semanticState, recipeId: entry.id, v3RecipeId: base.v3RecipeId}) : base;
}

const semanticById = new Map(SEMANTICS.map(row => [row.id, row]));

export function getSemanticExpression(personaId, semanticState) {
  const semantic = semanticById.get(semanticState);
  if (!semantic) return null;
  const expression = getExpression(personaId, V3_TO_V2[semanticState]);
  if (!expression) return null;
  return Object.freeze({
    ...expression,
    semanticState,
    recipeId: expression.id,
    v3RecipeId: semantic.recipeId,
    semanticLabel: semantic.label,
    semanticDescription: semantic.description,
  });
}

// Legacy states absent from V3 (empty, greeting, unsupported, repeat_click, etc.)
// stay addressable. This lookup does not authorize a feedback event or action.
export function resolveExpression(personaId, semanticOrV2State) {
  const mapped = getSemanticExpression(personaId, semanticOrV2State);
  if (mapped) return mapped;
  const expression = getExpression(personaId, semanticOrV2State);
  return expression ? Object.freeze({ ...expression, semanticState: semanticOrV2State, recipeId: expression.id, v3RecipeId: null }) : null;
}
