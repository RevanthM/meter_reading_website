import type { FC } from 'react';
import { List, Map } from 'lucide-react';

export type CaptureViewMode = 'map' | 'list';

type Props = {
  mode: CaptureViewMode;
  onChange: (mode: CaptureViewMode) => void;
  className?: string;
};

const CaptureViewModeToggle: FC<Props> = ({ mode, onChange, className = '' }) => (
  <div className={`capture-view-mode-toggle ${className}`.trim()} role="group" aria-label="View mode">
    <button
      type="button"
      className={`capture-view-mode-btn${mode === 'map' ? ' active' : ''}`}
      onClick={() => onChange('map')}
      aria-pressed={mode === 'map'}
    >
      <Map size={16} aria-hidden />
      Map
    </button>
    <button
      type="button"
      className={`capture-view-mode-btn${mode === 'list' ? ' active' : ''}`}
      onClick={() => onChange('list')}
      aria-pressed={mode === 'list'}
    >
      <List size={16} aria-hidden />
      List
    </button>
  </div>
);

export default CaptureViewModeToggle;
