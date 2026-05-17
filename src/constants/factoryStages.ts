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

/** Product line from model id (p1 Anica, p2 Sempra, p3 Hybrid). */
export type FactoryProductLine = 'p1' | 'p2' | 'p3' | 'unknown';

export function inferProductLine(modelId: string): FactoryProductLine {
  const m = modelId.trim().toLowerCase();
  if (!m || m === 'tbd') return 'unknown';
  if (m.startsWith('p1.') || m.includes('anica')) return 'p1';
  if (m.startsWith('p2.') || m.includes('sempra')) return 'p2';
  if (m.startsWith('p3.') || m.includes('combined') || m.includes('hybrid')) return 'p3';
  return 'unknown';
}

export function productLineDisplay(line: FactoryProductLine): string {
  switch (line) {
    case 'p1':
      return 'Anica (p1)';
    case 'p2':
      return 'Sempra (p2)';
    case 'p3':
      return 'Hybrid (p3)';
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
