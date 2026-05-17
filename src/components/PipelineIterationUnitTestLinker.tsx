import { useCallback, useMemo, useState, type FC } from 'react';
import { FileSpreadsheet, Link2, Loader2, Unlink, Wand2, X } from 'lucide-react';
import type { WorkType } from '../types';
import type { PipelineIterationUnitTestLink, PipelineIterationManualMetrics } from '../services/api';
import { fetchUnitTestRunDetail, fetchUnitTestRuns } from '../services/api';
import {
  applyUnitTestSummaryToManualMetrics,
  modelIdMatchesUnitTest,
  parseUnitTestFileName,
  pickNewestLink,
  unitTestSummaryToLinkMeta,
} from '../utils/unitTestIterationLink';

type Props = {
  workType: WorkType;
  modelId: string;
  linked: PipelineIterationUnitTestLink[];
  onLinkedChange: (links: PipelineIterationUnitTestLink[]) => void;
  onApplyManualMetrics: (metrics: PipelineIterationManualMetrics) => void;
  onSuggestAppVersion?: (appVersion: string) => void;
};

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString();
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

const PipelineIterationUnitTestLinker: FC<Props> = ({
  workType,
  modelId,
  linked,
  onLinkedChange,
  onApplyManualMetrics,
  onSuggestAppVersion,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [runs, setRuns] = useState<
    { key: string; fileName: string; lastModified: string | null; pipelineHint: string | null }[]
  >([]);
  const [linkingKey, setLinkingKey] = useState<string | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [localMsg, setLocalMsg] = useState<string | null>(null);

  const linkedKeys = useMemo(() => new Set(linked.map((l) => l.s3Key)), [linked]);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const data = await fetchUnitTestRuns(workType);
      setRuns(
        (data.runs || []).map((r) => {
          const fileName = r.fileName || r.key.split('/').pop() || r.key;
          return {
            key: r.key,
            fileName,
            lastModified: r.lastModified,
            pipelineHint: parseUnitTestFileName(fileName).pipelineId,
          };
        }),
      );
    } catch (e) {
      setRunsError(e instanceof Error ? e.message : 'Failed to load unit test CSVs from S3.');
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, [workType]);

  const openPicker = () => {
    setPickerOpen(true);
    setLocalMsg(null);
    void loadRuns();
  };

  const linkRun = async (key: string, fileName: string) => {
    if (linkedKeys.has(key)) {
      setLocalMsg('That CSV is already linked to this iteration.');
      return;
    }
    setLinkingKey(key);
    setLocalMsg(null);
    try {
      const detail = await fetchUnitTestRunDetail(key, { includeRows: false });
      const meta = unitTestSummaryToLinkMeta(key, fileName, detail.summary);
      onLinkedChange([...linked, meta]);
      setLocalMsg(`Linked ${meta.fileName || fileName}.`);
      setPickerOpen(false);
    } catch (e) {
      setLocalMsg(e instanceof Error ? e.message : 'Failed to read CSV from S3.');
    } finally {
      setLinkingKey(null);
    }
  };

  const unlink = (s3Key: string) => {
    onLinkedChange(linked.filter((l) => l.s3Key !== s3Key));
    setLocalMsg(null);
  };

  const applyFromLinked = async () => {
    const target = pickNewestLink(linked);
    if (!target) {
      setLocalMsg('Link a unit test CSV first.');
      return;
    }
    setApplyBusy(true);
    setLocalMsg(null);
    try {
      const detail = await fetchUnitTestRunDetail(target.s3Key, { includeRows: false });
      const metrics = applyUnitTestSummaryToManualMetrics(detail.summary);
      onApplyManualMetrics(metrics);
      const appHint =
        detail.summary.app_version?.trim() ||
        target.appVersionHint?.trim() ||
        parseUnitTestFileName(target.fileName || '').appVersionHint;
      if (appHint && onSuggestAppVersion) {
        onSuggestAppVersion(appHint);
      }
      setLocalMsg(
        `Applied metrics from ${target.fileName || 'CSV'} (accuracy ${fmtPct(target.accuracyPercent)}, ${target.imagesProcessed ?? '—'} images).`,
      );
    } catch (e) {
      setLocalMsg(e instanceof Error ? e.message : 'Failed to apply metrics from CSV.');
    } finally {
      setApplyBusy(false);
    }
  };

  const sortedRuns = useMemo(() => {
    const mid = modelId.trim();
    return [...runs].sort((a, b) => {
      const aMatch =
        mid &&
        (a.pipelineHint?.toLowerCase() === mid.toLowerCase() ||
          a.fileName.toLowerCase().includes(mid.toLowerCase()));
      const bMatch =
        mid &&
        (b.pipelineHint?.toLowerCase() === mid.toLowerCase() ||
          b.fileName.toLowerCase().includes(mid.toLowerCase()));
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return (b.lastModified || '').localeCompare(a.lastModified || '');
    });
  }, [runs, modelId]);

  return (
    <fieldset className="pipeline-iteration-form-section pipeline-iteration-ut-section">
      <legend>Unit test CSV (S3)</legend>
      <p className="pipeline-iteration-form-hint">
        Link exports from <code>{workType}/unit_test_results/</code> on the training bucket. Saves with{' '}
        <strong>Save row</strong> then <strong>Save to S3</strong> on the list page.
      </p>

      <div className="pipeline-iteration-ut-actions">
        <button type="button" className="view-button" onClick={openPicker}>
          <Link2 size={16} aria-hidden />
          Link unit test CSV…
        </button>
        <button
          type="button"
          className="view-button"
          onClick={() => void applyFromLinked()}
          disabled={!linked.length || applyBusy}
        >
          {applyBusy ? (
            <Loader2 size={16} className="spin" aria-hidden />
          ) : (
            <Wand2 size={16} aria-hidden />
          )}
          Apply metrics from linked
        </button>
      </div>

      {localMsg ? (
        <p className="pipeline-iterations-banner pipeline-iterations-banner--info" role="status">
          {localMsg}
        </p>
      ) : null}

      {linked.length > 0 ? (
        <ul className="pipeline-iteration-ut-linked-list">
          {linked.map((l) => (
            <li key={l.s3Key} className="pipeline-iteration-ut-linked-item">
              <FileSpreadsheet size={16} aria-hidden className="pipeline-iteration-ut-linked-icon" />
              <div className="pipeline-iteration-ut-linked-body">
                <span className="pipeline-iteration-ut-linked-name" title={l.s3Key}>
                  {l.fileName || l.s3Key.split('/').pop()}
                </span>
                <span className="pipeline-iteration-ut-linked-meta">
                  {l.pipelineDisplayName || l.pipelineId || '—'}
                  {' · '}
                  {fmtPct(l.accuracyPercent)} acc.
                  {l.imagesProcessed != null ? ` · ${l.imagesProcessed} img` : ''}
                  {l.generatedUtc ? ` · ${fmtWhen(l.generatedUtc)}` : ''}
                </span>
              </div>
              <button
                type="button"
                className="pipeline-iterations-icon-btn"
                title="Unlink"
                aria-label="Unlink CSV"
                onClick={() => unlink(l.s3Key)}
              >
                <Unlink size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pipeline-iteration-form-hint">No unit test CSV linked yet.</p>
      )}

      {pickerOpen ? (
        <div className="pipeline-iteration-ut-picker" role="dialog" aria-label="Choose unit test CSV">
          <div className="pipeline-iteration-ut-picker-head">
            <h3>Unit test results on S3</h3>
            <button
              type="button"
              className="pipeline-iteration-modal-close"
              onClick={() => setPickerOpen(false)}
              aria-label="Close picker"
            >
              <X size={18} />
            </button>
          </div>
          {runsLoading ? (
            <p className="pipeline-iteration-form-hint">
              <Loader2 size={16} className="spin" style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
              Loading CSV list…
            </p>
          ) : null}
          {runsError ? (
            <p className="pipeline-iterations-banner pipeline-iterations-banner--error" role="alert">
              {runsError}
            </p>
          ) : null}
          {!runsLoading && !runsError && sortedRuns.length === 0 ? (
            <p className="pipeline-iteration-form-hint">No CSV files found under unit_test_results for this work type.</p>
          ) : null}
          {!runsLoading && sortedRuns.length > 0 ? (
            <div className="pipeline-iteration-ut-picker-table-wrap">
              <table className="roboflow-hub-table pipeline-iteration-ut-picker-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Pipeline hint</th>
                    <th>Modified</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sortedRuns.map((r) => {
                    const isLinked = linkedKeys.has(r.key);
                    const suggested =
                      modelId.trim() &&
                      (r.pipelineHint?.toLowerCase() === modelId.trim().toLowerCase() ||
                        r.fileName.toLowerCase().includes(modelId.trim().toLowerCase()) ||
                        modelIdMatchesUnitTest(modelId, {
                          s3Key: r.key,
                          fileName: r.fileName,
                          pipelineId: r.pipelineHint,
                        }));
                    return (
                      <tr key={r.key} className={suggested ? 'pipeline-iteration-ut-picker-row--suggested' : ''}>
                        <td className="pipeline-iteration-ut-picker-file" title={r.key}>
                          {r.fileName}
                          {suggested ? (
                            <span className="pipeline-iteration-ut-suggested-badge">Likely match</span>
                          ) : null}
                        </td>
                        <td>{r.pipelineHint || '—'}</td>
                        <td>{fmtWhen(r.lastModified)}</td>
                        <td>
                          <button
                            type="button"
                            className="training-hub-text-btn"
                            disabled={isLinked || linkingKey === r.key}
                            onClick={() => void linkRun(r.key, r.fileName)}
                          >
                            {linkingKey === r.key ? (
                              <Loader2 size={14} className="spin" aria-hidden />
                            ) : isLinked ? (
                              'Linked'
                            ) : (
                              'Link'
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
};

export default PipelineIterationUnitTestLinker;
