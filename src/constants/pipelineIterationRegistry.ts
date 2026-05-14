import type { PipelineIterationManualMetrics, PipelineIterationRecord } from '../services/api';

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
] as const;

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

/**
 * May 2026 sample registry (from spreadsheet). Import via “Add sample rows” on Pipeline iterations
 * (merges by pipeline + iteration #). `portalStats` omitted — use “Load from portal” per row after save.
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
    outcome: 'With Gallary 80%, with computer simulated image 50% and consitent every time',
    portalStats: null,
    manualMetrics: mm({
      unitTestImagesLaptop: 224,
      unitTestImagesGalleryOrScreen: null,
      fieldTestImageCount: 10,
      exactReadingAccuracyPct: 80,
      manualReviewRatePct: 76,
      simDial1ConfidencePct: 94.59,
      simDial2ConfidencePct: 93.3,
      simDial3ConfidencePct: 95.04,
      simDial4ConfidencePct: 90.09,
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
    manualMetrics: mm({
      unitTestImagesLaptop: 224,
      unitTestImagesGalleryOrScreen: 10,
      fieldTestImageCount: 0,
      simDial1ConfidencePct: 96.39,
      simDial2ConfidencePct: 95.94,
      simDial3ConfidencePct: 95.09,
      simDial4ConfidencePct: 90.99,
      manualReviewRatePct: 80,
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
    manualMetrics: mm({
      unitTestImagesLaptop: 224,
      simDial1ConfidencePct: 94.59,
      simDial2ConfidencePct: 97.74,
      simDial3ConfidencePct: 97.29,
      simDial4ConfidencePct: 89.73,
      manualReviewRatePct: 81,
    }),
  },
  {
    id: 'seed-11111111-1111-4111-8111-111111111104',
    pipeline: 'Sempra_Anica - 3',
    iterationNumber: 2,
    modelId: 'combined.p3.2',
    appVersion: '4.10 (58)',
    startDate: '2026-05-06',
    plannedEndDate: '',
    scope: 'Train with additional images to improve Accuracy',
    imageCount: 750,
    imagesAddedSinceLastIteration: 250,
    currentStatus: 'In Process',
    subStatus: 'In Training',
    outcome: '',
    portalStats: null,
    manualMetrics: mm({
      unitTestImagesLaptop: 224,
      exactReadingAccuracyPct: 0,
    }),
  },
  {
    id: 'seed-11111111-1111-4111-8111-111111111105',
    pipeline: 'Computer Simulator - 4',
    iterationNumber: 1,
    modelId: 'TBD',
    appVersion: 'TBD',
    startDate: '2026-05-01',
    plannedEndDate: '',
    scope: 'Reserved row — fill in when simulator pipeline is defined.',
    imageCount: null,
    imagesAddedSinceLastIteration: null,
    currentStatus: 'Planning',
    subStatus: '',
    outcome: '',
    portalStats: null,
    manualMetrics: {},
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
    currentStatus: 'In Process',
    subStatus: 'Ready for Unit/Field Testing',
    outcome: 'With Gallary 62%',
    portalStats: null,
    manualMetrics: mm({
      unitTestImagesLaptop: 224,
      unitTestImagesGalleryOrScreen: 50,
      fieldTestImageCount: 20,
      simDial1ConfidencePct: 95.98,
      simDial2ConfidencePct: 96.43,
      simDial3ConfidencePct: 95.09,
      simDial4ConfidencePct: 89.73,
      manualReviewRatePct: 79,
    }),
  },
  {
    id: 'seed-11111111-1111-4111-8111-111111111107',
    pipeline: 'Sempra -1',
    iterationNumber: 2,
    modelId: 'sempra.p1',
    appVersion: 'v4.12.60',
    startDate: '2026-05-12',
    plannedEndDate: '2026-05-15',
    scope: 'Train with additional images to improve Accuracy',
    imageCount: 1500,
    imagesAddedSinceLastIteration: 1050,
    currentStatus: 'In Process',
    subStatus: 'Annotation',
    outcome: '',
    portalStats: null,
    manualMetrics: mm({
      unitTestImagesGalleryOrScreen: 50,
    }),
  },
];

export function iterationRegistryKey(r: Pick<PipelineIterationRecord, 'pipeline' | 'iterationNumber'>): string {
  return `${r.pipeline.trim().toLowerCase()}\t${r.iterationNumber}`;
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
