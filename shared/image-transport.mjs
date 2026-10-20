const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_BYTES = 10 * 1024 * 1024;

/** Reassemble a protected image in memory; no direct storage URL or browser key. */
export async function hydrateImageResult(result, { fetcher = fetch, signal } = {}) {
  if (!result?.imageManifest) return result;
  const m = result.imageManifest;
  if (!new RegExp(`^/api/images/${UUID}/$`).test(m.path) || !['image/png', 'image/jpeg', 'image/svg+xml'].includes(m.mime) || !Number.isSafeInteger(m.size) || m.size <= 0 || m.size > MAX_BYTES || m.chunks !== Math.ceil(m.size / CHUNK_BYTES) || !/^[a-f0-9]{64}$/.test(m.sha256)) throw Error('画像の保存情報を確認できません。');
  const bytes = new Uint8Array(m.size); let offset = 0;
  for (let part = 0; part < m.chunks; part++) {
    const response = await fetcher(`${m.path}${part}`, { cache: 'no-store', credentials: 'same-origin', signal });
    if (!response.ok) throw Error('画像の保存期限または接続状態を確認してください。画像は再生成しません。');
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.length !== Math.min(CHUNK_BYTES, m.size - offset)) throw Error('画像の受信サイズを確認できません。');
    bytes.set(data, offset); offset += data.length;
  }
  const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (actual !== m.sha256) throw Error('画像の一致を確認できません。画像は再生成しません。');
  let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  const { imageManifest, ...rest } = result;
  return { ...rest, image: `data:${m.mime};base64,${btoa(binary)}` };
}
