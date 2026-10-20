import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupImages } from '../hosted/maintenance.mjs';

const key = index => `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000.bin`;

function fixture({ databaseKeys, inventoryKeys = [], failedStorageKey, failedMetadataBatch } = {}) {
  const pointers = new Set(databaseKeys), bytes = new Set([...databaseKeys, ...inventoryKeys]);
  const events = [], batches = [];
  let storageFailure = failedStorageKey, metadataFailure = failedMetadataBatch;
  const storage = {
    async listExpiredKeys() { return inventoryKeys.filter(value => bytes.has(value)); },
    async remove(value) {
      events.push(['bytes', value]);
      if (value === storageFailure) throw Error('Storage unavailable');
      bytes.delete(value);
    },
  };
  const ledger = {
    async listExpiredImageKeys() { return [...pointers]; },
    async removeImageMetadata(values) {
      assert.ok(values.length <= 32, 'Database accepts at most 32 image keys');
      assert.ok(values.every(value => !bytes.has(value)), 'Physical bytes must be removed before pointers');
      batches.push([...values]);
      events.push(['metadata', [...values]]);
      if (batches.length === metadataFailure) throw Error('Database unavailable');
      for (const value of values) pointers.delete(value);
    },
    async purgeExpired(now) { events.push(['purge', now]); },
  };
  return { ledger, storage, pointers, bytes, events, batches,
    recover() { storageFailure = undefined; metadataFailure = undefined; } };
}

test('33 expired pointers are deleted in database batches of 32 and 1', async () => {
  const databaseKeys = Array.from({ length: 33 }, (_, index) => key(index));
  const f = fixture({ databaseKeys });
  assert.deepEqual(await cleanupImages(f.ledger, f.storage, 1000), { deleted: 33 });
  assert.deepEqual(f.batches.map(values => values.length), [32, 1]);
  assert.deepEqual(f.batches.flat(), databaseKeys);
  assert.ok(f.events.slice(0, 33).every(([type]) => type === 'bytes'));
  assert.deepEqual(f.events.at(-1), ['purge', 1000]);
  assert.equal(f.bytes.size, 0);
  assert.equal(f.pointers.size, 0);
});

test('100 inventory objects plus database pointers are deduplicated and batched above 100 keys', async () => {
  const databaseKeys = Array.from({ length: 35 }, (_, index) => key(index));
  const inventoryKeys = Array.from({ length: 100 }, (_, index) => key(index + 33));
  const f = fixture({ databaseKeys, inventoryKeys });
  assert.deepEqual(await cleanupImages(f.ledger, f.storage, 2000), { deleted: 133 });
  assert.deepEqual(f.batches.map(values => values.length), [32, 32, 32, 32, 5]);
  assert.equal(new Set(f.batches.flat()).size, 133);
  assert.equal(f.events.filter(([type]) => type === 'bytes').length, 133);
  assert.ok(f.events.slice(0, 133).every(([type]) => type === 'bytes'));
  assert.equal(f.bytes.size, 0);
  assert.equal(f.pointers.size, 0);
});

test('a later physical deletion failure retains its pointer and retries only cleanup', async () => {
  const databaseKeys = Array.from({ length: 65 }, (_, index) => key(index));
  const f = fixture({ databaseKeys, failedStorageKey: databaseKeys[40] });
  await assert.rejects(cleanupImages(f.ledger, f.storage), /Storage unavailable/);
  assert.equal(f.pointers.size, 65);
  assert.ok(f.pointers.has(databaseKeys[40]));
  assert.ok(f.bytes.has(databaseKeys[40]));
  assert.equal(f.batches.length, 0);
  assert.equal(f.events.filter(([type]) => type === 'purge').length, 0);
  f.recover();
  assert.deepEqual(await cleanupImages(f.ledger, f.storage), { deleted: 65 });
  assert.deepEqual(f.batches.map(values => values.length), [32, 32, 1]);
  assert.equal(f.bytes.size, 0);
  assert.equal(f.pointers.size, 0);
});

test('a failed metadata batch leaves unremoved pointers for a later idempotent cleanup', async () => {
  const databaseKeys = Array.from({ length: 70 }, (_, index) => key(index));
  const f = fixture({ databaseKeys, failedMetadataBatch: 2 });
  await assert.rejects(cleanupImages(f.ledger, f.storage), /Database unavailable/);
  assert.equal(f.bytes.size, 0);
  assert.deepEqual([...f.pointers], databaseKeys.slice(32));
  assert.equal(f.events.filter(([type]) => type === 'purge').length, 0);
  f.recover();
  assert.deepEqual(await cleanupImages(f.ledger, f.storage), { deleted: 38 });
  assert.equal(f.pointers.size, 0);
  assert.ok(f.batches.every(values => values.length <= 32));
});
