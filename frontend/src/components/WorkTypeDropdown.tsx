import { ChevronDown, Briefcase } from 'lucide-react';
import { WorkType } from '../types';

interface WorkTypeDropdownProps {
  workTypes: WorkType[];
  selectedWorkType: string | null;
  onSelect: (code: string) => void;
  isLoading?: boolean;
}

export function WorkTypeDropdown({
  workTypes,
  selectedWorkType,
  onSelect,
  isLoading = false,
}: WorkTypeDropdownProps) {
  const selected = workTypes.find((wt) => wt.code === selectedWorkType);

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-gray-400 mb-2">
        Select Work Type
      </label>
      <div className="relative">
        <select
          value={selectedWorkType || ''}
          onChange={(e) => onSelect(e.target.value)}
          disabled={isLoading}
          className="w-full appearance-none bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 pr-10 text-white font-medium focus:outline-none focus:ring-2 focus:ring-accent-blue focus:border-transparent transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="" disabled>
            Choose a work type...
          </option>
          {workTypes.map((wt) => (
            <option key={wt.code} value={wt.code}>
              {wt.code} - {wt.name}
            </option>
          ))}
        </select>
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
          <ChevronDown className="w-5 h-5 text-gray-400" />
        </div>
      </div>
      {selected && (
        <div className="mt-3 flex items-center gap-2 text-sm text-gray-400">
          <Briefcase className="w-4 h-4" />
          <span>{selected.condition_codes.length} condition codes available</span>
        </div>
      )}
    </div>
  );
}
