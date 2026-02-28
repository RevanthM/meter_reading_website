from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from models.image import ImageRecord, ImageListResponse
from services.dynamodb_service import dynamodb_service
from services.s3_service import s3_service

router = APIRouter(prefix="/api/images", tags=["images"])


@router.get("/by-work-type/{work_type_code}", response_model=ImageListResponse)
async def get_images_by_work_type(
    work_type_code: str,
    limit: int = Query(default=50, ge=1, le=100),
    next_token: Optional[str] = Query(default=None),
    use_presigned: bool = Query(default=False, description="Use presigned URLs for private bucket access"),
):
    """
    Get images for a specific work type with pagination.
    
    Args:
        work_type_code: The work type code (e.g., 'GO95', 'METR')
        limit: Number of images to return (1-100)
        next_token: Pagination token from previous response
        use_presigned: If true, generate presigned URLs (for private buckets)
    
    Returns:
        List of images with S3 URLs and metadata
    """
    try:
        images, next_page_token = dynamodb_service.get_images_by_work_type(
            work_type_code=work_type_code,
            limit=limit,
            last_key=next_token,
        )
        
        if use_presigned:
            for image in images:
                if image.s3_key:
                    presigned_url = s3_service.generate_presigned_url(image.s3_key)
                    if presigned_url:
                        image.s3_url = presigned_url
        
        return ImageListResponse(
            work_type_code=work_type_code,
            total_count=len(images),
            images=images,
            next_token=next_page_token,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{session_id}", response_model=ImageRecord)
async def get_image(
    session_id: str,
    use_presigned: bool = Query(default=False),
):
    """
    Get details for a specific image by session ID.
    """
    try:
        table = dynamodb_service.table
        response = table.get_item(Key={"session_id": session_id})
        
        if "Item" not in response:
            raise HTTPException(status_code=404, detail=f"Image with session_id '{session_id}' not found")
        
        item = response["Item"]
        s3_key = item.get("s3_key", "")
        
        if use_presigned and s3_key:
            s3_url = s3_service.generate_presigned_url(s3_key)
        else:
            s3_url = dynamodb_service._generate_s3_url(s3_key)
        
        return ImageRecord(
            session_id=item.get("session_id", ""),
            timestamp=item.get("timestamp", ""),
            s3_bucket=item.get("s3_bucket", dynamodb_service.s3_bucket),
            s3_key=s3_key,
            s3_url=s3_url,
            upload_mode=item.get("upload_mode", ""),
            feedback_type=item.get("feedback_type", ""),
            user_name=item.get("user_name", ""),
            app_version=item.get("app_version", ""),
            ml_prediction=item.get("ml_prediction", ""),
            ml_raw_prediction=item.get("ml_raw_prediction", ""),
            user_correction=item.get("user_correction"),
            dial_count=int(item.get("dial_count", 0)),
            confidence=float(item.get("confidence", 0)),
            image_source=item.get("image_source", ""),
            is_correct=item.get("is_correct", False),
            work_type=item.get("work_type"),
            work_type_name=item.get("work_type_name"),
            condition_code=item.get("condition_code"),
            status=item.get("status", "uploaded"),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{session_id}/status")
async def update_image_status(session_id: str, status: str):
    """
    Update the status of an image.
    
    Valid statuses: uploaded, reviewed, labeled, trained
    """
    valid_statuses = ["uploaded", "reviewed", "labeled", "trained"]
    if status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status '{status}'. Valid statuses: {valid_statuses}"
        )
    
    success = dynamodb_service.update_image_status(session_id, status)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update image status")
    
    return {"message": f"Status updated to '{status}'", "session_id": session_id}
