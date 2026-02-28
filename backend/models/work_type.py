from pydantic import BaseModel
from typing import Optional
from enum import Enum


class WorkTypeCode(str, Enum):
    """Work type codes - 4 character identifiers"""
    INTRUSIVE_INSPECTION = "INTR"
    GO95_ELECTRICAL_POLE = "GO95"
    RISER_INSPECTION = "RISR"
    LEAK_INSPECTION = "LEAK"
    # Legacy/default for existing data without work type
    METER_READING = "METR"


WORK_TYPE_NAMES = {
    WorkTypeCode.INTRUSIVE_INSPECTION: "Intrusive Inspection",
    WorkTypeCode.GO95_ELECTRICAL_POLE: "GO95 Electrical Pole Inspection",
    WorkTypeCode.RISER_INSPECTION: "Riser Inspection",
    WorkTypeCode.LEAK_INSPECTION: "Leak Inspection",
    WorkTypeCode.METER_READING: "Meter Reading",
}

CONDITION_CODES = {
    WorkTypeCode.INTRUSIVE_INSPECTION: [
        "CORROSION",
        "STRUCTURAL_DAMAGE",
        "COATING_FAILURE",
    ],
    WorkTypeCode.GO95_ELECTRICAL_POLE: [
        "NEST_ON_POLE",
        "BROKEN_INSULATOR",
        "DAMAGED_CROSSARM",
        "LEANING_POLE",
        "WOODPECKER_DAMAGE",
    ],
    WorkTypeCode.RISER_INSPECTION: [
        "RISER_TOO_LOW",
        "NIPPLE_DAMAGED",
        "CORROSION_AT_BASE",
        "IMPROPER_SUPPORT",
    ],
    WorkTypeCode.LEAK_INSPECTION: [
        "GAS_LEAK_DETECTED",
        "PIPE_CORROSION",
        "JOINT_FAILURE",
        "VALVE_LEAK",
    ],
    WorkTypeCode.METER_READING: [
        "CORRECT",
        "INCORRECT",
        "NOT_SURE",
        "NO_DIALS",
    ],
}


class WorkType(BaseModel):
    """Work type definition"""
    code: str
    name: str
    condition_codes: list[str]


class StatusBreakdown(BaseModel):
    """Breakdown of images by status"""
    uploaded: int = 0
    reviewed: int = 0
    labeled: int = 0
    trained: int = 0


class ConditionCodeCount(BaseModel):
    """Count of images per condition code"""
    code: str
    count: int


class WorkTypeStats(BaseModel):
    """Statistics for a work type"""
    work_type_code: str
    work_type_name: str
    total_images: int
    status_breakdown: StatusBreakdown
    condition_code_counts: list[ConditionCodeCount]
    feedback_breakdown: dict[str, int]
