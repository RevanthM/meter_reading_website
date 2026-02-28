export interface WorkType {
  code: string;
  name: string;
  condition_codes: string[];
}

export interface StatusBreakdown {
  uploaded: number;
  reviewed: number;
  labeled: number;
  trained: number;
}

export interface ConditionCodeCount {
  code: string;
  count: number;
}

export interface WorkTypeStats {
  work_type_code: string;
  work_type_name: string;
  total_images: number;
  status_breakdown: StatusBreakdown;
  condition_code_counts: ConditionCodeCount[];
  feedback_breakdown: Record<string, number>;
}

export interface ImageRecord {
  session_id: string;
  timestamp: string;
  s3_bucket: string;
  s3_key: string;
  s3_url?: string;
  upload_mode: string;
  feedback_type: string;
  user_name: string;
  app_version: string;
  ml_prediction: string;
  ml_raw_prediction: string;
  user_correction?: string;
  dial_count: number;
  confidence: number;
  image_source: string;
  is_correct: boolean;
  work_type?: string;
  work_type_name?: string;
  condition_code?: string;
  status: string;
}

export interface ImageListResponse {
  work_type_code: string;
  total_count: number;
  images: ImageRecord[];
  next_token?: string;
}
