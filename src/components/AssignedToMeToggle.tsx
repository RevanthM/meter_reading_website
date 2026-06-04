import type { FC } from 'react';
import { UserCheck } from 'lucide-react';

type Props = {
  active: boolean;
  onChange: (active: boolean) => void;
  assignedCount: number;
  totalCount: number;
  progressRemaining?: number | null;
};

/** Matches readings-list filter chip row (field test + awaiting review). */
const AssignedToMeToggle: FC<Props> = ({
  active,
  onChange,
  assignedCount,
  totalCount,
  progressRemaining,
}) => {
  return (
    <div className="readings-list-filter-toolbar-row readings-list-filter-toolbar-row-assign">
      <span className="readings-list-filter-label">Assignment</span>
      <div className="readings-list-filter-chips readings-list-filter-chips-wrap">
        <button
          type="button"
          className={`readings-list-filter-chip${!active ? ' active' : ''}`}
          onClick={() => onChange(false)}
          aria-pressed={!active}
        >
          All ({totalCount})
        </button>
        <button
          type="button"
          className={`readings-list-filter-chip${active ? ' active' : ''}`}
          onClick={() => onChange(true)}
          aria-pressed={active}
        >
          <UserCheck size={15} aria-hidden />
          Assigned to you ({assignedCount}
          {progressRemaining != null ? ` · ${progressRemaining} left` : ''})
        </button>
      </div>
    </div>
  );
};

export default AssignedToMeToggle;
