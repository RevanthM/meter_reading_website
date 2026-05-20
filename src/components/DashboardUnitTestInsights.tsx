import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { Loader2 } from 'lucide-react';
import type { PipelineIterationRecord, UnitTestRunDetailResponse } from '../services/api';
import { fetchUnitTestRunDetail } from '../services/api';
import { filterEvalChartRows } from '../constants/pipelineChartTheme';
import { pickNewestLink } from '../utils/unitTestIterationLink';
import DashboardUnitTestCsvCharts from './DashboardUnitTestCsvCharts';

type LinkOption = {
  s3Key: string;
  label: string;
  iterationLabel: string;
};

type Props = {
  rows: PipelineIterationRecord[];
};

const DashboardUnitTestInsights: FC<Props> = ({ rows }) => {
  const evalRows = useMemo(() => filterEvalChartRows(rows), [rows]);

  const linkOptions = useMemo((): LinkOption[] => {
    const opts: LinkOption[] = [];
    for (const r of evalRows) {
      for (const link of r.linkedUnitTests ?? []) {
        opts.push({
          s3Key: link.s3Key,
          label: link.fileName || link.s3Key.split('/').pop() || link.s3Key,
          iterationLabel: `${r.pipeline.trim()} · #${r.iterationNumber}`,
        });
      }
    }
    return opts;
  }, [evalRows]);

  const defaultKey = useMemo(() => {
    const allLinks = evalRows.flatMap((r) => r.linkedUnitTests ?? []);
    return pickNewestLink(allLinks)?.s3Key ?? linkOptions[0]?.s3Key ?? '';
  }, [evalRows, linkOptions]);

  const [selectedKey, setSelectedKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<UnitTestRunDetailResponse | null>(null);

  useEffect(() => {
    if (!selectedKey && defaultKey) setSelectedKey(defaultKey);
  }, [defaultKey, selectedKey]);

  const loadDetail = useCallback(async (key: string) => {
    if (!key) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchUnitTestRunDetail(key, { includeRows: true });
      setDetail(res);
    } catch (e) {
      setDetail(null);
      setError(e instanceof Error ? e.message : 'Failed to load unit test CSV');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedKey) void loadDetail(selectedKey);
  }, [selectedKey, loadDetail]);

  if (!linkOptions.length) {
    return (
      <div className="dashboard-unit-test-insights dashboard-unit-test-insights--empty">
        <h3>Unit test analytics (CSV)</h3>
        <p className="pipeline-iterations-chart-card-placeholder">
          Link an iOS unit test export CSV on a pipeline iteration to see overall accuracy, per-dial and difficulty
          charts, confusion heatmap, and confidence distribution.
        </p>
      </div>
    );
  }

  return (
    <div className="dashboard-unit-test-insights">
      <div className="dashboard-unit-test-insights-head">
        <div>
          <h3>Unit test analytics (CSV)</h3>
          <p className="dashboard-pipeline-essential-sub">
            From linked iOS export — overall performance, per-dial and difficulty breakdowns, confusion heatmap, and
            confidence histogram.
          </p>
        </div>
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
