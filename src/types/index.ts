// Reading status types
export type ReadingStatus = 
  | 'correct'
  | 'incorrect_new'
  | 'incorrect_analyzed'
  | 'incorrect_labeled'
  | 'incorrect_training';

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
};

// Status labels for display
export const statusLabels: Record<ReadingStatus, string> = {
  correct: 'Correct',
  incorrect_new: 'Incorrect - New',
  incorrect_analyzed: 'Incorrect - Analyzed',
  incorrect_labeled: 'Incorrect - Labeled',
  incorrect_training: 'Incorrect - Added to Training Dataset',
};

// Status colors for display
export const statusColors: Record<ReadingStatus, string> = {
  correct: '#10b981',
  incorrect_new: '#ef4444',
  incorrect_analyzed: '#f59e0b',
  incorrect_labeled: '#8b5cf6',
  incorrect_training: '#06b6d4',
};
