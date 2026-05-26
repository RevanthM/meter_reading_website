import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { Loader2 } from 'lucide-react';
import type { PipelineIterationRecord, UnitTestRunDetailResponse } from '../services/api';
import { fetchUnitTestRunDetail } from '../services/api';
import { filterEvalChartRows } from '../constants/pipelineChartTheme';
import { pickNewestLink } from '../utils/unitTestIterationLink';
import { formatUnitTestSourceLabel } from '../utils/unitTestDisplayLabels';
import DashboardUnitTestCsvCharts from './DashboardUnitTestCsvCharts';
import UnitTestConfusionHeatmap from './UnitTestConfusionHeatmap';

type LinkOption = {
  iterationId: string;
  s3Key: string;
  label: string;
  iterationLabel: string;
};

type Props = {
  rows: PipelineIterationRecord[];
  selectedIterationIds: Set<string>;
  /** Current tab: show only the confusion heatmap for the displayed iteration(s). */
  confusionOnly?: boolean;
};

const DashboardUnitTestInsights: FC<Props> = ({
  rows,
  selectedIterationIds,
  confusionOnly = false,
}) => {
  const evalRows = useMemo(() => filterEvalChartRows(rows), [rows]);

  const linkOptions = useMemo((): LinkOption[] => {
    const opts: LinkOption[] = [];
    for (const r of evalRows) {
      if (!selectedIterationIds.has(r.id)) continue;
      const link = pickNewestLink(r.linkedUnitTests ?? []);
      if (!link) continue;
      const iterationLabel = `${r.pipeline.trim()} · #${r.iterationNumber}`;
      opts.push({
        iterationId: r.id,
        s3Key: link.s3Key,
        label: formatUnitTestSourceLabel(iterationLabel, link),
        iterationLabel,
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
      setError(e instanceof Error ? e.message : 'Could not load unit test results');
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
    if (confusionOnly) return null;
    return (
      <div className="dashboard-unit-test-insights dashboard-unit-test-insights--empty">
        <h3>Unit test results</h3>
        <p className="pipeline-iterations-chart-card-placeholder">
          Select one or more iterations under All details to view unit test results.
        </p>
      </div>
    );
  }

  if (!linkOptions.length) {
    if (confusionOnly) return null;
    return (
      <div className="dashboard-unit-test-insights dashboard-unit-test-insights--empty">
        <h3>Unit test results</h3>
        <p className="pipeline-iterations-chart-card-placeholder">
          Selected iterations have no unit test file attached yet. Attach a unit test file to an iteration to view
          results here.
        </p>
      </div>
    );
  }

  if (confusionOnly) {
    return (
      <div className="analytics-details-block analytics-details-block--current-confusion">
        <header className="analytics-details-block__head">
          <h4>Digit confusion — current iteration</h4>
          <p>Ground truth vs predicted digits for this iteration.</p>
        </header>
        {linkOptions.length > 1 ? (
          <label className="dashboard-per-dial-select-wrap analytics-current-confusion-run">
            <span className="dashboard-per-dial-select-label">Unit test file</span>
            <select
              className="dashboard-per-dial-select"
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              aria-label="Unit test file"
            >
              {linkOptions.map((o) => (
                <option key={o.s3Key} value={o.s3Key}>
                  {o.iterationLabel} — {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="dashboard-unit-test-insights-single-run analytics-current-confusion-run">
            {linkOptions[0]?.iterationLabel} — {linkOptions[0]?.label}
          </p>
        )}
        {loading ? (
          <div className="chart-empty chart-empty--tight">
            <Loader2 size={24} className="spin" />
            <span>Loading digit confusion matrix…</span>
          </div>
        ) : error ? (
          <p className="pipeline-iterations-chart-card-placeholder">{error}</p>
        ) : detail ? (
          <UnitTestConfusionHeatmap
            perImageRows={detail.perImageRows}
            reportCapture
            reportSection="Current"
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="dashboard-unit-test-insights">
      <div className="dashboard-unit-test-insights-head">
        <div>
          <h3>Unit test results</h3>
          <p className="dashboard-pipeline-essential-sub">
            Shown for selected iterations — per-dial breakdowns, digit confusion matrix, and confidence
            distribution.
          </p>
        </div>
        {linkOptions.length > 1 ? (
          <label className="dashboard-per-dial-select-wrap">
            <span className="dashboard-per-dial-select-label">Unit test file</span>
            <select
              className="dashboard-per-dial-select"
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              aria-label="Unit test file"
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
          <span>Loading results…</span>
        </div>
      ) : error ? (
        <p className="pipeline-iterations-chart-card-placeholder">{error}</p>
      ) : detail ? (
        <DashboardUnitTestCsvCharts detail={detail} reportCapture />
      ) : null}
    </div>
  );
};

export default DashboardUnitTestInsights;
