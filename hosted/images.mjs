import { createHash, randomUUID } from 'node:crypto';
import { error } from '../shared/contracts.mjs';

// Each protected HTTP response stays below Vercel's 4.5 MB response limit.
export const IMAGE_CHUNK_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function decodeGeneratedImage(data, { mock = false } = {}) {
  const match = typeof data === 'string' && data.match(/^data:(image\/(?:png|jpeg|svg\+xml));base64,([A-Za-z0-9+/]+=*)$/);
  if (!match || (!mock && match[1] === 'image/svg+xml')) throw error(502, '画像の形式を確認できません。', 'INVALID_IMAGE');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== match[2]) throw error(502, '画像のサイズを確認できません。', 'INVALID_IMAGE');
  if (match[1] === 'image/png' && !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw error(502, 'PNGを確認できません。', 'INVALID_IMAGE');
  if (match[1] === 'image/jpeg' && (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255)) throw error(502, 'JPEGを確認できません。', 'INVALID_IMAGE');
  return { bytes, mime: match[1] };
}

export async function stageImage(storage, data, options) {
  const { bytes, mime } = decodeGeneratedImage(data, options);
  const key = `${randomUUID()}.bin`;
  await storage.put(key, bytes, mime);
  return { key, mime, size: bytes.length, sha256: digest(bytes), chunks: Math.ceil(bytes.length / IMAGE_CHUNK_BYTES) };
}

// This adapter never creates buckets, signs public URLs, or reads environment keys.
// It must use a NEW dedicated project + private bucket; no business project keys.
export function createPrivateStorage({ baseUrl, bucket, serverKey, fetcher = fetch }) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.origin !== baseUrl || !base.hostname.endsWith('.supabase.co') || !/^[a-z0-9-]{1,63}$/.test(bucket) || typeof serverKey !== 'string' || serverKey.length < 20) throw Error('Private storage configuration required');
  // New secret keys are opaque, not JWTs: the hosted gateway authenticates
  // their apikey header. Only legacy keys retain the Bearer compatibility path.
  const authHeaders = { apikey: serverKey, ...(!serverKey.startsWith('sb_secret_') ? { Authorization: `Bearer ${serverKey}` } : {}) };
  const objectUrl = key => {
    if (!/^[0-9a-f-]{36}\.bin$/.test(key)) throw Error('Invalid storage object');
    return `${baseUrl}/storage/v1/object/${bucket}/${key}`;
  };
  const request = async (key, method, body, mime) => {
    const response = await fetcher(objectUrl(key), { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { ...authHeaders, ...(mime ? { 'Content-Type': mime, 'x-upsert': 'false' } : {}) }, body });
    if (!response.ok) throw error(502, '非公開画像の保存先を確認できません。', 'STORAGE_UNAVAILABLE');
    return response;
  };
  return {
    async put(key, bytes, mime) { await request(key, 'POST', bytes, mime); },
    async get(key) {
      const response = await request(key, 'GET');
      const reader = response.body.getReader(), chunks = []; let count = 0;
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; count += value.length; if (count > MAX_IMAGE_BYTES) throw error(502, '画像が大きすぎます。', 'INVALID_IMAGE'); chunks.push(Buffer.from(value)); } }
      finally { await reader.cancel().catch(() => {}); }
      return Buffer.concat(chunks);
    },
    async remove(key) {
      objectUrl(key); // Validate before constructing the bucket-scoped deletion.
      const response = await fetcher(`${baseUrl}/storage/v1/object/${bucket}`, { method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [key] }) });
      if (!response.ok && response.status !== 404) throw error(502, '非公開画像を削除できませんでした。', 'STORAGE_UNAVAILABLE');
    },
    async listExpiredKeys(now = Date.now()) {
      // Independent inventory also finds an upload left by a killed function
      // before its database pointer was committed. The bucket is dedicated.
      const response = await fetcher(`${baseUrl}/storage/v1/object/list/${bucket}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: '', limit: 100, offset: 0, sortBy: { column: 'created_at', order: 'asc' } }) });
      if (!response.ok) throw error(502, '非公開画像の削除対象を確認できません。', 'STORAGE_UNAVAILABLE');
      const items = await response.json();
      if (!Array.isArray(items) || items.length > 100) throw error(502, '画像一覧を確認できません。', 'STORAGE_UNAVAILABLE');
      return items.filter(item => /^[0-9a-f-]{36}\.bin$/.test(item.name) && Number.isFinite(Date.parse(item.created_at)) && Date.parse(item.created_at) <= now - 15 * 60000).map(item => item.name);
    },
  };
}
