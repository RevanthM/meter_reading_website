from pydantic import BaseModel
from typing import Optional


class ImageRecord(BaseModel):
    """Image record from DynamoDB"""
    session_id: str
    timestamp: str
    s3_bucket: str
    s3_key: str
    s3_url: Optional[str] = None
    upload_mode: str
    feedback_type: str
    user_name: str
    app_version: str
    ml_prediction: str
    ml_raw_prediction: str
    user_correction: Optional[str] = None
    dial_count: int
    confidence: float
    image_source: str
    is_correct: bool
    work_type: Optional[str] = None
    work_type_name: Optional[str] = None
    condition_code: Optional[str] = None
    status: str = "uploaded"


class ImageListResponse(BaseModel):
    """Response for image list endpoint"""
    work_type_code: str
    total_count: int
    images: list[ImageRecord]
    next_token: Optional[str] = None
