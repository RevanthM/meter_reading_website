import { Loader2 } from 'lucide-react';
import type { FC } from 'react';

type ListViewLoadingProps = {
  message?: string;
  /** Centered panel for initial load; compact banner when refreshing with existing rows. */
  variant?: 'full' | 'inline';
};

const ListViewLoading: FC<ListViewLoadingProps> = ({
  message = 'Loading sessions…',
  variant = 'full',
}) => {
  if (variant === 'inline') {
    return (
      <p className="list-view-loading list-view-loading--inline" role="status" aria-live="polite">
        <Loader2 size={18} className="spin" aria-hidden />
        <span>{message}</span>
      </p>
    );
  }

  return (
    <div className="list-view-loading list-view-loading--full loading-state" role="status" aria-live="polite">
      <Loader2 size={40} className="spin" aria-hidden />
      <p>{message}</p>
    </div>
  );
};

export default ListViewLoading;
