/** S3 keys for field-test cycle analytics rollups (shared to avoid import cycles). */
export const FIELD_TEST_ROLLUP_VERSION = 16;

export function fieldTestRollupKey(workType, cycleId) {
  const wt = String(workType || '1000').trim() || '1000';
  const id = String(cycleId || '').trim();
  return `${wt}/field_test_cycles/${id}/analytics_v${FIELD_TEST_ROLLUP_VERSION}.json`;
}
