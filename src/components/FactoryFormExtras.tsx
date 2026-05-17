import { useCallback, useEffect, useState, type FC } from 'react';
import { Loader2 } from 'lucide-react';
import type { PipelineIterationRecord, PipelineIterationRoboflowVersionLink } from '../services/api';
import {
  FACTORY_STAGES,
  type FactoryStageId,
  factoryStageToLegacyStatus,
  inferFactoryStage,
  inferProductLine,
  productLineDisplay,
} from '../constants/factoryStages';
import FactoryIterationWeights from './FactoryIterationWeights';
import RoboflowLinkDetail from './RoboflowLinkDetail';
import {
  fetchRoboflowProjectDetail,
  fetchRoboflowProjects,
  fetchRoboflowStatus,
  fetchRoboflowVersionMeta,
  inferRoboflowProjectRole,
  type RoboflowProject,
  type RoboflowProjectVersion,
} from '../services/roboflowApi';
import { mergeRoboflowVersionDetailIntoLink } from '../utils/roboflowLinkFields';

type Props = {
  row: PipelineIterationRecord;
  setRow: React.Dispatch<React.SetStateAction<PipelineIterationRecord>>;
};

type LinkKey = 'dialDetection' | 'keypoint';

const FactoryFormExtras: FC<Props> = ({ row, setRow }) => {
  const [rfProjects, setRfProjects] = useState<RoboflowProject[]>([]);
  const [rfLoading, setRfLoading] = useState(false);
  const [rfErr, setRfErr] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [versionLists, setVersionLists] = useState<Record<string, RoboflowProjectVersion[]>>({});
  const [modelsUrls, setModelsUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    void (async () => {
      setRfLoading(true);
      setRfErr(null);
      try {
        const st = await fetchRoboflowStatus();
        if (!st.configured) {
          setRfErr(
            'Roboflow is not configured on the server. Local: add ROBOFLOW_API_KEY to src/.env and restart npm run dev:all. Production: Elastic Beanstalk → Configuration → Environment properties → ROBOFLOW_API_KEY (deploy excludes .env files).',
          );
          return;
        }
        const data = await fetchRoboflowProjects();
        setRfProjects(data.projects || []);
      } catch (e) {
        setRfErr(e instanceof Error ? e.message : 'Roboflow load failed');
      } finally {
        setRfLoading(false);
      }
    })();
  }, []);

  const linkField = (role: 'dial_detection' | 'keypoint'): LinkKey =>
    role === 'dial_detection' ? 'dialDetection' : 'keypoint';

  const refreshVersionMeta = useCallback(
    async (link: PipelineIterationRoboflowVersionLink, version: number) => {
      const meta = await fetchRoboflowVersionMeta(link.datasetSlug, version);
      return mergeRoboflowVersionDetailIntoLink({ ...link, version }, meta);
    },
    [],
  );

  const setLink = (linkKey: LinkKey, link: PipelineIterationRoboflowVersionLink | null) => {
    setRow((r) => {
      const next = { ...(r.roboflowLinks ?? {}) };
      if (link) next[linkKey] = link;
      else delete next[linkKey];
      return {
        ...r,
        roboflowLinks: Object.keys(next).length ? next : null,
      };
    });
  };

  const normalizeSlug = (slug: string) => {
    const parts = slug.split('/').filter(Boolean);
    if (parts.length >= 3 && parts[0] === parts[1]) return parts.slice(1).join('/');
    return slug;
  };

  const linkProject = async (role: 'dial_detection' | 'keypoint', datasetSlug: string) => {
    const linkKey = linkField(role);
    if (!datasetSlug) {
      setLink(linkKey, null);
      return;
    }
    const slug = normalizeSlug(datasetSlug);
    setDetailLoading(slug);
    setRfErr(null);
    try {
      const detail = await fetchRoboflowProjectDetail(slug);
      setVersionLists((prev) => ({ ...prev, [slug]: detail.versions }));
      const modelsUrl = detail.modelsUrl;
      if (modelsUrl) {
        setModelsUrls((prev) => ({ ...prev, [slug]: modelsUrl }));
      }
      const trained =
        detail.trainedModels?.length > 0
          ? detail.trainedModels
          : detail.versions.filter((v) => v.hasTrainedModel);
      const pick = trained[0] ?? detail.versions[0];
      const ver = pick?.version ?? 1;
      const base: PipelineIterationRoboflowVersionLink = {
        datasetSlug: detail.datasetSlug,
        projectName: detail.name,
        version: ver,
        role,
      };
      const enriched = await refreshVersionMeta(base, ver);
      setLink(linkKey, enriched);
    } catch (e) {
      setRfErr(e instanceof Error ? e.message : 'Failed to load project');
    } finally {
      setDetailLoading(null);
    }
  };

  const changeVersion = async (linkKey: LinkKey, version: number) => {
    const link = row.roboflowLinks?.[linkKey];
    if (!link) return;
    setDetailLoading(link.datasetSlug);
    setRfErr(null);
    try {
      const enriched = await refreshVersionMeta(link, version);
      setLink(linkKey, enriched);
    } catch (e) {
      setRfErr(e instanceof Error ? e.message : 'Failed to load version');
    } finally {
      setDetailLoading(null);
    }
  };

  // Hydrate version lists + refresh stale links when editing an existing row
  useEffect(() => {
    const links = row.roboflowLinks;
    if (!links) return;
    void (async () => {
      for (const linkKey of ['dialDetection', 'keypoint'] as const) {
        const link = links[linkKey];
        if (!link?.datasetSlug || link.version == null) continue;
        const slug = normalizeSlug(link.datasetSlug);
        try {
          const detail = await fetchRoboflowProjectDetail(slug);
          setVersionLists((prev) => ({ ...prev, [slug]: detail.versions }));
          const modelsUrl = detail.modelsUrl;
          if (modelsUrl) {
            setModelsUrls((prev) => ({ ...prev, [slug]: modelsUrl }));
          }
          const trained =
            detail.trainedModels?.length > 0
              ? detail.trainedModels
              : detail.versions.filter((v) => v.hasTrainedModel);
          const needsRelink =
            slug !== link.datasetSlug ||
            link.imageCount == null ||
            link.lastTrainedAt == null ||
            (trained.length > 0 && !trained.some((t) => t.version === link.version));
          if (needsRelink) {
            const pick =
              trained.find((t) => t.version === link.version) ||
              trained[0] ||
              detail.versions.find((v) => v.version === link.version) ||
              detail.versions[0];
            const ver = pick?.version ?? link.version;
            const base = { ...link, datasetSlug: slug, projectName: detail.name, version: ver };
            const enriched = await refreshVersionMeta(base, ver);
            setLink(linkKey, enriched);
          }
        } catch (e) {
          setRfErr(e instanceof Error ? e.message : 'Failed to refresh Roboflow link');
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once per link slug/version
  }, [row.roboflowLinks?.dialDetection?.datasetSlug, row.roboflowLinks?.keypoint?.datasetSlug]);

  const stage = (row.factoryStage?.trim() || inferFactoryStage(row)) as FactoryStageId;
  const line = inferProductLine(row.modelId);
  const ship = row.modelShip ?? { dialDetection: false, keypoint: true };

  const setStage = (id: FactoryStageId) => {
    const legacy = factoryStageToLegacyStatus(id);
    setRow((r) => ({
      ...r,
      factoryStage: id,
      currentStatus: legacy.currentStatus,
      subStatus: legacy.subStatus,
    }));
  };

  const setShip = (patch: Partial<{ dialDetection: boolean; keypoint: boolean }>) => {
    setRow((r) => ({
      ...r,
      modelShip: { dialDetection: false, keypoint: true, ...r.modelShip, ...patch },
    }));
  };

  const dialProjects = rfProjects.filter((p) => inferRoboflowProjectRole(p) !== 'keypoint');
  const kpProjects = rfProjects.filter((p) => inferRoboflowProjectRole(p) !== 'dial_detection');

  return (
    <>
      <fieldset className="pipeline-iteration-form-section model-factory-form-section">
        <legend>Factory — stage &amp; ship</legend>
        <p className="pipeline-iteration-form-hint">
          Product line from model id: <strong>{productLineDisplay(line)}</strong> (p1 Sempra · p2 Anica · p3 Sempra + Anica).
        </p>
        <div className="pipeline-iteration-form-grid">
          <label>
            Factory stage
            <select value={stage} onChange={(e) => setStage(e.target.value as FactoryStageId)}>
              {FACTORY_STAGES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="model-factory-ship-tiles" role="group" aria-label="What ships in this release">
          <label className="model-factory-ship-tile">
            <input
              type="checkbox"
              checked={Boolean(ship.dialDetection)}
              onChange={(e) => setShip({ dialDetection: e.target.checked })}
            />
            <span>Dial finder (Stage A)</span>
          </label>
          <label className="model-factory-ship-tile">
            <input
              type="checkbox"
              checked={Boolean(ship.keypoint)}
              onChange={(e) => setShip({ keypoint: e.target.checked })}
            />
            <span>Keypoint reader (Stage B)</span>
          </label>
        </div>
      </fieldset>

      <fieldset className="pipeline-iteration-form-section model-factory-form-section">
        <legend>Roboflow</legend>
        {rfLoading ? (
          <p className="pipeline-iteration-form-hint">
            <Loader2 size={14} className="spin" /> Loading projects…
          </p>
        ) : null}
        {rfErr ? (
          <p className="pipeline-iterations-banner pipeline-iterations-banner--error" role="alert">
            {rfErr}
          </p>
        ) : null}
        <div className="pipeline-iteration-form-grid">
          <label>
            Dial detection project
            <select
              value={row.roboflowLinks?.dialDetection?.datasetSlug ?? ''}
              onChange={(e) => void linkProject('dial_detection', e.target.value)}
              disabled={Boolean(detailLoading)}
            >
              <option value="">— none —</option>
              {(dialProjects.length ? dialProjects : rfProjects).map((p) => (
                <option key={p.datasetSlug} value={p.datasetSlug}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Keypoint project
            <select
              value={row.roboflowLinks?.keypoint?.datasetSlug ?? ''}
              onChange={(e) => void linkProject('keypoint', e.target.value)}
              disabled={Boolean(detailLoading)}
            >
              <option value="">— none —</option>
              {(kpProjects.length ? kpProjects : rfProjects).map((p) => (
                <option key={p.datasetSlug} value={p.datasetSlug}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="model-factory-rf-details">
          {row.roboflowLinks?.dialDetection ? (
            <RoboflowLinkDetail
              title="Dial detection"
              link={row.roboflowLinks.dialDetection}
              versions={versionLists[row.roboflowLinks.dialDetection.datasetSlug] ?? []}
              modelsUrl={modelsUrls[row.roboflowLinks.dialDetection.datasetSlug]}
              loading={detailLoading === row.roboflowLinks.dialDetection.datasetSlug}
              onVersionChange={(v) => void changeVersion('dialDetection', v)}
              onClear={() => void linkProject('dial_detection', '')}
            />
          ) : null}
          {row.roboflowLinks?.keypoint ? (
            <RoboflowLinkDetail
              title="Keypoint"
              link={row.roboflowLinks.keypoint}
              versions={versionLists[row.roboflowLinks.keypoint.datasetSlug] ?? []}
              modelsUrl={modelsUrls[row.roboflowLinks.keypoint.datasetSlug]}
              loading={detailLoading === row.roboflowLinks.keypoint.datasetSlug}
              onVersionChange={(v) => void changeVersion('keypoint', v)}
              onClear={() => void linkProject('keypoint', '')}
            />
          ) : null}
        </div>
      </fieldset>

      <FactoryIterationWeights row={row} setRow={setRow} />
    </>
  );
};

export default FactoryFormExtras;
