import { RefreshCw } from 'lucide-react';
import type { FC } from 'react';

type ListPageRefreshButtonProps = {
  onRefresh: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: 'icon' | 'labeled';
  title?: string;
};

/** Reload control for list / queue pages (S3-backed data). */
const ListPageRefreshButton: FC<ListPageRefreshButtonProps> = ({
  onRefresh,
  busy = false,
  disabled = false,
  variant = 'labeled',
  title = 'Reload from server',
}) => {
  const isDisabled = disabled || busy;

  if (variant === 'icon') {
    return (
      <button
        type="button"
        className="refresh-button"
        onClick={onRefresh}
        disabled={isDisabled}
        title={title}
        aria-label={title}
        aria-busy={busy}
      >
        <RefreshCw size={17} className={busy ? 'spin' : ''} aria-hidden />
      </button>
    );
  }

  return (
    <button
      type="button"
      className="view-button list-page-refresh-btn"
      onClick={onRefresh}
      disabled={isDisabled}
      title={title}
      aria-busy={busy}
    >
      <RefreshCw size={16} className={busy ? 'spin' : ''} aria-hidden />
      Refresh
    </button>
  );
};

export default ListPageRefreshButton;
