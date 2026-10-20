import { createProvider } from '../server/provider.mjs';
import { error, FEATURES } from '../shared/contracts.mjs';

// The approved trial ends at 2026-10-26 08:47:54 JST. Configuration can
// shorten this period, but cannot silently create another week of API access.
export const HOSTED_TRIAL_DEADLINE = 1792972074000;
export const HOSTED_LIVE_TARGET = Object.freeze({
  ref: 'pgcvetybmtvojpivfjdm',
  publicOrigin: 'https://ai-mock.superyamadaya.com',
  upstreamOrigin: 'https://yamadaya-ai-trial.vercel.app',
  bucket: 'yamadaya-trial-images',
});

const credential = value => typeof value === 'string' && value.length >= 20 && !/\s/.test(value);
const projectId = value => typeof value === 'string' && /^proj_[A-Za-z0-9_-]{4,128}$/.test(value);

/** Server-only adapter. It neither reads files nor creates/refreshes keys. */
export function createHostedLiveProvider(env, { fetcher = fetch, now = () => Date.now() } = {}) {
  if (env.HOSTED_MODE !== 'live') throw Error('Explicit live trial configuration is required');
  const textKey = env.HOSTED_OPENAI_TEXT_KEY;
  const imageKey = env.HOSTED_OPENAI_IMAGE_KEY;
  const project = env.HOSTED_OPENAI_PROJECT;
  const rawExpiry = env.HOSTED_TRIAL_EXPIRES_AT;
  const expires = typeof rawExpiry === 'string' && /^[0-9]{13}$/.test(rawExpiry) ? Number(rawExpiry) : NaN;
  const validExpiry = Number.isSafeInteger(expires) && expires > 0 && expires <= HOSTED_TRIAL_DEADLINE;
  const configured = credential(textKey) && credential(imageKey) && projectId(project) && validExpiry;
  const searchEnabled = env.HOSTED_ENABLE_SEARCH === 'true';
  const provider = createProvider({ textKey: configured ? textKey : '', imageKey: configured ? imageKey : '',
    project: configured ? project : '', fetcher, searchEnabled });

  function status() {
    const expired = validExpiry && now() >= expires;
    return { connected: configured && !expired, imageConnected: configured && !expired,
      searchEnabled: configured && !expired && searchEnabled,
      stopReason: expired ? 'TRIAL_EXPIRED' : configured ? null : 'NOT_CONFIGURED' };
  }

  function assertReady(feature, input = {}) {
    if (!FEATURES.includes(feature)) throw error(403, '共用PCではこの機能を利用できません。', 'FORBIDDEN');
    const current = status();
    if (current.stopReason === 'TRIAL_EXPIRED') throw error(403, '試用の許可期限が終了しました。', 'TRIAL_EXPIRED');
    if (current.stopReason) throw error(503, 'AIの接続準備中です。', 'NOT_CONFIGURED');
    if (input.search === true && (feature !== 'chat' || !current.searchEnabled)) throw error(403, 'Web検索はまだ有効になっていません。', 'SEARCH_DISABLED');
  }

  return Object.freeze({ status, assertReady,
    async run(feature, input) {
      // Recheck after the database reservation. Waiting for its lock must not
      // extend the API approval period. Never retry or switch providers here.
      assertReady(feature, input);
      return provider.run(feature, input);
    },
  });
}
