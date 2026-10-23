import {PAPERS, POP_DESIGN_NOTES_MAX} from '../shared/contracts.mjs';
import {DESIGN_CHOICES} from '../shared/proposal-policy.js';

const moods = ['明るく', '自然に', '落ち着いて', 'やさしく'];
const directions = ['', ...Object.values(DESIGN_CHOICES)];

// Drafts are untrusted files. Restore only input and bounded design preferences;
// provider plans and the confirmation flag must be obtained/checked again.
export function parsePopDraft(text) {
  const value = JSON.parse(text);
  if (!value || value.format !== 'yamadaya-pop-draft' || value.version !== 1 ||
      typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 1500 ||
      !Object.hasOwn(PAPERS, value.paper) || !moods.includes(value.mood) ||
      (value.designNotes !== undefined && (typeof value.designNotes !== 'string' || value.designNotes.length > POP_DESIGN_NOTES_MAX)) ||
      (value.designDirection !== undefined && value.designDirection !== null && !directions.includes(value.designDirection))) {
    throw Error('この下書きは読み込めませんでした。');
  }
  return {prompt: value.prompt, paper: value.paper, mood: value.mood,
    designNotes: value.designNotes ?? '', designDirection: value.designDirection ?? null};
}

export function serializePopDraft({prompt, paper, mood, plan, designNotes, designDirection}) {
  return JSON.stringify({format: 'yamadaya-pop-draft', version: 1, prompt, paper, mood, plan,
    designNotes, designDirection}, null, 2);
}
