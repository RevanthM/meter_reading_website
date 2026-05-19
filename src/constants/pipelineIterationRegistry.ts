import type { PipelineIterationManualMetrics, PipelineIterationRecord } from '../services/api';
import { inferProductLineForRow } from './factoryStages';

/** Primary lifecycle status — values seen in May 2026 registry + sensible defaults. */
export const PIPELINE_ITERATION_PRIMARY_STATUSES = [
  'Planning',
  'In Process',
  'Completed',
  'Cancelled',
] as const;

/** Sub-status — optional detail under “In Process” (from your sheet). */
export const PIPELINE_ITERATION_SUB_STATUSES = [
  'In Training',
  'Annotation',
  'Ready for Unit/Field Testing',
  'Unit and Field Testing',
] as const;

/** Sub-status for “Ready to test” rows (simulator / unit test). */
export const PIPELINE_ITERATION_TEST_READINESS_SUB_STATUSES = [
  'Not started',
  'In progress',
  'Completed',
] as const;

export type PipelineIterationTestReadinessSubStatus =
  (typeof PIPELINE_ITERATION_TEST_READINESS_SUB_STATUSES)[number];

export function normalizePipelineIterationTestReadinessSubStatus(
  raw: string | null | undefined,
): PipelineIterationTestReadinessSubStatus | '' {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'not started' || s === 'not-started') return 'Not started';
  if (s === 'in progress' || s === 'in-progress') return 'In progress';
  if (s === 'completed' || s === 'complete') return 'Completed';
  const match = PIPELINE_ITERATION_TEST_READINESS_SUB_STATUSES.find(
    (opt) => opt.toLowerCase() === s,
  );
  return match ?? '';
}

/** Normalize free-text status to canonical casing used in filters and seeds. */
export function normalizePipelineIterationPrimaryStatus(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const lower = s.toLowerCase();
  if (lower === 'completed') return 'Completed';
  if (lower === 'in process' || lower === 'in-process') return 'In Process';
  if (lower === 'planning') return 'Planning';
  if (lower === 'cancelled' || lower === 'canceled') return 'Cancelled';
  return s;
}

function mm(partial: PipelineIterationManualMetrics): PipelineIterationManualMetrics {
  return partial;
}

/** Shared factory fields for completed May 2026 spreadsheet rows. */
function factoryShipped(utFtDone: boolean): Pick<
  PipelineIterationRecord,
  'factoryStage' | 'readyToTestUnitTestSubStatus' | 'modelShip'
> {
  return {
    factoryStage: 'shipped',
    readyToTestUnitTestSubStatus: utFtDone ? 'Completed' : '',
    modelShip: { dialDetection: false, keypoint: true },
  };
}

/**
 * May 2026 registry (spreadsheet). Import via Pipeline iterations or Model factory → “Import May 2026 metrics”.
 * Three pipelines × two iterations (6 rows). Iteration #1 has sim + exact % only; UT/FT filled at chart time via enrichment.
 */
export const PIPELINE_ITERATIONS_SEED_MAY_2026: PipelineIterationRecord[] = [
  {
    id: 'seed-11111111-1111-4111-8111-111111111101',
    pipeline: 'Sempra -1',
    iterationNumber: 1,
    modelId: 'sempra.p1',
    appVersion: '4.10 (58)',
    startDate: '2026-05-01',
    plannedEndDate: '2026-05-01',
    scope: 'Keypoint model trained on Sempra meter imagery only',
    imageCount: 450,
    imagesAddedSinceLastIteration: 0,
    currentStatus: 'Completed',
    subStatus: '',
    outcome: 'With Gallery 80%, with computer simulated image 50% and consistent every time',
    portalStats: null,
    ...factoryShipped(false),
    manualMetrics: mm({
      unitTestImagesLaptop: 224,
      fieldTestImageCount: 10,
      exactReadingAccuracyPct: 80,
      manualReviewRatePct: 73,
      simDial1ConfidencePct: 96.33,
      simDial2ConfidencePct: 92.66,
      simDial3ConfidencePct: 93.57,
      simDial4ConfidencePct: 87.6,
    }),
  },
  {
    id: 'seed-11111111-1111-4111-8111-111111111102',
    pipeline: 'Anica - 2',
    iterationNumber: 1,
    modelId: 'anica.p2',
    appVersion: '4.10 (58)',
    startDate: '2026-05-06',
    plannedEndDate: '2026-05-05',
    scope: 'Keypoint model trained on Anica meter imagery only',
    imageCount: 300,
    imagesAddedSinceLastIteration: 148,
    currentStatus: 'Completed',
    subStatus: '',
    outcome: '',
    portalStats: null,
    ...factoryShipped(false),
    manualMetrics: mm({
      unitTestImagesLaptop: 224,
      unitTestImagesGalleryOrScreen: 10,
      fieldTestImageCount: 0,
      manualReviewRatePct: 82,
      simDial1ConfidencePct: 97.7,
      simDial2ConfidencePct: 96.78,
      simDial3ConfidencePct: 95.41,
      simDial4ConfidencePct: 90.36,
    }),
  },
  {
    id: 'seed-11111111-1111-4111-8111-111111111103',
    pipeline: 'Sempra_Anica - 3',
    iterationNumber: 1,
    modelId: 'combined.p3.1',
    appVersion: '4.10 (58)',
    startDate: '2026-05-06',
    plannedEndDate: '',
    scope: 'Keypoint model trained on combined sempra + anica images',
    imageCount: 500,
    imagesAddedSinceLastIteration: null,
    currentStatus: 'Completed',
    subStatus: '',
    outcome: '',
    portalStats: null,
    ...factoryShipped(false),
    manualMetrics: mm({
      unitTestImagesLaptop: 224,
      manualReviewRatePct: 77,
      simDial1ConfidencePct: 96.78,
      simDial2ConfidencePct: 94.03,
      simDial3ConfidencePct: 94.95,
      simDial4ConfidencePct: 88.99,
    }),
  },
  {
    id: 'seed-11111111-1111-4111-8111-111111111106',
    pipeline: 'Anica - 2',
    iterationNumber: 2,
    modelId: 'anica.p2',
    appVersion: 'v4.12.60',
    startDate: '2026-05-11',
    plannedEndDate: '2026-05-13',
    scope: 'Validate new App build with Existing models',
    imageCount: 300,
    imagesAddedSinceLastIteration: null,
    currentStatus: 'Completed',
    subStatus: 'Unit and Field Testing',
    outcome: 'With Gallery 62%',
    portalStats: null,
    ...factoryShipped(true),
    manualMetrics: mm({
      unitTestImagesLaptop: 224,
      unitTestImagesGalleryOrScreen: 50,
      fieldTestImageCount: 20,
      manualReviewRatePct: 82,
      simDial1ConfidencePct: 97.7,
      simDial2ConfidencePct: 96.78,
      simDial3ConfidencePct: 95.41,
      simDial4ConfidencePct: 90.36,
      readAccuracyUt: 89,
      dial1UtPct: 92,
      dial2UtPct: 90,
      dial3UtPct: 92,
      dial4UtPct: 82,
      readAccuracyFtRow: 90.35,
      dial1FtPct: 89.79,
      dial2FtPct: 90.73,
      dial3FtPct: 90.69,
      dial4FtPct: 90.18,
    }),
  },
  {
    id: 'seed-11111111-1111-4111-8111-111111111107',
    pipeline: 'Sempra -1',
    iterationNumber: 2,
    modelId: 'sempra.p2',
    appVersion: 'v4.12.60',
    startDate: '2026-05-12',
    plannedEndDate: '2026-05-15',
    scope: 'Train with additional images to improve Accuracy',
    imageCount: 1500,
    imagesAddedSinceLastIteration: 1050,
    currentStatus: 'Completed',
    subStatus: 'Unit and Field Testing',
    outcome: '',
    portalStats: null,
    ...factoryShipped(true),
    manualMetrics: mm({
      unitTestImagesGalleryOrScreen: 50,
      manualReviewRatePct: 72,
      simDial1ConfidencePct: 94.95,
      simDial2ConfidencePct: 92.66,
      simDial3ConfidencePct: 92.66,
      simDial4ConfidencePct: 88.07,
      readAccuracyUt: 84.5,
      dial1UtPct: 90,
      dial2UtPct: 82,
      dial3UtPct: 86,
      dial4UtPct: 80,
      readAccuracyFtRow: 91.72,
      dial1FtPct: 91.07,
      dial2FtPct: 91.98,
      dial3FtPct: 91.88,
      dial4FtPct: 91.96,
    }),
  },
  {
    id: 'seed-11111111-1111-4111-8111-111111111104',
    pipeline: 'Sempra_Anica - 3',
    iterationNumber: 2,
    modelId: 'combined.p3.2',
    appVersion: 'P3_2_V514.01',
    startDate: '2026-05-13',
    plannedEndDate: '2026-05-15',
    scope: 'Train with additional images to improve Accuracy',
    imageCount: 800,
    imagesAddedSinceLastIteration: null,
    currentStatus: 'Completed',
    subStatus: 'Unit and Field Testing',
    outcome: '',
    portalStats: null,
    ...factoryShipped(true),
    manualMetrics: mm({
      manualReviewRatePct: 83,
      simDial1ConfidencePct: 97.7,
      simDial2ConfidencePct: 96.78,
      simDial3ConfidencePct: 96.78,
      simDial4ConfidencePct: 90.36,
      readAccuracyUt: 89,
      dial1UtPct: 92,
      dial2UtPct: 86,
      dial3UtPct: 92,
      dial4UtPct: 86,
      readAccuracyFtRow: 90.2,
      dial1FtPct: 90.11,
      dial2FtPct: 90.74,
      dial3FtPct: 90.06,
      dial4FtPct: 89.9,
    }),
  },
];

/**
 * Combined (p3) iteration #3 — in training, 1700 images. Separate from the six completed eval rows.
 * Shown on Model factory (training lane); included on registry overview / image-count charts as iteration #3.
 */
export const PIPELINE_ITERATIONS_SEED_P3_I3_TRAINING: PipelineIterationRecord = {
  id: 'seed-11111111-1111-4111-8111-111111111108',
  pipeline: 'Sempra_Anica - 3',
  iterationNumber: 3,
  modelId: 'combined.p3.3',
  appVersion: 'TBD',
  startDate: '2026-05-16',
  plannedEndDate: '',
  scope: 'Train with additional combined images to improve accuracy',
  imageCount: 1700,
  imagesAddedSinceLastIteration: 900,
  currentStatus: 'In Process',
  subStatus: 'In Training',
  outcome: '',
  portalStats: null,
  factoryStage: 'training',
  factoryStageSubStatus: 'In progress',
  readyToTestSimulatorSubStatus: '',
  readyToTestUnitTestSubStatus: '',
  modelShip: { dialDetection: false, keypoint: true },
  manualMetrics: {},
};

/** Six completed eval rows + optional p3 #3 in training (append if missing). */
export const PIPELINE_ITERATIONS_REGISTRY_SEED: PipelineIterationRecord[] = [
  ...PIPELINE_ITERATIONS_SEED_MAY_2026,
  PIPELINE_ITERATIONS_SEED_P3_I3_TRAINING,
];

export function iterationRegistryKey(r: Pick<PipelineIterationRecord, 'pipeline' | 'iterationNumber'>): string {
  return `${r.pipeline.trim().toLowerCase()}\t${r.iterationNumber}`;
}

/** Product line + iteration — matches spreadsheet rows even if pipeline label varies (e.g. "Sempra - 2" vs "Sempra -1"). */
export function evalIterationProductLineKey(
  r: Pick<PipelineIterationRecord, 'pipeline' | 'iterationNumber' | 'modelId'>,
): string | null {
  const line = inferProductLineForRow(r);
  if (line === 'unknown') return null;
  return `${line}\t${r.iterationNumber}`;
}

/** Append seed rows whose (pipeline, iteration #) are not already present. */
export function mergePipelineIterationSeed(
  existing: PipelineIterationRecord[],
  seed: PipelineIterationRecord[],
): PipelineIterationRecord[] {
  const keys = new Set(existing.map(iterationRegistryKey));
  const out = [...existing];
  for (const row of seed) {
    const k = iterationRegistryKey(row);
    if (keys.has(k)) continue;
    out.push({ ...row, manualMetrics: row.manualMetrics ? { ...row.manualMetrics } : {} });
    keys.add(k);
  }
  return out;
}

function applySeedPatchToRow(
  row: PipelineIterationRecord,
  patch: PipelineIterationRecord,
): PipelineIterationRecord {
  return {
    ...row,
    modelId: patch.modelId || row.modelId,
    appVersion: patch.appVersion || row.appVersion,
    startDate: patch.startDate || row.startDate,
    plannedEndDate: patch.plannedEndDate ?? row.plannedEndDate,
    scope: patch.scope || row.scope,
    imageCount: patch.imageCount ?? row.imageCount,
    imagesAddedSinceLastIteration:
      patch.imagesAddedSinceLastIteration ?? row.imagesAddedSinceLastIteration,
    currentStatus: patch.currentStatus || row.currentStatus,
    subStatus: patch.subStatus ?? row.subStatus,
    outcome: patch.outcome ?? row.outcome,
    factoryStage: patch.factoryStage ?? row.factoryStage,
    factoryStageSubStatus: patch.factoryStageSubStatus ?? row.factoryStageSubStatus,
    readyToTestSimulatorSubStatus:
      patch.readyToTestSimulatorSubStatus ?? row.readyToTestSimulatorSubStatus,
    readyToTestUnitTestSubStatus:
      patch.readyToTestUnitTestSubStatus ?? row.readyToTestUnitTestSubStatus,
    modelShip: patch.modelShip ?? row.modelShip,
    manualMetrics: patch.manualMetrics ? { ...patch.manualMetrics } : row.manualMetrics,
  };
}

/** Overwrite spreadsheet fields on existing rows; append missing seed rows. */
export function applyMay2026SpreadsheetToRegistry(
  existing: PipelineIterationRecord[],
): PipelineIterationRecord[] {
  const seedByPipelineKey = new Map(
    PIPELINE_ITERATIONS_SEED_MAY_2026.map((r) => [iterationRegistryKey(r), r]),
  );
  const seedByProductLineKey = new Map(
    PIPELINE_ITERATIONS_SEED_MAY_2026.flatMap((r) => {
      const k = evalIterationProductLineKey(r);
      return k ? [[k, r] as const] : [];
    }),
  );
  const seenProductLine = new Set<string>();

  const merged = existing.map((row) => {
    const plKey = evalIterationProductLineKey(row);
    const patch =
      seedByPipelineKey.get(iterationRegistryKey(row)) ??
      (plKey ? seedByProductLineKey.get(plKey) : undefined);
    if (!patch) return row;
    if (plKey) seenProductLine.add(plKey);
    return applySeedPatchToRow(row, patch);
  });

  for (const row of PIPELINE_ITERATIONS_SEED_MAY_2026) {
    const plKey = evalIterationProductLineKey(row);
    if (plKey && seenProductLine.has(plKey)) continue;
    if (merged.some((r) => iterationRegistryKey(r) === iterationRegistryKey(row))) continue;
    merged.push({ ...row, manualMetrics: row.manualMetrics ? { ...row.manualMetrics } : {} });
    if (plKey) seenProductLine.add(plKey);
  }
  return merged;
}

/** If registry is empty, load eval rows + p3 #3 training (for first-time S3 setup). */
export function bootstrapMay2026RegistryIfEmpty(
  existing: PipelineIterationRecord[],
): PipelineIterationRecord[] {
  if (existing.length > 0) return existing;
  return mergePipelineIterationSeed([], PIPELINE_ITERATIONS_REGISTRY_SEED);
}

/** Append p3 #3 training row if missing (does not change the six completed eval rows). */
export function mergeP3TrainingIterationIfMissing(
  existing: PipelineIterationRecord[],
): PipelineIterationRecord[] {
  return mergePipelineIterationSeed(existing, [PIPELINE_ITERATIONS_SEED_P3_I3_TRAINING]);
}

/** Apply May 2026 eval patches + ensure p3 #3 training row exists. */
export function ensureMay2026EvalRows(existing: PipelineIterationRecord[]): PipelineIterationRecord[] {
  return mergeP3TrainingIterationIfMissing(applyMay2026SpreadsheetToRegistry(existing));
}

/** Human-readable labels for eval rows in the seed that are not in the registry yet. */
export function missingMay2026EvalLabels(existing: PipelineIterationRecord[]): string[] {
  const have = new Set(
    existing.flatMap((r) => {
      const k = evalIterationProductLineKey(r);
      return k ? [k] : [];
    }),
  );
  const missing: string[] = [];
  for (const seed of PIPELINE_ITERATIONS_SEED_MAY_2026) {
    const k = evalIterationProductLineKey(seed);
    if (k && !have.has(k)) {
      missing.push(`${seed.pipeline} · #${seed.iterationNumber}`);
    }
  }
  return missing;
}
