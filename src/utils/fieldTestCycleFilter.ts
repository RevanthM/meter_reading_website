import type { FieldTestCycle } from '../services/api';
import type { PortalWorkMode } from './portalWorkMode';

/** URL / select value meaning no cycle date window — show captures from every cycle. */
export const FIELD_TEST_ALL_CYCLES = 'all';

export function fieldTestDefaultsToAllCycles(mode: PortalWorkMode | undefined): boolean {
  return (
    mode === 'reviewer' ||
    mode === 'test_data_reviewer' ||
    mode === 'admin'
  );
}

/** Value for the cycle `<select>` (includes synthetic "all"). */
export function fieldTestCycleSelectValue(
  cycleIdParam: string,
  activeCycle: FieldTestCycle | null,
  defaultToAll: boolean,
): string {
  const param = (cycleIdParam || '').trim();
  if (param === FIELD_TEST_ALL_CYCLES) return FIELD_TEST_ALL_CYCLES;
  if (param) return param;
  if (defaultToAll) return FIELD_TEST_ALL_CYCLES;
  return activeCycle?.id || FIELD_TEST_ALL_CYCLES;
}

/** `undefined` → API returns all field-test captures (no date window). */
export function fieldTestCycleIdForApi(selectValue: string): string | undefined {
  if (!selectValue || selectValue === FIELD_TEST_ALL_CYCLES) return undefined;
  return selectValue;
}

export function fieldTestCycleForDisplay(
  cycles: FieldTestCycle[],
  selectValue: string,
): FieldTestCycle | null {
  if (!selectValue || selectValue === FIELD_TEST_ALL_CYCLES) return null;
  return cycles.find((c) => c.id === selectValue) || null;
}

export function fieldTestCycleScopeLabel(selectValue: string, cycle: FieldTestCycle | null): string {
  if (selectValue === FIELD_TEST_ALL_CYCLES || !cycle) return 'All cycles';
  return cycle.name;
}
