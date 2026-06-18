import type { FC } from 'react';
import type { FieldTestCycle } from '../services/api';
import { FIELD_TEST_ALL_CYCLES } from '../utils/fieldTestCycleFilter';

type Props = {
  cycles: FieldTestCycle[];
  value: string;
  onChange: (cycleId: string) => void;
  id?: string;
  className?: string;
};

const FieldTestCycleFilterSelect: FC<Props> = ({ cycles, value, onChange, id, className }) => {
  if (cycles.length === 0) return null;

  return (
    <label className={className ?? 'unit-test-images-filter-select-wrap'}>
      <span className="unit-test-images-filter-label">Cycle</span>
      <select
        id={id}
        className="unit-test-images-filter-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Filter by field test cycle"
      >
        <option value={FIELD_TEST_ALL_CYCLES}>All cycles</option>
        {cycles.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.startDate} – {c.endDate})
          </option>
        ))}
      </select>
    </label>
  );
};

export default FieldTestCycleFilterSelect;
