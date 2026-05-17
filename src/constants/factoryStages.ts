import type { PipelineIterationRecord } from '../services/api';

/** Assembly-line stages for the model factory (portal). */
export const FACTORY_STAGES = [
  { id: 'planning', label: 'Planning', short: 'Plan' },
  { id: 'collecting', label: 'Collecting data', short: 'Data' },
  { id: 'labeling', label: 'Labeling', short: 'Label' },
  { id: 'training', label: 'Training', short: 'Train' },
  { id: 'model_ready', label: 'Model ready', short: 'Ready' },
  { id: 'ready_to_test', label: 'Ready to test', short: 'Test' },
  { id: 'shipped', label: 'Shipped', short: 'Shipped' },
] as const;

export type FactoryStageId = (typeof FACTORY_STAGES)[number]['id'];

export const FACTORY_STAGE_IDS: FactoryStageId[] = FACTORY_STAGES.map((s) => s.id);

export function factoryStageLabel(id: FactoryStageId | string): string {
  return FACTORY_STAGES.find((s) => s.id === id)?.label ?? id;
}

/** Product line: p1 Sempra, p2 Anica, p3 Sempra+Anica (hybrid). */
export type FactoryProductLine = 'p1' | 'p2' | 'p3' | 'unknown';

export function inferProductLine(modelId: string): FactoryProductLine {
  const m = modelId.trim().toLowerCase();
  if (!m || m === 'tbd') return 'unknown';
  if (m.startsWith('p3.') || /\.p3(\.|$)/.test(m) || m.includes('combined') || m.includes('hybrid')) {
    return 'p3';
  }
  if (m.includes('sempra') && m.includes('anica')) return 'p3';
  if (m.startsWith('p1.') || /\.p1(\.|$)/.test(m) || m.includes('sempra')) return 'p1';
  if (m.startsWith('p2.') || /\.p2(\.|$)/.test(m) || m.includes('anica')) return 'p2';
  return 'unknown';
}

/** Product line from model id, then pipeline name (for rows without model # yet). */
export function inferProductLineForRow(row: {
  modelId?: string | null;
  pipeline?: string | null;
}): FactoryProductLine {
  const fromModel = inferProductLine(row.modelId || '');
  if (fromModel !== 'unknown') return fromModel;
  const p = (row.pipeline || '').trim().toLowerCase();
  if (!p) return 'unknown';
  const compact = p.replace(/[\s_-]+/g, '');
  if (
    (p.includes('sempra') && p.includes('anica')) ||
    compact.includes('sempraanica') ||
    p.includes('combined') ||
    p.includes('hybrid')
  ) {
    return 'p3';
  }
  if (p.includes('sempra')) return 'p1';
  if (p.includes('anica')) return 'p2';
  return 'unknown';
}

export const FACTORY_PRODUCT_LINES: { id: FactoryProductLine; label: string; short: string }[] = [
  { id: 'p1', label: 'Sempra (p1)', short: 'p1' },
  { id: 'p2', label: 'Anica (p2)', short: 'p2' },
  { id: 'p3', label: 'Sempra + Anica (p3)', short: 'p3' },
];

export function productLineDisplay(line: FactoryProductLine): string {
  switch (line) {
    case 'p1':
      return 'Sempra (p1)';
    case 'p2':
      return 'Anica (p2)';
    case 'p3':
      return 'Sempra + Anica (p3)';
    default:
      return '—';
  }
}

export function inferFactoryStage(row: PipelineIterationRecord): FactoryStageId {
  const explicit = row.factoryStage?.trim();
  if (explicit && FACTORY_STAGE_IDS.includes(explicit as FactoryStageId)) {
    return explicit as FactoryStageId;
  }
  const status = (row.currentStatus || '').trim().toLowerCase();
  const sub = (row.subStatus || '').trim().toLowerCase();
  if (status === 'cancelled') return 'planning';
  if (status === 'completed') return 'shipped';
  if (sub.includes('unit') || sub.includes('field test') || sub.includes('testing')) {
    return 'ready_to_test';
  }
  if (sub.includes('training')) return 'training';
  if (sub.includes('annotation') || sub.includes('label')) return 'labeling';
  if (status === 'planning') return 'planning';
  if (status === 'in process' || status === 'in-process') {
    if (sub.includes('ready')) return 'model_ready';
    return 'collecting';
  }
  return 'collecting';
}

/** Four-column board on Model factory (subset of assembly-line stages). */
export type FactoryColumnId = 'labelling' | 'training' | 'ready' | 'shipped';

export const FACTORY_COLUMNS: {
  id: FactoryColumnId;
  label: string;
  hint: string;
  stages: FactoryStageId[];
}[] = [
  {
    id: 'labelling',
    label: 'Labelling',
    hint: 'Planning · data · annotation',
    stages: ['planning', 'collecting', 'labeling'],
  },
  {
    id: 'training',
    label: 'Training',
    hint: 'In training',
    stages: ['training'],
  },
  {
    id: 'ready',
    label: 'Ready',
    hint: 'Model ready · unit / field test',
    stages: ['model_ready', 'ready_to_test'],
  },
  {
    id: 'shipped',
    label: 'Shipped',
    hint: 'Completed / in production',
    stages: ['shipped'],
  },
];

export function factoryColumnLabel(id: FactoryColumnId): string {
  return FACTORY_COLUMNS.find((c) => c.id === id)?.label ?? id;
}

export function columnForStage(stage: FactoryStageId): FactoryColumnId {
  if (stage === 'shipped') return 'shipped';
  if (stage === 'model_ready' || stage === 'ready_to_test') return 'ready';
  if (stage === 'training') return 'training';
  return 'labelling';
}

export function inferFactoryColumn(row: PipelineIterationRecord): FactoryColumnId {
  return columnForStage(inferFactoryStage(row));
}

export function nextFactoryStage(id: FactoryStageId): FactoryStageId | null {
  const i = FACTORY_STAGE_IDS.indexOf(id);
  if (i < 0 || i >= FACTORY_STAGE_IDS.length - 1) return null;
  return FACTORY_STAGE_IDS[i + 1];
}

/** Map factory stage → spreadsheet-style status for backward compatibility. */
export function factoryStageToLegacyStatus(stage: FactoryStageId): {
  currentStatus: string;
  subStatus: string;
} {
  switch (stage) {
    case 'planning':
      return { currentStatus: 'Planning', subStatus: '' };
    case 'collecting':
      return { currentStatus: 'In Process', subStatus: '' };
    case 'labeling':
      return { currentStatus: 'In Process', subStatus: 'Annotation' };
    case 'training':
      return { currentStatus: 'In Process', subStatus: 'In Training' };
    case 'model_ready':
      return { currentStatus: 'In Process', subStatus: '' };
    case 'ready_to_test':
      return { currentStatus: 'In Process', subStatus: 'Ready for Unit/Field Testing' };
    case 'shipped':
      return { currentStatus: 'Completed', subStatus: '' };
    default:
      return { currentStatus: 'In Process', subStatus: '' };
  }
}
