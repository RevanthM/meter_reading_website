import { Calendar } from 'lucide-react';
import { formatPresetLabel, type DateRangePresetId } from '../utils/dateRangePresets';

const DEFAULT_PRESETS: DateRangePresetId[] = ['today', 'yesterday', 'last7', 'last30'];

type PortalDateRangeFilterProps = {
  rangePreset: DateRangePresetId | '';
  hasDateFilter: boolean;
  dateFromDraft: string;
  dateToDraft: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onApplyPreset: (preset: DateRangePresetId) => void;
  onClear: () => void;
  onApplyCustom?: () => void;
  presetIds?: DateRangePresetId[];
  applyLabel?: string;
  /** When false, custom From/To commits only via the page-level Apply filters control. */
  showApplyButton?: boolean;
  /** Inline row inside a filter toolbar — hides the card title block. */
  inline?: boolean;
};

const PortalDateRangeFilter = ({
  rangePreset,
  hasDateFilter,
  dateFromDraft,
  dateToDraft,
  onDateFromChange,
  onDateToChange,
  onApplyPreset,
  onClear,
  onApplyCustom,
  presetIds = DEFAULT_PRESETS,
  applyLabel = 'Apply dates',
  showApplyButton = true,
  inline = false,
}: PortalDateRangeFilterProps) => {
  return (
    <div
      className={`portal-date-range-filter${inline ? ' portal-date-range-filter--inline' : ''}`}
      id="portal-date-range-filter"
    >
      {inline ? null : (
        <div className="portal-date-range-filter-head">
          <Calendar size={18} aria-hidden />
          <span className="portal-date-range-filter-title">Date range</span>
          <span className="portal-date-range-filter-hint">Pacific time · capture day</span>
        </div>
      )}
      <div className="portal-date-range-filter-body">
        {inline ? (
          <span className="readings-list-filter-label">When captured</span>
        ) : null}
        <div className="readings-list-filter-chips portal-date-range-filter-presets">
          {presetIds.map((id) => (
            <button
              key={id}
              type="button"
              className={`readings-list-filter-chip${rangePreset === id ? ' active' : ''}`}
              onClick={() => onApplyPreset(id)}
              aria-pressed={rangePreset === id}
            >
              {formatPresetLabel(id)}
            </button>
          ))}
          {hasDateFilter ? (
            <button
              type="button"
              className="readings-list-filter-chip readings-list-filter-chip-muted"
              onClick={onClear}
            >
              Clear
            </button>
          ) : null}
        </div>
        <div className="portal-date-range-filter-custom">
          <label className="portal-date-range-filter-field">
            <span className="readings-list-filter-label">From</span>
            <input
              type="date"
              className="readings-list-filter-date"
              value={dateFromDraft}
              onChange={(e) => onDateFromChange(e.target.value)}
              aria-label="Capture date from"
            />
          </label>
          <label className="portal-date-range-filter-field">
            <span className="readings-list-filter-label">To</span>
            <input
              type="date"
              className="readings-list-filter-date"
              value={dateToDraft}
              onChange={(e) => onDateToChange(e.target.value)}
              aria-label="Capture date to"
            />
          </label>
          {showApplyButton ? (
            <button type="button" className="readings-list-filter-apply" onClick={onApplyCustom}>
              {applyLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default PortalDateRangeFilter;
