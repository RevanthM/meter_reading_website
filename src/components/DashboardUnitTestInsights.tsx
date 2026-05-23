import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { Loader2 } from 'lucide-react';
import type { PipelineIterationRecord, UnitTestRunDetailResponse } from '../services/api';
import { fetchUnitTestRunDetail } from '../services/api';
import { filterEvalChartRows } from '../constants/pipelineChartTheme';
import { pickNewestLink } from '../utils/unitTestIterationLink';
import DashboardUnitTestCsvCharts from './DashboardUnitTestCsvCharts';

type LinkOption = {
  iterationId: string;
  s3Key: string;
  label: string;
  iterationLabel: string;
};

type Props = {
  rows: PipelineIterationRecord[];
  selectedIterationIds: Set<string>;
};

const DashboardUnitTestInsights: FC<Props> = ({ rows, selectedIterationIds }) => {
  const evalRows = useMemo(() => filterEvalChartRows(rows), [rows]);

  const linkOptions = useMemo((): LinkOption[] => {
    const opts: LinkOption[] = [];
    for (const r of evalRows) {
      if (!selectedIterationIds.has(r.id)) continue;
      const link = pickNewestLink(r.linkedUnitTests ?? []);
      if (!link) continue;
      opts.push({
        iterationId: r.id,
        s3Key: link.s3Key,
        label: link.fileName || link.s3Key.split('/').pop() || link.s3Key,
        iterationLabel: `${r.pipeline.trim()} · #${r.iterationNumber}`,
      });
    }
    return opts;
  }, [evalRows, selectedIterationIds]);

  const defaultKey = useMemo(() => linkOptions[0]?.s3Key ?? '', [linkOptions]);

  const [selectedKey, setSelectedKey] = useState('');
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [detailsByKey, setDetailsByKey] = useState<Map<string, UnitTestRunDetailResponse>>(() => new Map());

  useEffect(() => {
    if (!linkOptions.length) {
      setSelectedKey('');
      return;
    }
    if (!selectedKey || !linkOptions.some((o) => o.s3Key === selectedKey)) {
      setSelectedKey(defaultKey);
    }
  }, [defaultKey, linkOptions, selectedKey]);

  const loadedKeysRef = useRef<Set<string>>(new Set());

  const loadDetail = useCallback(async (key: string) => {
    if (!key || loadedKeysRef.current.has(key)) return;
    loadedKeysRef.current.add(key);
    setLoadingKeys((prev) => new Set(prev).add(key));
    setError(null);
    try {
      const res = await fetchUnitTestRunDetail(key, { includeRows: true });
      setDetailsByKey((prev) => new Map(prev).set(key, res));
    } catch (e) {
      loadedKeysRef.current.delete(key);
      setDetailsByKey((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      setError(e instanceof Error ? e.message : 'Failed to load unit test CSV');
    } finally {
      setLoadingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    const activeKeys = new Set(linkOptions.map((o) => o.s3Key));
    loadedKeysRef.current = new Set([...loadedKeysRef.current].filter((k) => activeKeys.has(k)));
    setDetailsByKey((prev) => {
      const next = new Map<string, UnitTestRunDetailResponse>();
      for (const [k, v] of prev) {
        if (activeKeys.has(k)) next.set(k, v);
      }
      return next.size === prev.size ? prev : next;
    });
    for (const opt of linkOptions) {
      void loadDetail(opt.s3Key);
    }
  }, [linkOptions, loadDetail]);

  const detail = selectedKey ? detailsByKey.get(selectedKey) ?? null : null;
  const loading = selectedKey ? loadingKeys.has(selectedKey) : false;

  if (!selectedIterationIds.size) {
    return (
      <div className="dashboard-unit-test-insights dashboard-unit-test-insights--empty">
        <h3>Unit test analytics (CSV)</h3>
        <p className="pipeline-iterations-chart-card-placeholder">
          Check one or more iterations under Current to load unit-test CSV analytics.
        </p>
      </div>
    );
  }

  if (!linkOptions.length) {
    return (
      <div className="dashboard-unit-test-insights dashboard-unit-test-insights--empty">
        <h3>Unit test analytics (CSV)</h3>
        <p className="pipeline-iterations-chart-card-placeholder">
          Selected iterations have no linked unit-test CSV yet. Link a CSV in the registry to see charts here.
        </p>
      </div>
    );
  }

  return (
    <div className="dashboard-unit-test-insights" data-report-capture="Unit test analytics">
      <div className="dashboard-unit-test-insights-head">
        <div>
          <h3>Unit test analytics (CSV)</h3>
          <p className="dashboard-pipeline-essential-sub">
            Loaded for checked iterations — per-dial breakdowns, confusion heatmap, and confidence histogram.
          </p>
        </div>
        {linkOptions.length > 1 ? (
          <label className="dashboard-per-dial-select-wrap">
            <span className="dashboard-per-dial-select-label">CSV run</span>
            <select
              className="dashboard-per-dial-select"
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              aria-label="Unit test CSV run"
            >
              {linkOptions.map((o) => (
                <option key={o.s3Key} value={o.s3Key}>
                  {o.iterationLabel} — {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="dashboard-unit-test-insights-single-run">
            {linkOptions[0]?.iterationLabel} — {linkOptions[0]?.label}
          </span>
        )}
      </div>

      {loading ? (
        <div className="chart-empty chart-empty--tight">
          <Loader2 size={24} className="spin" />
          <span>Loading CSV…</span>
        </div>
      ) : error ? (
        <p className="pipeline-iterations-chart-card-placeholder">{error}</p>
      ) : detail ? (
        <DashboardUnitTestCsvCharts detail={detail} />
      ) : null}
    </div>
  );
};

export default DashboardUnitTestInsights;
