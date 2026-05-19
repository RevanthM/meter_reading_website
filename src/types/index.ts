// Reading status types
export type ReadingStatus = 
  | 'correct'
  | 'incorrect_new'
  | 'incorrect_analyzed'
  | 'incorrect_labeled'
  | 'incorrect_training'
  | 'no_dials'
  | 'not_sure'
  | 'manually_uploaded';

/** S3 / portal pipeline stages after a session is marked incorrect (labeler workflow). */
export const INCORRECT_PIPELINE_STATUSES: ReadingStatus[] = [
  'incorrect_new',
  'incorrect_analyzed',
  'incorrect_labeled',
  'incorrect_training',
];

export function isIncorrectPipelineStatus(status: ReadingStatus): boolean {
  return INCORRECT_PIPELINE_STATUSES.includes(status);
}

export function statusIsIncorrect(status: ReadingStatus): boolean {
  return status.startsWith('incorrect');
}

/** Reviewer detail default: unreviewed awaiting-review rows start as Correct. */
export function initialReviewerOutcomeStatus(reading: {
  status: ReadingStatus;
  isManuallyReviewed?: boolean;
}): ReadingStatus {
  if (reading.isManuallyReviewed) return reading.status;
  if (reading.status === 'incorrect_new') return 'correct';
  return reading.status;
}

/** S3 folder after reviewer save — leaves awaiting-review when marked incorrect. */
export function resolveReviewerSaveStatus(
  selected: ReadingStatus,
  currentStatus: ReadingStatus,
): ReadingStatus {
  if (
    selected === 'correct' ||
    selected === 'no_dials' ||
    selected === 'not_sure' ||
    selected === 'manually_uploaded'
  ) {
    return selected;
  }
  if (statusIsIncorrect(selected)) {
    if (currentStatus === 'incorrect_new' && selected === 'incorrect_new') {
      return 'incorrect_analyzed';
    }
    return selected;
  }
  return selected;
}

/** Awaiting-review queue: still in `incorrect_new` and not manually reviewed in metadata. */
export function isAwaitingReviewerReview(reading: {
  status: ReadingStatus;
  isManuallyReviewed?: boolean;
}): boolean {
  return reading.status === 'incorrect_new' && reading.isManuallyReviewed !== true;
}

/** List table badge — reviewed sessions show Reviewed instead of Awaiting review. */
export function getReadingListStatusDisplay(reading: {
  status: ReadingStatus;
  isManuallyReviewed?: boolean;
}): { label: string; color: string } {
  if (reading.isManuallyReviewed) {
    return { label: 'Reviewed', color: '#2563eb' };
  }
  return { label: statusLabels[reading.status], color: statusColors[reading.status] };
}

/** Short labels for the pipeline dropdown (labeler mode). */
export const labelerPipelineStatusLabels: Record<
  'incorrect_new' | 'incorrect_analyzed' | 'incorrect_labeled' | 'incorrect_training',
  string
> = {
  incorrect_new: 'Awaiting review',
  incorrect_analyzed: 'Analyzed',
  incorrect_labeled: 'Labeled',
  incorrect_training: 'Added to training dataset',
};

/** URL segment `/readings/incorrect-queues` — all incorrect_* queues together. */
export type IncorrectQueuesListSlug = 'incorrect-queues';

export type ReadingsListFilter = ReadingStatus | 'all' | IncorrectQueuesListSlug;

// Reading type - simulator or field
export type ReadingType = 'simulator' | 'field';

// Work types supported by the system (4-digit numeric codes)
export type WorkType = '1000' | '2000' | '3000' | '4000' | '5000';

export const workTypeLabels: Record<WorkType, string> = {
  '1000': 'Meter Reading',
  '2000': 'GO95 Electrical Pole Inspection',
  '3000': 'Riser Inspection',
  '4000': 'Leak Inspection',
  '5000': 'Intrusive Inspection',
};

// Interface for meter images
export type MeterImage = {
  id: string;
  url: string;
  label: string;
  /** Present for S3-backed readings (used for Roboflow / tooling). */
  fileName?: string;
  metadata: {
    capturedAt: string;
    resolution: string;
    fileSize: string;
    dialIndex?: number;
  };
};

// Interface for meter reading
export type MeterReading = {
  id: string;
  dateOfReading: string;
  location: string;
  type: ReadingType;
  status: ReadingStatus;
  images: MeterImage[];
  meterValue: string;
  expectedValue?: string;
  comments: string;
  createdAt: string;
  updatedAt: string;
};

// Interface for dashboard counts
export type DashboardCounts = {
  totalPictures: number;
  correctCount: number;
  incorrectNewCount: number;
  incorrectAnalyzedCount: number;
  incorrectLabeledCount: number;
  incorrectTrainingCount: number;
  noDialsCount: number;
  notSureCount: number;
  manuallyUploadedCount?: number;
  /** Sessions captured on the current portal calendar day (from analytics index). */
  uploadedTodayCount?: number;
};

// Status labels for display
export const statusLabels: Record<ReadingStatus, string> = {
  correct: 'Correct',
  incorrect_new: 'Awaiting review',
  incorrect_analyzed: 'Incorrect - Analyzed',
  incorrect_labeled: 'Incorrect - Labeled',
  incorrect_training: 'Incorrect - Added to Training Dataset',
  no_dials: 'No Dials Detected',
  not_sure: 'Not Sure',
  manually_uploaded: 'Manual upload',
};

// Status colors for display
export const statusColors: Record<ReadingStatus, string> = {
  correct: '#10b981',
  incorrect_new: '#ef4444',
  incorrect_analyzed: '#d29922',
  incorrect_labeled: '#a371f7',
  incorrect_training: '#06b6d4',
  no_dials: '#6b7280',
  not_sure: '#d97706',
  manually_uploaded: '#6366f1',
};
