import type { MeterReading, DashboardCounts, WorkType } from '../types';
import type { PortalWorkMode } from '../utils/portalWorkMode';
import { portalWorkModeForMetadataHeader } from '../utils/portalWorkMode';
import { ANICA_LOGIN_USER_ID_KEY } from './anicaLoginAuth';

export type ReviewerDatasetDestination = 'training' | 'test' | null;
export type ImageDifficulty = 'normal' | 'difficult' | 'very_difficult' | null;
export type TestDataReviewStatus = 'pending' | 'approved' | null;
import type { DataSource } from '../context/ReadingsContext';

const API_BASE_URL = '/api';

/** Turn browser network errors into an actionable message (API server not running / incorrect origin). */
function wrapFetchNetworkError(e: unknown, hint: string): Error {
  if (e instanceof TypeError && /failed to fetch/i.test(e.message)) {
    return new Error(
      `${hint} Could not reach the API. Use http://localhost:5173 (with \`npm run dev:all\` or \`npm run server\` on port 3001).`,
    );
  }
  return e instanceof Error ? e : new Error(String(e));
}

/** Parse successful API body text; if HTML slipped through (SPA fallback), explain likely cause. */
function parseJsonBody<T>(text: string, httpStatus: number): T {
  const trimmed = text.trim();
  if (trimmed.startsWith('<') || trimmed.startsWith('<!')) {
    throw new Error(
      'API returned HTML instead of JSON — usually the SPA index.html (Vite without a running API on 3001, or an old `npm run server` that does not include this route). Fix: stop and run `npm run server` on port 3001 from the project root, then use `npm run dev` and open the app on http://localhost:5173 (not file://). After `git pull`, always restart the Node server.',
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Invalid JSON from API (HTTP ${httpStatus}). Start: ${text.slice(0, 100).replace(/\s+/g, ' ')}…`,
    );
  }
}

/** Normalized bbox in 0–1 space (metadata `dial_details`). */
export type DialBoundingBox = { x?: number; y?: number; w?: number; h?: number };

export type DialStage1Info = {
  bounding_box?: DialBoundingBox;
  detection_confidence?: number;
};

export type DialPoint = { x?: number; y?: number };

export type DialStage2Info = {
  bounding_box?: DialBoundingBox;
  dial_center?: DialPoint;
  needle_tip?: DialPoint;
  zero_mark?: DialPoint;
  keypoint_confidence?: number;
};

export type DialStage3Info = {
  vector_center_to_tip?: { dx?: number; dy?: number };
  vector_center_to_zero?: { dx?: number; dy?: number };
  angular_offset_deg?: number;
  normalized_dial_angle_deg?: number;
  angle_to_digit?: number;
  digit?: number;
};

/** One row of `metadata.json` `dial_details` (core fields + optional pipeline stages). */
export type DialDetailFromMetadata = {
  dial: number;
  prediction: number;
  direction: string;
  confidence: number;
  bounding_box?: DialBoundingBox;
  stage_1?: DialStage1Info;
  stage_2?: DialStage2Info;
  stage_3?: DialStage3Info;
};

/** GPS snapshot from `metadata.capture_location` (iOS). */
export type CaptureLocation = {
  placeLabel?: string | null;
  coordinateLabel?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  capturedAt?: string | null;
};

export interface S3MeterReading extends MeterReading {
  /** Exact S3 session prefix (…/sessionId/) for server-side moves. */
  s3SessionPrefix?: string;
  /** Full GPS / address payload; `location` is the short list label derived from this. */
  captureLocation?: CaptureLocation | null;
  rawPrediction?: string;
  isCorrect?: boolean;
  confidence?: number;
  processingTimeMs?: number;
  dialCount?: number;
  /** Per-dial model diagnostics; optional nested stages from `metadata.json` (newer captures). */
  dialDetails?: DialDetailFromMetadata[];
  bucket?: string;
  /** App work-type code from metadata (e.g. METR) or portal filter code. */
  workType?: string;
  /** iOS app / bundle generation tag from metadata (`app_version`). */
  appVersion?: string;
  conditionCode?: string;
  userName?: string;
  imageSource?: string;
  captureTrigger?: string;
  uploadMode?: string;
  feedbackType?: string;
  /** Field / unit test: user changed dials or final reading on device. */
  hadUserCorrection?: boolean;
  /** @deprecated Use reviewerDatasetDestination — kept for list filters. */
  reviewerRecommendTraining?: boolean;
  reviewerDatasetDestination?: ReviewerDatasetDestination;
  imageDifficulty?: ImageDifficulty;
  testDataReviewStatus?: TestDataReviewStatus;
  testDataUnitTestS3Key?: string;
  testDataUnitTestFileName?: string;
  testDataApprovedAt?: string;
  /** Reviewer who queued session for test-data approval (`test_data_submitted_by`). */
  testDataSubmittedBy?: string;
  /** When session was sent to pending test data (`test_data_submitted_at`). */
  testDataSubmittedAt?: string;
  /** `is_manually_reviewed` in metadata; legacy `is_human_reviewed` is still read by the server until migrated. */
  isManuallyReviewed?: boolean;
  /** Email from `portal_metadata_updated_by` after a portal save to metadata.json. */
  portalMetadataUpdatedBy?: string;
  portalMetadataUpdatedAt?: string;
  /** Image count when list API omits full `images` (Dynamo index path). */
  imageCount?: number;
  /** Portal bulk upload awaiting a 4-digit label. */
  manualLabelPending?: boolean;
  /** Field test cycle capture (`field_test_capture` in metadata). */
  fieldTestCapture?: boolean;
  /** Derived reviewer/model ground truth when synced from Dynamo. */
  finalReading?: string | null;
  /** Admin assignment batch (`review_assignment_batch_id`). */
  reviewAssignmentBatchId?: string | null;
  reviewAssignedTo?: string | null;
  reviewAssignedAt?: string | null;
  reviewAssignedBy?: string | null;
}

export type ReviewAssignmentPool = 'field_test' | 'awaiting_review';

export type ReviewAssignmentRules = {
  dateFrom?: string | null;
  dateTo?: string | null;
  firstN?: number;
  corrected?: 'all' | 'yes' | 'no';
  cohort?: string;
  sort?: 'date_asc' | 'date_desc';
};

export type ReviewAssignmentBatchSummary = {
  id: string;
  name: string;
  pool: ReviewAssignmentPool;
  workType: string;
  status: 'open' | 'closed';
  createdAt: string;
  createdBy: string;
  rules: ReviewAssignmentRules;
  totalAssigned: number;
  assignees: {
    email: string;
    count: number;
    reviewed: number | null;
    remaining: number | null;
  }[];
  mySessionIds?: string[];
  myProgress?: { reviewed: number; total: number; remaining: number };
};

/** Pulled from portal readings for this row’s app version (work type + data source scope). */
export interface PipelineIterationPortalStats {
  pulledAt: string;
  workType: string;
  dataSource: 'all' | 'field' | 'simulator';
  totalSessions: number;
  totalImages: number;
  simulatorSessions: number;
  simulatorImages: number;
  fieldSessions: number;
  fieldImages: number;
  /** 0–1 session-level average when metadata has confidence. */
  avgSessionConfidence: number | null;
  /** % sessions in `correct` queue. */
  queueCorrectRateAll: number | null;
  queueCorrectRateSimulator: number | null;
  queueCorrectRateField: number | null;
  /** Avg per-dial digit match % (expected vs model), simulator sessions only. */
  digitMatchUtPct: number | null;
  dial1UtPct: number | null;
  dial2UtPct: number | null;
  dial3UtPct: number | null;
  dial4UtPct: number | null;
  digitMatchFtPct: number | null;
  dial1FtPct: number | null;
  dial2FtPct: number | null;
  dial3FtPct: number | null;
  dial4FtPct: number | null;
}

/** Roboflow / offline eval / extra app metrics — manual entry (typically 0–100 for % fields). */
export interface PipelineIterationManualMetrics {
  roboflowAvgBboxConfidence?: number | null;
  roboflowAvgKeypointConfidence?: number | null;
  appAvgBboxConfidence?: number | null;
  appAvgKeypointConfidence?: number | null;
  readAccuracySimulatorLaptop?: number | null;
  readAccuracyUt?: number | null;
  readAccuracyFt?: number | null;
  dial1UtPct?: number | null;
  dial2UtPct?: number | null;
  dial3UtPct?: number | null;
  dial4UtPct?: number | null;
  readAccuracyFtRow?: number | null;
  dial1FtPct?: number | null;
  dial2FtPct?: number | null;
  dial3FtPct?: number | null;
  dial4FtPct?: number | null;

  /** Admin: UT images on laptop eval set. */
  unitTestImagesLaptop?: number | null;
  /** Admin: UT images from gallery or screen capture. */
  unitTestImagesGalleryOrScreen?: number | null;
  /** Admin: field test image count for this iteration. */
  fieldTestImageCount?: number | null;

  /** Admin: full-meter exact reading accuracy % (golden / eval). */
  exactReadingAccuracyPct?: number | null;
  /** Admin: % of sessions manually reviewed (operational metric). */
  manualReviewRatePct?: number | null;

  /** Admin: per-dial accuracy % — on-device app eval. */
  appDial1AccuracyPct?: number | null;
  appDial2AccuracyPct?: number | null;
  appDial3AccuracyPct?: number | null;
  appDial4AccuracyPct?: number | null;
  /** Admin: per-dial accuracy % — simulator / laptop (distinct from portal auto UT if you need both). */
  simDial1AccuracyPct?: number | null;
  simDial2AccuracyPct?: number | null;
  simDial3AccuracyPct?: number | null;
  simDial4AccuracyPct?: number | null;

  /** Admin: per-dial mean confidence % — app. */
  appDial1ConfidencePct?: number | null;
  appDial2ConfidencePct?: number | null;
  appDial3ConfidencePct?: number | null;
  appDial4ConfidencePct?: number | null;
  /** Admin: per-dial mean confidence % — simulator. */
  simDial1ConfidencePct?: number | null;
  simDial2ConfidencePct?: number | null;
  simDial3ConfidencePct?: number | null;
  simDial4ConfidencePct?: number | null;
}

/** iOS unit-test CSV linked to a pipeline iteration (stored in S3 registry JSON). */
export interface PipelineIterationUnitTestLink {
  s3Key: string;
  fileName?: string | null;
  linkedAt?: string | null;
  pipelineId?: string | null;
  pipelineDisplayName?: string | null;
  accuracyPercent?: number | null;
  imagesProcessed?: number | null;
  generatedUtc?: string | null;
  appVersionHint?: string | null;
}

/** Parsed summary block from an iOS unit-test export CSV. */
export interface UnitTestCsvSummary {
  pipeline_id?: string;
  pipeline_display_name?: string;
  pipeline_version?: string;
  pipeline_product?: string;
  images_processed?: string;
  imagesProcessed?: number;
  with_filename_ground_truth?: string;
  withGroundTruth?: number;
  correct_readings?: string;
  correct?: number;
  accuracy_percent?: string;
  accuracyPercent?: number | null;
  generated_utc?: string;
  app_version?: string;
  [key: string]: string | number | null | undefined;
}

export interface UnitTestRunIndexRow {
  key: string;
  fileName: string;
  size: number;
  lastModified: string | null;
  /** Present when listed with `includeSummary=true`. */
  generatedUtc?: string | null;
  runBy?: string | null;
  pipelineDisplayName?: string | null;
  pipelineId?: string | null;
  pipelineVersion?: string | null;
  imagesProcessed?: number | null;
  appVersion?: string | null;
  accuracyPercent?: number | null;
  averageConfidencePct?: number | null;
  summaryLoaded?: boolean;
}

export interface UnitTestRunListResponse {
  workType: string;
  prefix: string | null;
  prefixes?: string[];
  runs: UnitTestRunIndexRow[];
}

/** One row from CSV IMAGE_DIFFICULTY_BREAKDOWN (d1/d2/d3 = normal / difficult / very difficult). */
export interface UnitTestImageDifficultyTier {
  code: 'd1' | 'd2' | 'd3';
  label: string;
  imageCount: number;
  withGroundTruth: number;
  correct: number;
  accuracyPct: number | null;
  confidencePct: number | null;
}

export interface UnitTestRunDetailResponse {
  key: string;
  summary: UnitTestCsvSummary;
  /** Parsed IMAGE_DIFFICULTY_BREAKDOWN section when present. */
  imageDifficultyBreakdown?: UnitTestImageDifficultyTier[];
  perImageCount: number;
  perImageRows?: Record<string, string>[];
}

/** One row in the pipeline / model iteration registry (S3 JSON). */
export interface PipelineIterationRecord {
  id: string;
  pipeline: string;
  iterationNumber: number;
  modelId: string;
  appVersion: string;
  startDate: string;
  plannedEndDate: string;
  scope: string;
  /** Optional override; “Refresh from portal” can set from `portalStats.totalImages`. */
  imageCount: number | null;
  imagesAddedSinceLastIteration: number | null;
  currentStatus: string;
  /** Optional workflow detail (e.g. In Training, Annotation). */
  subStatus?: string;
  /** Ready to test (simulator) — not started / in progress / completed. */
  readyToTestSimulatorSubStatus?: string;
  /** Ready to test (unit test) — not started / in progress / completed. */
  readyToTestUnitTestSubStatus?: string;
  outcome: string;
  portalStats?: PipelineIterationPortalStats | null;
  manualMetrics?: PipelineIterationManualMetrics | null;
  /** Unit-test CSV exports from S3 attached to this iteration. */
  linkedUnitTests?: PipelineIterationUnitTestLink[];
  /** Portal training datasets (S3 folders) linked to this iteration — not post-train Roboflow model links. */
  linkedTrainingDatasets?: PipelineIterationTrainingDatasetLink[];
  /** Model factory assembly-line stage (see factoryStages.ts). */
  factoryStage?: string | null;
  /** Progress within the current factory stage (not started / in progress / completed). */
  factoryStageSubStatus?: string;
  /** What this release ships: dial finder, keypoint reader, or both. */
  modelShip?: PipelineIterationModelShip | null;
  /** Linked Roboflow projects/versions for this iteration. */
  roboflowLinks?: PipelineIterationRoboflowLinks | null;
  /** YOLO .pt weights stored in S3 for this iteration. */
  modelWeights?: PipelineIterationModelWeights | null;
  /** ISO timestamp — last time this row was saved from the portal. */
  updatedAt?: string | null;
}

export interface PipelineIterationWeightMeta {
  s3Key: string;
  bucket: string;
  uploadedAt: string | null;
  sizeBytes: number | null;
  originalFileName: string | null;
  source?: 'upload' | 'roboflow' | null;
  roboflowFormat?: string | null;
  weightsFolder?: string | null;
  weightsPrefix?: string | null;
}

export interface PipelineIterationModelWeights {
  dialDetection?: PipelineIterationWeightMeta | null;
  keypoint?: PipelineIterationWeightMeta | null;
}

export interface PipelineIterationModelShip {
  dialDetection?: boolean;
  keypoint?: boolean;
  /** Not started / In progress / Completed for Stage A ship track. */
  dialDetectionSubStatus?: string;
  /** Not started / In progress / Completed for Stage B ship track. */
  keypointSubStatus?: string;
}

export interface PipelineIterationRoboflowSplits {
  train?: number | null;
  valid?: number | null;
  test?: number | null;
}

export interface PipelineIterationRoboflowVersionLink {
  datasetSlug: string;
  projectName?: string | null;
  version?: number | null;
  role?: 'dial_detection' | 'keypoint' | null;
  /** e.g. "YOLO26 Keypoint Detection (Small)" */
  modelTypeDisplay?: string | null;
  versionName?: string | null;
  imageCount?: number | null;
  splits?: PipelineIterationRoboflowSplits | null;
  versionCreatedAt?: string | null;
  lastTrainedAt?: string | null;
  trainStatus?: string | null;
  mapPercent?: number | null;
  precisionPercent?: number | null;
  recallPercent?: number | null;
  checkpoint?: string | null;
  /** Roboflow fine-tuned model id, e.g. sempra_keypoint_model/10 */
  modelId?: string | null;
}

export interface PipelineIterationRoboflowLinks {
  dialDetection?: PipelineIterationRoboflowVersionLink | null;
  keypoint?: PipelineIterationRoboflowVersionLink | null;
}

/** Roboflow project created from a portal training dataset (upload target). */
export interface TrainingDatasetRoboflowTraining {
  projectName: string | null;
  projectType: string | null;
  /** Roboflow annotation group slug, e.g. analog-gas-meter */
  annotation?: string | null;
  datasetSlug: string;
  workspaceSlug: string | null;
  projectSlug: string | null;
  annotateUrl: string | null;
  url: string | null;
  createdAt: string | null;
  lastSyncAt: string | null;
  lastSyncUploaded: number | null;
  lastSyncFailed: number | null;
  lastSyncBatch: string | null;
}

export interface PipelineIterationTrainingDatasetLink {
  folderPrefix: string;
  displayName?: string | null;
  linkedAt?: string | null;
  roboflowTraining?: TrainingDatasetRoboflowTraining | null;
}

export interface PipelineIterationsDoc {
  iterations: PipelineIterationRecord[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export async function fetchPipelineIterations(): Promise<PipelineIterationsDoc> {
  try {
    const response = await fetch(`${API_BASE_URL}/pipeline-iterations`);
    const text = await response.text();
    if (!response.ok) {
      const err = parseJsonBody<{ error?: string }>(text, response.status);
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return parseJsonBody<PipelineIterationsDoc>(text, response.status);
  } catch (e) {
    throw wrapFetchNetworkError(e, 'Loading pipeline iterations failed.');
  }
}

export async function fetchUnitTestRuns(
  workType: string,
  options?: { includeSummary?: boolean },
): Promise<UnitTestRunListResponse> {
  const q = new URLSearchParams({ workType });
  if (options?.includeSummary) {
    q.set('includeSummary', 'true');
  }
  try {
    const response = await fetch(`${API_BASE_URL}/unit-test/runs?${q}`);
    const text = await response.text();
    if (!response.ok) {
      const err = parseJsonBody<{ error?: string }>(text, response.status);
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return parseJsonBody<UnitTestRunListResponse>(text, response.status);
  } catch (e) {
    throw wrapFetchNetworkError(e, 'Listing unit test results failed.');
  }
}

export async function fetchUnitTestRunDetail(
  s3Key: string,
  options?: { includeRows?: boolean },
): Promise<UnitTestRunDetailResponse> {
  const q = new URLSearchParams({ s3Key });
  if (options?.includeRows !== true) {
    q.set('includeRows', 'false');
  }
  try {
    const response = await fetch(`${API_BASE_URL}/unit-test/run-detail?${q}`);
    const text = await response.text();
    if (!response.ok) {
      const err = parseJsonBody<{ error?: string }>(text, response.status);
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return parseJsonBody<UnitTestRunDetailResponse>(text, response.status);
  } catch (e) {
    throw wrapFetchNetworkError(e, 'Reading unit test file failed.');
  }
}

export async function fetchUnitTestRunDownloadUrl(
  s3Key: string,
): Promise<{ url: string; expiresInSeconds: number }> {
  const q = new URLSearchParams({ s3Key });
  try {
    const response = await fetch(`${API_BASE_URL}/unit-test/download-url?${q}`);
    const text = await response.text();
    if (!response.ok) {
      const err = parseJsonBody<{ error?: string }>(text, response.status);
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return parseJsonBody<{ url: string; expiresInSeconds: number }>(text, response.status);
  } catch (e) {
    throw wrapFetchNetworkError(e, 'Unit test file download failed.');
  }
}

export type FieldTestCycleStatus = 'draft' | 'active' | 'closed';

export interface FieldTestCycle {
  id: string;
  name: string;
  workType: string;
  startDate: string;
  endDate: string;
  status: FieldTestCycleStatus;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FieldTestCyclesResponse {
  workType: string;
  key: string | null;
  updatedAt: string | null;
  cycles: FieldTestCycle[];
  activeCycle: FieldTestCycle | null;
}

export interface FieldTestCaptureRow {
  sessionId: string;
  s3SessionPrefix?: string;
  s3Bucket?: string;
  primaryImageKey?: string;
  capturedAt: string;
  capturedBy: string;
  finalReading: string | null;
  predictedReading: string | null;
  imageDifficulty: ImageDifficulty;
  onTickDialCount: number | null;
  readsCorrectedCount: number;
  /** Device and/or portal reviewer correction. */
  hadUserCorrection: boolean;
  /** Portal reviewer email when metadata was saved after review. */
  correctedBy?: string | null;
  /** ISO time of portal metadata save (`portal_metadata_updated_at`). */
  correctedAt?: string | null;
  /** True when only on-device dial edits exist (no portal reviewer on record). */
  correctedOnDevice?: boolean;
  dialCount: number;
  confidence: number | null;
  appVersion: string | null;
  captureTrigger?: string | null;
  imageSource?: string | null;
  /** Presigned guided crop (original.jpg). */
  url?: string;
  /** Presigned full-frame photo when available. */
  fullMeterUrl?: string;
}

export interface FieldTestCapturesResponse {
  workType: string;
  cycle: FieldTestCycle | null;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  captures: FieldTestCaptureRow[];
  filterOptions: FieldTestCaptureFilterOptions;
}

export interface FieldTestCityFilterOption {
  id: string;
  label: string;
  count: number;
}

export interface FieldTestCaptureFilterOptions {
  users: string[];
  cities: FieldTestCityFilterOption[];
}

export interface FieldTestReadingsListResponse {
  workType: string;
  cycle: FieldTestCycle | null;
  format: 'readings';
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  readings: S3MeterReading[];
  filterOptions: FieldTestCaptureFilterOptions;
}

/** Bump when rollup `perImageRows` shape changes; client auto-refreshes older cached rollups. */
export const FIELD_TEST_ANALYTICS_MIN_VERSION = 9;

export interface FieldTestRollup {
  version: number;
  cycleId: string;
  cycleName: string;
  workType: string;
  startDate: string;
  endDate: string;
  builtAt: string;
  /** All field captures in the cycle date range (before correct/incorrect filter). */
  cycleCaptureCount?: number;
  /** Excluded from metrics (no dials, not sure, etc.). */
  excludedFromResultsCount?: number;
  captureCount: number;
  totalReads: number;
  readsWithGroundTruth: number;
  readsCorrect: number;
  readsCorrected: number;
  /** Reviewer marked capture incorrect (session verdict). */
  capturesMarkedIncorrect?: number;
  /** Sum of user_incorrect_dial_numbers / reads_corrected_count when present. */
  explicitDialCorrections?: number;
  /** Dials where model digit ≠ reviewer ground truth. */
  dialsModelWrong?: number;
  correctionPct: number | null;
  summary: UnitTestCsvSummary;
  imageDifficultyBreakdown: UnitTestImageDifficultyTier[];
  perImageRows: Record<string, string>[];
  perImageCount: number;
}

export interface FieldTestCycleAnalyticsResponse {
  source: 'rollup' | 'computed';
  cycle: FieldTestCycle;
  rollup: FieldTestRollup;
  rollupKey: string;
}

export async function fetchFieldTestCycles(workType: string): Promise<FieldTestCyclesResponse> {
  const q = new URLSearchParams({ workType });
  try {
    const response = await fetch(`${API_BASE_URL}/field-test/cycles?${q}`);
    const text = await response.text();
    if (!response.ok) {
      const err = parseJsonBody<{ error?: string }>(text, response.status);
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return parseJsonBody<FieldTestCyclesResponse>(text, response.status);
  } catch (e) {
    throw wrapFetchNetworkError(e, 'Loading field test cycles failed.');
  }
}

export async function deleteFieldTestCycle(
  workType: string,
  cycleId: string,
): Promise<{ cycles: FieldTestCycle[] }> {
  const q = new URLSearchParams({ workType });
  try {
    const response = await fetch(`${API_BASE_URL}/field-test/cycles/${encodeURIComponent(cycleId)}?${q}`, {
      method: 'DELETE',
    });
    const text = await response.text();
    if (!response.ok) {
      const err = parseJsonBody<{ error?: string }>(text, response.status);
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return parseJsonBody(text, response.status);
  } catch (e) {
    throw wrapFetchNetworkError(e, 'Deleting field test cycle failed.');
  }
}

export async function updateFieldTestCycle(
  workType: string,
  cycleId: string,
  patch: {
    name?: string;
    startDate?: string;
    endDate?: string;
    status?: FieldTestCycleStatus;
    notes?: string;
  },
): Promise<{ cycle: FieldTestCycle; cycles: FieldTestCycle[] }> {
  try {
    const response = await fetch(`${API_BASE_URL}/field-test/cycles/${encodeURIComponent(cycleId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workType, ...patch }),
    });
    const text = await response.text();
    if (!response.ok) {
      const err = parseJsonBody<{ error?: string }>(text, response.status);
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return parseJsonBody(text, response.status);
  } catch (e) {
    throw wrapFetchNetworkError(e, 'Updating field test cycle failed.');
  }
}

export async function createFieldTestCycle(payload: {
  workType: string;
  name: string;
  startDate: string;
  endDate: string;
  status?: FieldTestCycleStatus;
  notes?: string;
}): Promise<{ cycle: FieldTestCycle; cycles: FieldTestCycle[] }> {
  try {
    const response = await fetch(`${API_BASE_URL}/field-test/cycles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) {
      const err = parseJsonBody<{ error?: string }>(text, response.status);
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return parseJsonBody(text, response.status);
  } catch (e) {
    throw wrapFetchNetworkError(e, 'Creating field test cycle failed.');
  }
}

/** Download field-test cycle CSV (summary + per-capture rows with location, tilt, dial angles). */
export async function downloadFieldTestCycleCsv(workType: string, cycleId: string): Promise<void> {
  const q = new URLSearchParams({ workType });
  const url = `${API_BASE_URL}/field-test/cycles/${encodeURIComponent(cycleId)}/export.csv?${q}`;
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    let message = `Export failed (${response.status})`;
    try {
      const err = JSON.parse(text) as { error?: string };
      if (err.error) message = err.error;
    } catch {
      if (text.trim()) message = text.trim().slice(0, 200);
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const m = /filename="?([^";]+)"?/i.exec(disposition);
  const fileName = m?.[1]?.trim() || `field_test_${cycleId}.csv`;
  await downloadBlobAsFile(blob, fileName);
}

export async function fetchFieldTestCycleAnalytics(
  workType: string,
  cycleId: string,
  options?: { refresh?: boolean },
): Promise<FieldTestCycleAnalyticsResponse> {
  const q = new URLSearchParams({ workType });
  if (options?.refresh) {
    q.set('refresh', '1');
    q.set('_t', String(Date.now()));
  }
  try {
    const response = await fetch(`${API_BASE_URL}/field-test/cycles/${encodeURIComponent(cycleId)}/analytics?${q}`, {
      cache: options?.refresh ? 'no-store' : 'default',
    });
    const text = await response.text();
    if (!response.ok) {
      const err = parseJsonBody<{ error?: string }>(text, response.status);
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return parseJsonBody<FieldTestCycleAnalyticsResponse>(text, response.status);
  } catch (e) {
    throw wrapFetchNetworkError(e, 'Loading field test analytics failed.');
  }
}

export async function fetchFieldTestCaptures(
  workType: string,
  options?: {
    cycleId?: string;
    page?: number;
    limit?: number;
    q?: string;
    difficulty?: string;
    user?: string;
    corrected?: string;
    location?: string;
    captureTrigger?: string;
    datePreset?: string;
    sortDir?: 'asc' | 'desc';
    presign?: boolean;
    format?: 'captures' | 'readings';
    refresh?: boolean;
  },
): Promise<FieldTestCapturesResponse | FieldTestReadingsListResponse> {
  const q = new URLSearchParams({ workType });
  if (options?.cycleId) q.set('cycleId', options.cycleId);
  if (options?.refresh) q.set('refresh', '1');
  if (options?.page) q.set('page', String(options.page));
  if (options?.limit) q.set('limit', String(options.limit));
  if (options?.q) q.set('q', options.q);
  if (options?.difficulty) q.set('difficulty', options.difficulty);
  if (options?.user) q.set('user', options.user);
  if (options?.corrected) q.set('corrected', options.corrected);
  if (options?.location && options.location !== 'all') q.set('location', options.location);
  if (options?.captureTrigger && options.captureTrigger !== 'all') {
    q.set('captureTrigger', options.captureTrigger);
  }
  if (options?.datePreset && options.datePreset !== 'all') {
    q.set('datePreset', options.datePreset);
  }
  if (options?.sortDir) q.set('sortDir', options.sortDir);
  if (options?.format === 'readings') q.set('format', 'readings');
  if (options?.presign) q.set('presign', '1');
  try {
    const response = await fetch(`${API_BASE_URL}/field-test/captures?${q}`);
    const text = await response.text();
    if (!response.ok) {
      const err = parseJsonBody<{ error?: string }>(text, response.status);
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    return parseJsonBody(text, response.status);
  } catch (e) {
    throw wrapFetchNetworkError(e, 'Listing field test captures failed.');
  }
}

export async function presignFieldTestCaptureUrls(
  sessions: Pick<FieldTestCaptureRow, 'sessionId' | 's3SessionPrefix' | 's3Bucket' | 'primaryImageKey'>[],
): Promise<Record<string, string>> {
  const response = await fetch(`${API_BASE_URL}/field-test/captures/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessions }),
  });
  const text = await response.text();
  if (!response.ok) {
    const err = parseJsonBody<{ error?: string }>(text, response.status);
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  const data = parseJsonBody<{ urls?: Record<string, string> }>(text, response.status);
  return data.urls || {};
}

export type PipelineIterationWeightRole = 'dial_detection' | 'keypoint';

export interface UploadPipelineIterationWeightsResponse {
  ok: boolean;
  role: PipelineIterationWeightRole;
  weights: PipelineIterationWeightMeta;
}

export interface PullPipelineIterationWeightsFromRoboflowResponse
  extends UploadPipelineIterationWeightsResponse {
  roboflow?: {
    format: string;
    exportLink: string;
    modelTypeDisplay?: string | null;
    modelType?: string | null;
  };
}

export type PipelineIterationWeightContext = Pick<
  PipelineIterationRecord,
  'pipeline' | 'iterationNumber' | 'modelId'
>;

export async function uploadPipelineIterationWeight(
  iterationId: string,
  role: PipelineIterationWeightRole,
  file: File,
  context?: PipelineIterationWeightContext,
): Promise<UploadPipelineIterationWeightsResponse> {
  const fd = new FormData();
  fd.set('iterationId', iterationId);
  fd.set('role', role);
  fd.set('file', file, file.name);
  if (context?.pipeline) fd.set('pipeline', context.pipeline);
  if (context?.iterationNumber != null) fd.set('iterationNumber', String(context.iterationNumber));
  if (context?.modelId) fd.set('modelId', context.modelId);
  const response = await fetch(`${API_BASE_URL}/pipeline-iterations/weights`, {
    method: 'POST',
    body: fd,
  });
  const text = await response.text();
  if (!response.ok) {
    const err = parseJsonBody<{ error?: string }>(text, response.status);
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return parseJsonBody<UploadPipelineIterationWeightsResponse>(text, response.status);
}

export async function pullPipelineIterationWeightFromRoboflow(
  payload: {
    iterationId: string;
    role: PipelineIterationWeightRole;
    datasetSlug?: string;
    version?: number;
    format?: string;
    roboflowLinks?: PipelineIterationRoboflowLinks | null;
    pipeline?: string;
    iterationNumber?: number;
    modelId?: string;
  },
): Promise<PullPipelineIterationWeightsFromRoboflowResponse> {
  const response = await fetch(`${API_BASE_URL}/pipeline-iterations/weights/from-roboflow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    const err = parseJsonBody<{ error?: string }>(text, response.status);
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return parseJsonBody<PullPipelineIterationWeightsFromRoboflowResponse>(text, response.status);
}

export async function fetchPipelineIterationWeightSignedUrl(
  iterationId: string,
  role: PipelineIterationWeightRole,
  context?: PipelineIterationWeightContext,
): Promise<TrainingWeightsSignedUrlResponse> {
  const params = new URLSearchParams({ iterationId, role });
  if (context?.pipeline) params.set('pipeline', context.pipeline);
  if (context?.iterationNumber != null) params.set('iterationNumber', String(context.iterationNumber));
  if (context?.modelId) params.set('modelId', context.modelId);
  const response = await fetch(
    `${API_BASE_URL}/pipeline-iterations/weights-signed-url?${params.toString()}`,
  );
  const text = await response.text();
  if (!response.ok) {
    const err = parseJsonBody<{ error?: string }>(text, response.status);
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return parseJsonBody<TrainingWeightsSignedUrlResponse>(text, response.status);
}

/** Fired after registry JSON is saved so other pages reload from S3. */
export const PIPELINE_REGISTRY_UPDATED_EVENT = 'pipeline-registry-updated';

export function notifyPipelineRegistryUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PIPELINE_REGISTRY_UPDATED_EVENT));
  }
}

export async function savePipelineIterations(
  userEmail: string | undefined,
  iterations: PipelineIterationRecord[],
): Promise<PipelineIterationsDoc> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (userEmail) headers['x-user-email'] = userEmail;
  const response = await fetch(`${API_BASE_URL}/pipeline-iterations`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ iterations }),
  });
  const text = await response.text();
  if (!response.ok) {
    const err = parseJsonBody<{ error?: string }>(text, response.status);
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  const doc = parseJsonBody<PipelineIterationsDoc>(text, response.status);
  notifyPipelineRegistryUpdated();
  return doc;
}

export interface WorkTypeInfo {
  code: WorkType;
  name: string;
}

export async function fetchWorkTypes(): Promise<WorkTypeInfo[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/work-types`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch work types:', error);
    throw error;
  }
}

export async function fetchReadings(
  source?: DataSource,
  workType?: WorkType,
  refresh = false,
): Promise<S3MeterReading[]> {
  try {
    const params = new URLSearchParams();
    if (source && source !== 'all') params.set('source', source);
    if (workType) params.set('workType', workType);
    if (refresh) params.set('refresh', '1');

    const url = params.toString()
      ? `${API_BASE_URL}/readings?${params}`
      : `${API_BASE_URL}/readings`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch readings:', error);
    throw error;
  }
}

export interface ModelVersionStats {
  appVersion: string;
  sessions: number;
  /** Total image files across sessions (original + dial crops, etc.). */
  imageCount?: number;
  statusCounts: Record<string, number>;
  correctCount: number;
  incorrectTotal: number;
  notSureCount: number;
  noDialsCount: number;
  queueCorrectRate: number;
  queueIncorrectRate: number;
  notSureRate: number;
  noDialsRate: number;
  avgConfidence: number | null;
  avgProcessingTimeMs: number | null;
  avgDialCount: number | null;
  fieldCount: number;
  simulatorCount: number;
  firstSessionAt: string | null;
  lastSessionAt: string | null;
}

export interface ModelAnalyticsResponse {
  currentVersion: string | null;
  versions: ModelVersionStats[];
  computedAt: string;
}

export interface UsageDayRow {
  date: string;
  sessions: number;
  images: number;
  distinctUsers: number;
}

export interface UsageUserRow {
  userKey: string;
  sessions: number;
  images: number;
  lastSeen: string;
}

export interface UsageSummaryResponse {
  workType: string;
  source: string;
  daysEffective: number;
  totals: { sessions: number; images: number; distinctUsers: number };
  byDay: UsageDayRow[];
  byUser: UsageUserRow[];
  windowStartUtc: string;
  windowEndUtc: string;
  sessionCountAllScanned: number;
  sessionCountInWindow: number;
  computedAt: string;
  note?: string;
}

export async function fetchModelAnalytics(
  source?: DataSource,
  workType?: WorkType,
): Promise<ModelAnalyticsResponse> {
  const params = new URLSearchParams();
  if (source && source !== 'all') params.set('source', source);
  if (workType) params.set('workType', workType);
  const q = params.toString();
  const url = q ? `${API_BASE_URL}/model-analytics?${q}` : `${API_BASE_URL}/model-analytics`;
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    const t = text.trim();
    let msg = `HTTP ${response.status}`;
    if (t.startsWith('<')) {
      msg =
        'API returned HTML instead of JSON. Start the Node API: `npm run server` (port 3001), and keep the UI on `npm run dev` so `/api` proxies to it.';
    } else if (t.startsWith('{')) {
      try {
        const j = JSON.parse(t) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* keep msg */
      }
    }
    throw new Error(msg);
  }
  return parseJsonBody<ModelAnalyticsResponse>(text, response.status);
}

export async function fetchUsageSummary(
  source: DataSource | undefined,
  workType: WorkType,
  days: number,
): Promise<UsageSummaryResponse> {
  const params = new URLSearchParams();
  if (source && source !== 'all') params.set('source', source);
  if (workType) params.set('workType', workType);
  params.set('days', String(Math.min(90, Math.max(1, days))));
  const url = `${API_BASE_URL}/usage-summary?${params.toString()}`;
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    const t = text.trim();
    let msg = `HTTP ${response.status}`;
    if (t.startsWith('<')) {
      msg =
        'API returned HTML instead of JSON. Start the Node API: `npm run server` (port 3001), and keep the UI on `npm run dev` so `/api` proxies to it.';
    } else if (t.startsWith('{')) {
      try {
        const j = JSON.parse(t) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* keep msg */
      }
    }
    throw new Error(msg);
  }
  return parseJsonBody<UsageSummaryResponse>(text, response.status);
}

export async function fetchCounts(source?: DataSource, workType?: WorkType): Promise<DashboardCounts> {
  try {
    const params = new URLSearchParams();
    if (source && source !== 'all') params.set('source', source);
    if (workType) params.set('workType', workType);
    
    const url = params.toString()
      ? `${API_BASE_URL}/counts?${params}`
      : `${API_BASE_URL}/counts`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch counts:', error);
    throw error;
  }
}

export type ImprovementChartRange = 'all' | '1d' | '7d' | '14d' | '30d';

export interface ImprovementStatsResponse {
  bins: import('../utils/dashboardImprovementStats').ImprovementStoryBin[];
  /** Per app_version rollups from analytics index (replaces heavy model-analytics on dashboard). */
  versionSummary?: ModelVersionStats[];
  windowSessionCount: number;
  totalIndexedSessions: number;
  computedAt: string;
  range: ImprovementChartRange;
  storage?: { bucket: string; key: string; uri: string };
  /** Index empty — background S3 scan started. */
  building?: boolean;
  /** Refresh requested — serving cached index while backfill runs. */
  rebuilding?: boolean;
}

export async function fetchImprovementStats(
  source?: DataSource,
  workType?: WorkType,
  range: ImprovementChartRange = 'all',
  refresh = false,
): Promise<ImprovementStatsResponse> {
  try {
    const params = new URLSearchParams();
    if (source && source !== 'all') params.set('source', source);
    if (workType) params.set('workType', workType);
    if (range && range !== 'all') params.set('range', range);
    if (refresh) params.set('refresh', '1');
    const url = params.toString()
      ? `${API_BASE_URL}/improvement-stats?${params}`
      : `${API_BASE_URL}/improvement-stats`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch improvement stats:', error);
    throw error;
  }
}

export async function fetchReadingById(
  id: string,
  workType?: WorkType,
  s3SessionPrefix?: string,
): Promise<S3MeterReading | null> {
  try {
    const params = new URLSearchParams();
    if (workType) params.set('workType', workType);
    if (s3SessionPrefix) params.set('s3SessionPrefix', s3SessionPrefix);
    const q = params.toString() ? `?${params}` : '';
    const response = await fetch(`${API_BASE_URL}/readings/${encodeURIComponent(id)}${q}`);
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch reading:', error);
    throw error;
  }
}

/** Allowed keys for `PATCH /api/readings/:id/metadata` (merged into S3 `metadata.json`). */
export type SessionMetadataPatch = {
  user_correction?: string;
  ml_prediction?: string;
  ml_raw_prediction?: string | null;
  dial_count?: number;
  dial_details?: DialDetailFromMetadata[];
  is_correct?: boolean;
  condition_code?: string | null;
  portal_review_notes?: string;
  /** @deprecated Use reviewer_dataset_destination */
  reviewer_recommend_training?: boolean;
  reviewer_dataset_destination?: 'training' | 'test' | null;
  image_difficulty?: 'normal' | 'difficult' | 'very_difficult' | null;
  /** Portal reviewer save sets true in metadata.json (replaces legacy `is_human_reviewed` on write). */
  is_manually_reviewed?: boolean;
  confidence?: number;
  processing_time_ms?: number;
};

export async function patchSessionMetadata(
  sessionId: string,
  workType: WorkType | undefined,
  body: { s3SessionPrefix: string; patch: SessionMetadataPatch },
  userEmail?: string,
  /** Server rejects metadata PATCH unless this is `reviewer`. */
  portalWorkMode: PortalWorkMode = 'reviewer',
): Promise<S3MeterReading> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-portal-work-mode': portalWorkModeForMetadataHeader(portalWorkMode),
  };
  if (userEmail) headers['x-user-email'] = userEmail;
  const response = await fetch(`${API_BASE_URL}/readings/${encodeURIComponent(sessionId)}/metadata`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      workType: workType || undefined,
      s3SessionPrefix: body.s3SessionPrefix,
      patch: body.patch,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    const err = parseJsonBody<{ error?: string }>(text, response.status);
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return parseJsonBody<S3MeterReading>(text, response.status);
}

export async function checkHealth(): Promise<{ status: string; buckets: string[] }> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    return await response.json();
  } catch {
    return { status: 'error', buckets: [] };
  }
}

export interface BulkMoveRequest {
  sessionId: string;
  sourceType: 'field' | 'simulator';
  currentStatus: string;
  targetStatus: string;
  s3SessionPrefix?: string;
}

/** Optional filters for list ZIP export (single day wins over range; app version matches metadata bucket). */
export type ListExportDateOpts = {
  date?: string;
  from?: string;
  to?: string;
  /** Exact tag after portal normalization (omit or empty in metadata → use `unknown`). */
  appVersion?: string;
};

/**
 * ZIP sessions matching the readings list (work type, source, list route, optional day or from/to range).
 * Flat root: raw full-frame images + dataset.json (Roboflow-friendly; no per-session folders or metadata.json).
 */
export async function downloadListRetrainZip(
  source: DataSource | undefined,
  workType: WorkType,
  listStatus: string,
  dateOpts?: ListExportDateOpts,
): Promise<void> {
  const params = new URLSearchParams({ workType, listStatus });
  if (source && source !== 'all') params.set('source', source);
  if (dateOpts?.date && /^\d{4}-\d{2}-\d{2}$/.test(dateOpts.date)) {
    params.set('date', dateOpts.date);
  } else if (
    dateOpts?.from &&
    dateOpts?.to &&
    /^\d{4}-\d{2}-\d{2}$/.test(dateOpts.from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(dateOpts.to)
  ) {
    params.set('from', dateOpts.from);
    params.set('to', dateOpts.to);
  }
  if (dateOpts?.appVersion != null && String(dateOpts.appVersion).trim() !== '') {
    params.set('appVersion', String(dateOpts.appVersion).trim());
  }
  const res = await fetch(`${API_BASE_URL}/export/list-retrain-zip?${params.toString()}`);
  const ct = res.headers.get('Content-Type') || '';
  if (!res.ok) {
    if (ct.includes('application/json')) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    throw new Error(`HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition');
  const match = cd?.match(/filename="([^"]+)"/);
  const filename = match?.[1] || `sessions-flat-${listStatus}-${workType}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Flat ZIP of incorrect-queue sessions (same as list export with listStatus=incorrect-queues). */
export async function downloadIncorrectRetrainZip(
  source: DataSource | undefined,
  workType: WorkType,
): Promise<void> {
  return downloadListRetrainZip(source, workType, 'incorrect-queues');
}

/** Flat ZIP for one session (raw photos + dataset.json at root) for Roboflow / labeling. */
export async function downloadSessionRetrainZip(sessionId: string, workType: WorkType): Promise<void> {
  const params = new URLSearchParams({ sessionId, workType });
  const res = await fetch(`${API_BASE_URL}/export/session-retrain-zip?${params.toString()}`);
  const ct = res.headers.get('Content-Type') || '';
  if (!res.ok) {
    if (ct.includes('application/json')) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    throw new Error(`HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition');
  const match = cd?.match(/filename="([^"]+)"/);
  const filename = match?.[1] || `session-flat-${sessionId}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** `weights.pt` stored at `{folderPrefix}model/weights.pt` — see `dataset.json` weights block. */
export interface TrainingPipelineWeightsSummary {
  s3Key: string | null;
  uploadedAt: string | null;
  sizeBytes: number | null;
  originalFileName: string | null;
}

export interface TrainingDatasetRow {
  folderPrefix: string;
  displayName: string;
  createdAt: string | null;
  slug: string | null;
  timestamp: number | null;
  manifestMissing?: boolean;
  /** Distinct session ids ever copied into this folder (from manifest). */
  copiedSessionCount?: number;
  lastCopyAt?: string | null;
  weights?: TrainingPipelineWeightsSummary | null;
  /** Portal-linked Roboflow project for training uploads (not iteration model-version links). */
  roboflowTraining?: TrainingDatasetRoboflowTraining | null;
}

export interface CopySessionsToTrainingDatasetResult {
  ok: boolean;
  copied: Array<{ sessionId: string; objectCount: number; destinationPrefix: string }>;
  errors: Array<{ sessionId: string; error: string }>;
}

export interface TrainingCopiedSessionPreview {
  sessionId: string;
  thumbUrl: string | null;
  /** Count of raw/full-frame images in the session copy (excludes `dial_*` crops). */
  imageCount: number;
}

export interface TrainingCopiedSessionsPreviewResponse {
  folderPrefix: string;
  sessions: TrainingCopiedSessionPreview[];
}

export async function fetchCopiedSessionsPreview(
  folderPrefix: string,
): Promise<TrainingCopiedSessionsPreviewResponse> {
  const params = new URLSearchParams();
  params.set('folderPrefix', folderPrefix);
  const response = await fetch(
    `${API_BASE_URL}/training-datasets/copied-sessions-preview?${params.toString()}`,
  );
  const text = await response.text();
  if (!response.ok) {
    const err = parseJsonBody<{ error?: string }>(text, response.status);
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return parseJsonBody<TrainingCopiedSessionsPreviewResponse>(text, response.status);
}

export async function copySessionsToTrainingDataset(
  folderPrefix: string,
  sessions: Array<{ sessionId: string; s3SessionPrefix?: string; workType?: WorkType }>,
): Promise<CopySessionsToTrainingDatasetResult> {
  const response = await fetch(`${API_BASE_URL}/training-datasets/copy-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPrefix, sessions }),
  });
  const text = await response.text();
  if (!response.ok) {
    const err = parseJsonBody<{ error?: string }>(text, response.status);
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return parseJsonBody<CopySessionsToTrainingDatasetResult>(text, response.status);
}

/** ZIP all objects under a training-dataset prefix (includes dataset.json and sessions/*). */
export interface WeightsSessionPromotionSummary {
  enabled: boolean;
  sessionCountConsidered: number;
  moved: number;
  skippedAlready: number;
  skippedNotInPipeline: number;
  notFound: number;
  moveFailed: number;
}

export interface UploadTrainingWeightsResponse {
  ok: boolean;
  weights: {
    s3Key: string;
    bucket: string;
    relativeKey: string;
    uploadedAt: string;
    sizeBytes: number;
    originalFileName: string;
    contentType: string;
  };
  sessionPromotion?: WeightsSessionPromotionSummary;
}

export async function uploadTrainingDatasetWeights(
  folderPrefix: string,
  file: File,
  userEmail?: string | null,
): Promise<UploadTrainingWeightsResponse> {
  const fd = new FormData();
  fd.set('folderPrefix', folderPrefix);
  fd.set('file', file, file.name);
  const headers: Record<string, string> = {};
  if (userEmail && String(userEmail).trim()) {
    headers['x-user-email'] = String(userEmail).trim();
  }
  const response = await fetch(`${API_BASE_URL}/training-datasets/weights`, {
    method: 'POST',
    headers,
    body: fd,
  });
  const text = await response.text();
  if (!response.ok) {
    const err = parseJsonBody<{ error?: string }>(text, response.status);
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return parseJsonBody<UploadTrainingWeightsResponse>(text, response.status);
}

export interface TrainingWeightsSignedUrlResponse {
  url: string;
  expiresInSeconds: number;
  bucket: string;
  key: string;
}

export async function fetchTrainingWeightsSignedUrl(
  folderPrefix: string,
): Promise<TrainingWeightsSignedUrlResponse> {
  const params = new URLSearchParams();
  params.set('folderPrefix', folderPrefix);
  const response = await fetch(`${API_BASE_URL}/training-datasets/weights-signed-url?${params.toString()}`);
  const text = await response.text();
  if (!response.ok) {
    const err = parseJsonBody<{ error?: string }>(text, response.status);
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return parseJsonBody<TrainingWeightsSignedUrlResponse>(text, response.status);
}

export async function downloadTrainingDatasetZip(folderPrefix: string): Promise<void> {
  const params = new URLSearchParams();
  params.set('folderPrefix', folderPrefix);
  const res = await fetch(`${API_BASE_URL}/export/training-dataset-zip?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text();
    let msg = `HTTP ${res.status}`;
    try {
      const err = JSON.parse(text) as { error?: string };
      if (err?.error) msg = err.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition');
  const match = cd?.match(/filename="([^"]+)"/);
  const filename = match?.[1] || `training-dataset-${Date.now()}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface TrainingDatasetsResponse {
  bucket: string;
  rootPrefix: string;
  trainingDatasetsSegment: string;
  datasets: TrainingDatasetRow[];
}

export async function fetchTrainingDatasets(): Promise<TrainingDatasetsResponse> {
  const response = await fetch(`${API_BASE_URL}/training-datasets`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseJsonBody<{ error?: string }>(text, response.status).error || `HTTP ${response.status}`);
  }
  return parseJsonBody<TrainingDatasetsResponse>(text, response.status);
}

export interface CreateTrainingDatasetResponse {
  schemaVersion: number;
  displayName: string;
  createdAt: string;
  folderPrefix: string;
  slug: string;
  timestamp: number;
  note?: string;
  key: string;
  bucket: string;
}

export async function createTrainingDataset(name: string): Promise<CreateTrainingDatasetResponse> {
  const response = await fetch(`${API_BASE_URL}/training-datasets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() }),
  });
  const text = await response.text();
  if (!response.ok) {
    const err = parseJsonBody<{ error?: string }>(text, response.status);
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return parseJsonBody<CreateTrainingDatasetResponse>(text, response.status);
}

export type TrainingDatasetRoboflowProjectType = 'object-detection';

/** Roboflow annotation group for portal training datasets (spaces → hyphens in API). */
export const TRAINING_DATASET_ROBOFLOW_ANNOTATION = 'analog-gas-meter';

/** Portal create-project disabled until keypoint REST create is supported. */
export const TRAINING_DATASET_ROBOFLOW_CREATE_ENABLED = false;

/** @deprecated Create disabled — kept for when keypoint create is re-enabled. */
export async function createTrainingDatasetRoboflowProject(
  folderPrefix: string,
  opts?: {
    projectName?: string;
    projectType?: TrainingDatasetRoboflowProjectType;
    annotation?: string;
  },
): Promise<{
  ok: boolean;
  folderPrefix: string;
  roboflowTraining: TrainingDatasetRoboflowTraining;
  displayName: string;
}> {
  if (!TRAINING_DATASET_ROBOFLOW_CREATE_ENABLED) {
    throw new Error(
      'Creating Roboflow projects from the portal is disabled (keypoint-detection required). Create in Roboflow app and link later.',
    );
  }
  const response = await fetch(`${API_BASE_URL}/training-datasets/roboflow/create-project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folderPrefix,
      projectName: opts?.projectName,
      projectType: opts?.projectType ?? 'object-detection',
      annotation: opts?.annotation ?? TRAINING_DATASET_ROBOFLOW_ANNOTATION,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseJsonBody<{ error?: string }>(text, response.status).error || `HTTP ${response.status}`);
  }
  return parseJsonBody(text, response.status);
}

export async function syncTrainingDatasetToRoboflow(
  folderPrefix: string,
  split: 'train' | 'valid' | 'test' = 'train',
): Promise<{
  ok: boolean;
  uploaded: number;
  failed: number;
  batch: string;
  annotateUrl: string | null;
  roboflowTraining: TrainingDatasetRoboflowTraining;
}> {
  const response = await fetch(`${API_BASE_URL}/training-datasets/roboflow/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPrefix, split }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseJsonBody<{ error?: string }>(text, response.status).error || `HTTP ${response.status}`);
  }
  return parseJsonBody(text, response.status);
}

export interface UnitTestImageRow {
  s3Key: string;
  fileName: string;
  expectedMeterValue: string | null;
  imageDifficulty?: ImageDifficulty | null;
  url?: string;
  size?: number;
  lastModified?: string | null;
  /** From metrics CSV when opened via confusion matrix (filename ground truth). */
  groundTruthReading?: string | null;
  /** From metrics CSV when opened via confusion matrix (model output). */
  predictedReading?: string | null;
}

export interface UnitTestManifestRow {
  image_file_name: string;
  expected_meter_value: string;
  s3_key: string;
  image_difficulty: ImageDifficulty;
  /** Copied from source session metadata on test-data approve (optional). */
  capture_location?: CaptureLocation | null;
  /** Original Dynamo/S3 session id when promoted from a capture folder. */
  source_session_id?: string;
}

export async function downloadBlobAsFile(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadUrlAsFile(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  await downloadBlobAsFile(blob, filename);
}

export async function fetchUnitTestImages(
  workType: WorkType,
  options?: { presignAll?: boolean },
): Promise<{
  prefix: string;
  manifestKey: string;
  images: UnitTestImageRow[];
  manifestRows?: UnitTestManifestRow[];
}> {
  const params = new URLSearchParams({ workType });
  if (options?.presignAll) params.set('presign', '1');
  const response = await fetch(`${API_BASE_URL}/test-data/unit-test-images?${params}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseJsonBody<{ error?: string }>(text, response.status).error || `HTTP ${response.status}`);
  }
  return parseJsonBody(text, response.status);
}

/** Download one unit test image via API (avoids S3 CORS on presigned fetch). */
export async function downloadUnitTestImage(
  workType: WorkType,
  s3Key: string,
  fileName: string,
): Promise<void> {
  const params = new URLSearchParams({ workType, s3Key });
  const res = await fetch(`${API_BASE_URL}/test-data/unit-test-images/download?${params}`);
  const ct = res.headers.get('Content-Type') || '';
  if (!res.ok) {
    if (ct.includes('application/json')) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    throw new Error(`HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition');
  const match = cd?.match(/filename="([^"]+)"/);
  await downloadBlobAsFile(blob, match?.[1] || fileName);
}

/**
 * ZIP of all flat unit test images plus unittestng_manifest.json.
 * Uses a native browser download (not fetch+blob) so large archives stream without hanging.
 */
export function downloadUnitTestImagesZip(workType: WorkType): void {
  const params = new URLSearchParams({ workType });
  const url = `${API_BASE_URL}/test-data/unit-test-images/download-zip?${params.toString()}`;
  const a = document.createElement('a');
  a.href = url;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function presignUnitTestImages(s3Keys: string[]): Promise<Record<string, string>> {
  const response = await fetch(`${API_BASE_URL}/test-data/unit-test-images/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ s3Keys }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseJsonBody<{ error?: string }>(text, response.status).error || `HTTP ${response.status}`);
  }
  const data = parseJsonBody<{ urls: Record<string, string> }>(text, response.status);
  return data.urls || {};
}

/** Same-origin image URL (streams via API; avoids stale presigns and S3 CORS). */
export function unitTestImageDownloadUrl(workType: WorkType, s3Key: string): string {
  const params = new URLSearchParams({ workType, s3Key });
  return `${API_BASE_URL}/test-data/unit-test-images/download?${params}`;
}

export async function fetchUnitTestImageByFileName(
  workType: WorkType,
  fileName: string,
): Promise<UnitTestImageRow> {
  const params = new URLSearchParams({ workType });
  const response = await fetch(
    `${API_BASE_URL}/test-data/unit-test-images/by-file/${encodeURIComponent(fileName)}?${params}`,
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseJsonBody<{ error?: string }>(text, response.status).error || `HTTP ${response.status}`);
  }
  return parseJsonBody<UnitTestImageRow>(text, response.status);
}

export async function updateUnitTestImageExpected(
  workType: WorkType,
  s3Key: string,
  expectedMeterValue: string,
  imageDifficulty?: ImageDifficulty | null,
  portalWorkMode: PortalWorkMode = 'test_data_reviewer',
): Promise<{
  ok: boolean;
  fileName: string;
  s3Key: string;
  priorS3Key: string;
  expectedMeterValue: string;
  imageDifficulty: ImageDifficulty;
  renamed: boolean;
  url?: string;
}> {
  const response = await fetch(`${API_BASE_URL}/test-data/unit-test-images`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-portal-work-mode': portalWorkMode,
    },
    body: JSON.stringify({ workType, s3Key, expectedMeterValue, imageDifficulty }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseJsonBody<{ error?: string }>(text, response.status).error || `HTTP ${response.status}`);
  }
  return parseJsonBody(text, response.status);
}

export async function deleteUnitTestImage(
  workType: WorkType,
  s3Key: string,
  portalWorkMode: PortalWorkMode = 'test_data_reviewer',
): Promise<{ ok: boolean; s3Key: string; deleted: boolean }> {
  const response = await fetch(`${API_BASE_URL}/test-data/unit-test-images`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'x-portal-work-mode': portalWorkMode,
    },
    body: JSON.stringify({ workType, s3Key }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseJsonBody<{ error?: string }>(text, response.status).error || `HTTP ${response.status}`);
  }
  return parseJsonBody(text, response.status);
}

export async function approveSessionForUnitTest(
  sessionId: string,
  workType: WorkType | undefined,
  userEmail?: string,
  s3SessionPrefix?: string,
  portalWorkMode: PortalWorkMode = 'test_data_reviewer',
): Promise<{ ok: boolean; fileName: string; s3Key: string; reading: S3MeterReading }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-portal-work-mode': portalWorkMode,
  };
  if (userEmail) headers['x-user-email'] = userEmail;
  const response = await fetch(`${API_BASE_URL}/test-data/approve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sessionId,
      workType,
      ...(s3SessionPrefix?.trim() ? { s3SessionPrefix: s3SessionPrefix.trim() } : {}),
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseJsonBody<{ error?: string }>(text, response.status).error || `HTTP ${response.status}`);
  }
  return parseJsonBody(text, response.status);
}

export async function removeSessionFromTestDataset(
  sessionId: string,
  workType: WorkType | undefined,
  userEmail?: string,
  s3SessionPrefix?: string,
  portalWorkMode: PortalWorkMode = 'test_data_reviewer',
): Promise<{
  ok: boolean;
  removedFromQueue: boolean;
  removedFromS3: boolean;
  deletedS3Key: string | null;
  reading: S3MeterReading;
}> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-portal-work-mode': portalWorkMode,
  };
  if (userEmail) headers['x-user-email'] = userEmail;
  const response = await fetch(`${API_BASE_URL}/test-data/remove-from-dataset`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sessionId,
      workType,
      ...(s3SessionPrefix?.trim() ? { s3SessionPrefix: s3SessionPrefix.trim() } : {}),
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseJsonBody<{ error?: string }>(text, response.status).error || `HTTP ${response.status}`);
  }
  return parseJsonBody(text, response.status);
}

export type ManualUploadBulkResult = {
  ok: boolean;
  sessionId: string;
  s3SessionPrefix: string;
  workType: string;
  sourceType: 'field' | 'simulator';
  expectedReading: string | null;
  labeled: boolean;
  reading: S3MeterReading;
  fileName?: string;
};

export type ManualUploadBulkResponse = {
  ok: boolean;
  uploaded: number;
  failed: number;
  results: ManualUploadBulkResult[];
  errors: { fileName: string; error: string }[];
};

/* Portal local Python inference (Upload & run model) — disabled; see server/meterInference.js
export type PortalInferenceDialSummary = {
  dial: number;
  digit: number;
  direction?: string;
};

export type PortalInferenceBulkResult = {
  ok: boolean;
  sessionId: string;
  s3SessionPrefix: string;
  workType: string;
  sourceType: string;
  mlPrediction: string;
  inferencePipeline?: string;
  dialSummaries?: PortalInferenceDialSummary[];
  dialPreviewUrls?: string[];
  reading: S3MeterReading;
  fileName?: string;
};

export type PortalInferenceBulkResponse = {
  ok: boolean;
  uploaded: number;
  failed: number;
  results: PortalInferenceBulkResult[];
  errors: { fileName: string; error: string }[];
};

export async function fetchMeterInferenceStatus(): Promise<{
  ready: boolean;
  enabled: boolean;
  checks: Record<string, boolean>;
}> {
  const response = await fetch(`${API_BASE_URL}/meter-inference/status`);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return body;
}

export async function createPortalInferenceUploadBulk(
  params: {
    images: File[];
    workType: WorkType;
    sourceType?: 'field' | 'simulator';
    userEmail?: string;
  },
  portalWorkMode: PortalWorkMode,
): Promise<PortalInferenceBulkResponse> {
  const form = new FormData();
  for (const file of params.images) {
    form.append('images', file);
  }
  form.append('workType', params.workType);
  if (params.sourceType) form.append('sourceType', params.sourceType);

  const headers: Record<string, string> = {
    'x-portal-work-mode': portalWorkModeForMetadataHeader(portalWorkMode),
  };
  if (params.userEmail) headers['x-user-email'] = params.userEmail;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/portal-uploads/infer-bulk`, {
      method: 'POST',
      headers,
      body: form,
    });
  } catch (e) {
    throw wrapFetchNetworkError(e, 'Upload with model failed.');
  }
  const text = await response.text();
  const body = parseJsonBody<PortalInferenceBulkResponse & { error?: string; status?: unknown }>(
    text,
    response.status,
  );
  if (!response.ok && response.status !== 207) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  if (!body.ok && body.uploaded === 0) {
    throw new Error(body.errors?.[0]?.error || body.error || 'Upload with model failed');
  }
  return body;
}
*/

export async function createManualUploadBulk(
  params: {
    images: File[];
    workType: WorkType;
    sourceType?: 'field' | 'simulator';
    userEmail?: string;
  },
  portalWorkMode: PortalWorkMode,
): Promise<ManualUploadBulkResponse> {
  const form = new FormData();
  for (const file of params.images) {
    form.append('images', file);
  }
  form.append('workType', params.workType);
  if (params.sourceType) form.append('sourceType', params.sourceType);

  const headers: Record<string, string> = {
    'x-portal-work-mode': portalWorkModeForMetadataHeader(portalWorkMode),
  };
  if (params.userEmail) headers['x-user-email'] = params.userEmail;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/manual-uploads/bulk`, {
      method: 'POST',
      headers,
      body: form,
    });
  } catch (e) {
    throw wrapFetchNetworkError(e, 'Bulk upload failed.');
  }
  const text = await response.text();
  const body = parseJsonBody<ManualUploadBulkResponse & { error?: string }>(text, response.status);
  if (!response.ok && response.status !== 207) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  if (!body.ok && body.uploaded === 0) {
    throw new Error(body.errors?.[0]?.error || body.error || 'Upload failed');
  }
  return body;
}

export type AuditEventRecord = {
  id: string;
  ts: string;
  source: string;
  action: string;
  intent: string | null;
  actor: { email: string | null; userName: string | null; role: string | null };
  target: {
    sessionId: string | null;
    workType: string | null;
    imageSignature: string | null;
  };
  detail: Record<string, unknown>;
  outcome: string;
  error: string | null;
  client?: { platform?: string; appVersion?: string };
};

export type AuditSessionRow = {
  sessionId: string | null;
  imageSignature: string | null;
  workType: string | null;
  collector: string | null;
  queued: boolean;
  uploadStarted: boolean;
  uploadSucceeded: boolean;
  uploadFailed: boolean;
  lastAction: string | null;
  lastTs: string | null;
  lastError: string | null;
  feedbackType: string | null;
};

export type AuditLogSummary = {
  userName: string | null;
  collectorCount: number;
  from: string;
  to: string;
  eventCount: number;
  uniqueSessions: number;
  queuedCount: number;
  uploadStarted: number;
  uploadSucceeded: number;
  uploadFailed: number;
  pendingUpload: number;
  portalSessionsInRange: number;
  gapVsPortal: number;
  lastBatch: { ts: string; uploaded: string | number | null; failed: string | number | null } | null;
  sessions: AuditSessionRow[];
};

/** @deprecated Use AuditSessionRow */
export type AuditSyncSessionRow = AuditSessionRow;
/** @deprecated Use AuditLogSummary */
export type AuditSyncSummary = AuditLogSummary;

export async function fetchAuditEvents(
  params: {
    from?: string;
    to?: string;
    userName?: string;
    sessionId?: string;
    action?: string;
    limit?: number;
  },
  portalWorkMode: PortalWorkMode = 'admin',
): Promise<{ events: AuditEventRecord[] }> {
  const q = new URLSearchParams();
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  if (params.userName) q.set('userName', params.userName);
  if (params.sessionId) q.set('sessionId', params.sessionId);
  if (params.action) q.set('action', params.action);
  if (params.limit != null) q.set('limit', String(params.limit));
  const response = await fetch(`${API_BASE_URL}/audit-events?${q}`, {
    headers: { 'x-portal-work-mode': portalWorkMode },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseJsonBody<{ error?: string }>(text, response.status).error || `HTTP ${response.status}`);
  }
  return parseJsonBody(text, response.status);
}

export async function fetchAuditLogSummary(
  from: string,
  to: string,
  portalWorkMode: PortalWorkMode = 'admin',
  userName?: string,
): Promise<AuditLogSummary> {
  const q = new URLSearchParams({ from, to });
  const trimmed = userName?.trim();
  if (trimmed) q.set('userName', trimmed);
  const response = await fetch(`${API_BASE_URL}/audit-events/summary?${q}`, {
    headers: { 'x-portal-work-mode': portalWorkMode },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseJsonBody<{ error?: string }>(text, response.status).error || `HTTP ${response.status}`);
  }
  return parseJsonBody(text, response.status);
}

/** @deprecated Use fetchAuditLogSummary */
export const fetchAuditSyncSummary = fetchAuditLogSummary;

function reviewAssignmentHeaders(
  portalWorkMode: PortalWorkMode,
  userEmail?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    /** Admin assignment APIs require literal `admin` (not metadata reviewer mapping). */
    'x-portal-work-mode': portalWorkMode,
  };
  const email = userEmail?.trim();
  if (email) headers['x-user-email'] = email;
  try {
    const loginId = localStorage.getItem(ANICA_LOGIN_USER_ID_KEY)?.trim();
    if (loginId) headers['x-anica-user-id'] = loginId;
  } catch {
    /* ignore */
  }
  return headers;
}

export async function previewReviewAssignment(
  body: {
    workType: string;
    pool: ReviewAssignmentPool;
    rules: ReviewAssignmentRules;
    assignees?: string[];
    splitMode?: string;
  },
  portalWorkMode: PortalWorkMode = 'admin',
  userEmail?: string,
): Promise<{
  pool: ReviewAssignmentPool;
  workType: string;
  totalInPool: number;
  totalMatching: number;
  excludedAlreadyAssigned: number;
  willAssign: number;
  splitPreview: { assigneeEmail: string; count: number }[];
}> {
  const response = await fetch(`${API_BASE_URL}/review-assignments/preview`, {
    method: 'POST',
    headers: reviewAssignmentHeaders(portalWorkMode, userEmail),
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseJsonBody<{ error?: string }>(text, response.status).error || `HTTP ${response.status}`);
  }
  return parseJsonBody(text, response.status);
}

export async function createReviewAssignment(
  body: {
    workType: string;
    pool: ReviewAssignmentPool;
    name: string;
    rules: ReviewAssignmentRules;
    assignees: string[];
    splitMode?: string;
  },
  portalWorkMode: PortalWorkMode = 'admin',
  userEmail?: string,
): Promise<{ batch: ReviewAssignmentBatchSummary; errors: { sessionId: string; error: string }[] }> {
  const response = await fetch(`${API_BASE_URL}/review-assignments`, {
    method: 'POST',
    headers: reviewAssignmentHeaders(portalWorkMode, userEmail),
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseJsonBody<{ error?: string }>(text, response.status).error || `HTTP ${response.status}`);
  }
  return parseJsonBody(text, response.status);
}

export async function fetchReviewAssignments(
  workType: string,
  opts?: { mine?: boolean; pool?: ReviewAssignmentPool },
  portalWorkMode: PortalWorkMode = 'admin',
  userEmail?: string,
): Promise<{ batches: ReviewAssignmentBatchSummary[] }> {
  const q = new URLSearchParams({ workType });
  if (opts?.mine) q.set('mine', '1');
  if (opts?.pool) q.set('pool', opts.pool);
  const response = await fetch(`${API_BASE_URL}/review-assignments?${q}`, {
    headers: reviewAssignmentHeaders(portalWorkMode, userEmail),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseJsonBody<{ error?: string }>(text, response.status).error || `HTTP ${response.status}`);
  }
  return parseJsonBody(text, response.status);
}

export async function updateReviewAssignmentBatch(
  batchId: string,
  workType: string,
  status: 'open' | 'closed',
  portalWorkMode: PortalWorkMode = 'admin',
  userEmail?: string,
): Promise<{ batch: ReviewAssignmentBatchSummary }> {
  const response = await fetch(`${API_BASE_URL}/review-assignments/${encodeURIComponent(batchId)}`, {
    method: 'PATCH',
    headers: reviewAssignmentHeaders(portalWorkMode, userEmail),
    body: JSON.stringify({ workType, status }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseJsonBody<{ error?: string }>(text, response.status).error || `HTTP ${response.status}`);
  }
  return parseJsonBody(text, response.status);
}

export async function bulkMoveReadings(readings: BulkMoveRequest[], userEmail?: string): Promise<{ success: boolean; moved: number }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (userEmail) headers['x-user-email'] = userEmail;
    const response = await fetch(`${API_BASE_URL}/readings/bulk-move`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ readings }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to bulk move readings:', error);
    throw error;
  }
}
