import { useCallback, useEffect, useState } from 'react';
import {
  fetchReviewAssignments,
  type ReviewAssignmentBatchSummary,
  type ReviewAssignmentPool,
} from '../services/api';
import type { PortalWorkMode } from '../utils/portalWorkMode';
import { mergeAssignmentSessionOrder } from '../utils/reviewAssignments';

export function useMyAssignmentOrder(
  pool: ReviewAssignmentPool,
  workType: string,
  userEmail: string | null | undefined,
  workMode: PortalWorkMode,
  enabled: boolean,
): {
  batches: ReviewAssignmentBatchSummary[];
  orderIds: string[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [batches, setBatches] = useState<ReviewAssignmentBatchSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const email = userEmail?.trim();
    if (!enabled || !email) {
      setBatches([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchReviewAssignments(
        workType,
        { mine: true, pool },
        workMode,
        email,
      );
      setBatches(res.batches);
    } catch {
      setBatches([]);
    } finally {
      setLoading(false);
    }
  }, [pool, workType, userEmail, workMode, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const orderIds = mergeAssignmentSessionOrder(batches);

  return { batches, orderIds, loading, refresh };
}
