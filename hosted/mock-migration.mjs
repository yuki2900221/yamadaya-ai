// Produce DDL for a separate MOCK namespace. Never consume the real trial ledger
// during the future mock deployment acceptance tests. This only returns text.
export function mockMigration(source) {
  if (typeof source !== 'string' || !source.includes('CREATE SCHEMA yamadaya_trial;')) throw Error('Expected reviewed migration source');
  return source.replaceAll('yamadaya_trial', 'yamadaya_mock');
}
