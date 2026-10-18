import { proposalInput, PROPOSAL_SCHEMA, validProposal } from './proposal-contract.js';

export const PROPOSAL_POLICY = 'source-lines-and-fixed-paper-v1';
export const PROPOSAL_PAPERS = {
  a4p: { label: 'A4 縦', width: 210, height: 297 },
  a4l: { label: 'A4 横', width: 297, height: 210 },
  a3p: { label: 'A3 縦', width: 297, height: 420 },
  a3l: { label: 'A3 横', width: 420, height: 297 },
};
export const DESIGN_CHOICES = {
  lively: '明るいオレンジを使い、大きな見出しで目を引くデザイン。',
  fresh: '深い緑とやさしい生成りを使い、余白をとったデザイン。',
  premium: '落ち着いた濃色と金色のアクセントを使ったデザイン。',
  friendly: 'やわらかいピンクと丸い形を使った、親しみのあるデザイン。',
};
export const CONFIRMATION_CHOICES = [
  '商品名・価格・産地・販売期間を元情報と照合してください。',
  '入力内容が実商品に合うか確認してください。',
  '入力していない特徴は、確認してから元情報へ追加してください。',
];
const FALLBACK_HEADLINE = '売場からのお知らせ';
const FALLBACK_COPY = '内容をご確認ください。';

// Whole lines preserve negation, qualification, numbers and spacing. Substring
// matching would wrongly accept 「ふんわり」 from 「ふんわりではない」.
export function sourceChoices(input) {
  proposalInput(input);
  const lines = [...new Set(input.info.split(/\r\n|\n|\r/).filter(line => line.trim()))];
  return {
    headlines: [...new Set([...lines.filter(line => line.length <= 180), FALLBACK_HEADLINE])],
    catchphrases: [...new Set([...lines.filter(line => line.length <= 240), FALLBACK_COPY])],
  };
}
export function constrainedProposalSchema(input) {
  const choices = sourceChoices(input);
  return { ...PROPOSAL_SCHEMA, properties: {
    headlines: { ...PROPOSAL_SCHEMA.properties.headlines, items: { type: 'string', enum: choices.headlines } },
    catchphrase: { type: 'string', enum: choices.catchphrases },
    direction: { type: 'string', enum: Object.values(DESIGN_CHOICES) },
    confirmation_points: { ...PROPOSAL_SCHEMA.properties.confirmation_points, items: { type: 'string', enum: CONFIRMATION_CHOICES } },
  } };
}

// A derived display value only: never overwrite provider responses or cost jobs.
export function reviewProposal(input, raw) {
  proposalInput(input);
  if (!validProposal(raw)) throw new Error('提案の形式を確認してください。');
  const choices = sourceChoices(input);
  const kept = raw.headlines.filter(line => choices.headlines.includes(line));
  const headlines = [...new Set([...kept, ...choices.headlines])].slice(0, 3);
  while (headlines.length < 3) headlines.push(headlines[0]);
  const copyAllowed = choices.catchphrases.includes(raw.catchphrase);
  const designAllowed = Object.values(DESIGN_CHOICES).includes(raw.direction);
  const checksAllowed = raw.confirmation_points.every(point => CONFIRMATION_CHOICES.includes(point));
  return {
    policy: PROPOSAL_POLICY,
    paper: { ...PROPOSAL_PAPERS[input.paper], code: input.paper },
    adjusted: kept.length !== raw.headlines.length || !copyAllowed || !designAllowed || !checksAllowed,
    proposal: {
      headlines,
      catchphrase: copyAllowed ? raw.catchphrase : FALLBACK_COPY,
      direction: designAllowed ? raw.direction : DESIGN_CHOICES[input.mood],
      confirmation_points: checksAllowed ? [...raw.confirmation_points] : [...CONFIRMATION_CHOICES],
    },
  };
}

// Apply the same boundary when opening legacy browser drafts. Manual text is
// retained only if it is one of the permitted values; enter new facts in info.
export function reviewProposalDraft(draft, raw) {
  const review = reviewProposal(draft, raw);
  const choices = sourceChoices(draft);
  return { review, draft: { ...draft,
    headline: choices.headlines.includes(draft.headline) ? draft.headline : review.proposal.headlines[0],
    catchphrase: choices.catchphrases.includes(draft.catchphrase) ? draft.catchphrase : review.proposal.catchphrase,
    direction: Object.values(DESIGN_CHOICES).includes(draft.direction) ? draft.direction : review.proposal.direction,
  } };
}
