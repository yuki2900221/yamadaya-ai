// Private operator task only; there is deliberately no HTTP/admin route.
// Delete bytes first. Never purge pointers on a failed storage deletion.
export async function cleanupImages(ledger, storage, now = Date.now()) {
  const keys = [...new Set([...(await ledger.listExpiredImageKeys(now)), ...(await storage.listExpiredKeys(now))])];
  for (const key of keys) await storage.remove(key);
  // The database accepts at most 32 keys per mutation; independent inventory
  // can return 100, in addition to expired pointers. Delete every byte first.
  for (let offset = 0; offset < keys.length; offset += 32) {
    await ledger.removeImageMetadata(keys.slice(offset, offset + 32));
  }
  await ledger.purgeExpired(now);
  return { deleted: keys.length };
}
