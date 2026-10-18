export const PROPOSAL_TRIAL_ID = 'text-proposals-20261018';
export const PROPOSAL_MODEL = 'gpt-6-luna';
export const PROPOSAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['headlines', 'catchphrase', 'direction', 'confirmation_points'],
  properties: {
    headlines: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
    catchphrase: { type: 'string' }, direction: { type: 'string' },
    confirmation_points: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } },
  },
};
export function proposalInput(value) {
  if (!value || !['a4p', 'a4l', 'a3p', 'a3l'].includes(value.paper) || !['lively', 'fresh', 'premium', 'friendly'].includes(value.mood)) throw new Error('用紙と雰囲気を確認してください。');
  if (typeof value.info !== 'string' || !value.info.trim() || value.info.length > 1500 || typeof value.atmosphere !== 'string' || value.atmosphere.length > 500) throw new Error('商品情報と補足を確認してください。');
  return { info: value.info, atmosphere: value.atmosphere, paper: value.paper, mood: value.mood };
}
export function validProposal(value) {
  const text = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
  return Boolean(value && Object.keys(value).sort().join(',') === 'catchphrase,confirmation_points,direction,headlines' &&
    Array.isArray(value.headlines) && value.headlines.length === 3 && value.headlines.every(s => text(s, 180)) &&
    typeof value.catchphrase === 'string' && value.catchphrase.length <= 240 && text(value.direction, 500) && Array.isArray(value.confirmation_points) &&
    value.confirmation_points.length >= 1 && value.confirmation_points.length <= 4 && value.confirmation_points.every(s => text(s, 240)));
}
export const PROPOSAL_CASES = [
  { id: 'apple', label: 'りんご・元気な売場', input: { info: '架空の検証商品：青森県産りんご\n1袋398円（税込）\nシャキッとした食感・さわやかな甘さ\n10月20日〜22日限定', mood: 'lively', atmosphere: '秋らしく、価格が分かりやすい売場POP', paper: 'a4p' } },
  { id: 'vegetables', label: '野菜・さわやかな売場', input: { info: '架空の検証商品：長野県産ほうれん草\n1袋198円（税込）\nおひたし・炒め物におすすめ\n期間の指定なし', mood: 'fresh', atmosphere: '自然な緑と白。毎日の食卓に取り入れやすく', paper: 'a4l' } },
  { id: 'bread', label: 'パン・親しみのある売場', input: { info: '架空の検証商品：バターロール\n6個入り1袋298円（税込）\n朝食・おやつにおすすめ\n産地や製法の情報は未入力', mood: 'friendly', atmosphere: 'あたたかい色。家族の朝食向けに親しみやすく', paper: 'a4p' } },
];
