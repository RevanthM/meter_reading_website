from fastapi import APIRouter, HTTPException

from models.work_type import (
    WorkType,
    WorkTypeCode,
    WorkTypeStats,
    WORK_TYPE_NAMES,
    CONDITION_CODES,
)
from services.dynamodb_service import dynamodb_service

router = APIRouter(prefix="/api/work-types", tags=["work-types"])


@router.get("", response_model=list[WorkType])
async def list_work_types():
    """
    List all available work types with their codes and condition codes.
    """
    work_types = []
    for code in WorkTypeCode:
        work_types.append(WorkType(
            code=code.value,
            name=WORK_TYPE_NAMES[code],
            condition_codes=CONDITION_CODES.get(code, []),
        ))
    return work_types


@router.get("/stats", response_model=list[WorkTypeStats])
async def get_all_work_type_stats():
    """
    Get statistics for all work types that have images in the database.
    Returns total images, status breakdown, and condition code counts.
    """
    try:
        stats = dynamodb_service.get_all_work_type_stats()
        return stats
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{work_type_code}", response_model=WorkType)
async def get_work_type(work_type_code: str):
    """
    Get details for a specific work type by code.
    """
    try:
        code_enum = WorkTypeCode(work_type_code)
    except ValueError:
        raise HTTPException(
            status_code=404,
            detail=f"Work type '{work_type_code}' not found. Valid codes: {[e.value for e in WorkTypeCode]}"
        )
    
    return WorkType(
        code=code_enum.value,
        name=WORK_TYPE_NAMES[code_enum],
        condition_codes=CONDITION_CODES.get(code_enum, []),
    )


@router.get("/{work_type_code}/stats", response_model=WorkTypeStats)
async def get_work_type_stats(work_type_code: str):
    """
    Get statistics for a specific work type.
    
    Returns:
    - Total number of images
    - Breakdown by status (uploaded, reviewed, labeled, trained)
    - Breakdown by condition code
    - Breakdown by feedback type
    """
    try:
        stats = dynamodb_service.get_work_type_stats(work_type_code)
        return stats
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
