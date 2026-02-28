import boto3
from botocore.exceptions import ClientError
from typing import Optional
from collections import defaultdict

from config import get_settings
from models.work_type import (
    WorkTypeCode,
    WorkTypeStats,
    StatusBreakdown,
    ConditionCodeCount,
    WORK_TYPE_NAMES,
)
from models.image import ImageRecord


class DynamoDBService:
    """Service for interacting with DynamoDB Images table"""

    def __init__(self):
        settings = get_settings()
        self.dynamodb = boto3.resource(
            "dynamodb",
            region_name=settings.aws_region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )
        self.table = self.dynamodb.Table(settings.dynamodb_table_name)
        self.s3_bucket = settings.s3_bucket_name
        self.region = settings.aws_region

    def get_work_type_stats(self, work_type_code: str) -> WorkTypeStats:
        """
        Get statistics for a specific work type.
        Scans the table and aggregates stats for images matching the work type.
        """
        status_counts = defaultdict(int)
        feedback_counts = defaultdict(int)
        condition_counts = defaultdict(int)
        total_images = 0

        scan_kwargs = {}
        
        while True:
            response = self.table.scan(**scan_kwargs)
            items = response.get("Items", [])

            for item in items:
                item_work_type = item.get("work_type", "METR")
                
                if item_work_type == work_type_code:
                    total_images += 1
                    
                    status = item.get("status", "uploaded")
                    status_counts[status] += 1
                    
                    feedback = item.get("feedback_type", "unknown")
                    feedback_counts[feedback] += 1
                    
                    condition = item.get("condition_code")
                    if condition:
                        condition_counts[condition] += 1

            if "LastEvaluatedKey" not in response:
                break
            scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]

        status_breakdown = StatusBreakdown(
            uploaded=status_counts.get("uploaded", 0),
            reviewed=status_counts.get("reviewed", 0),
            labeled=status_counts.get("labeled", 0),
            trained=status_counts.get("trained", 0),
        )

        condition_code_counts = [
            ConditionCodeCount(code=code, count=count)
            for code, count in sorted(condition_counts.items(), key=lambda x: -x[1])
        ]

        work_type_name = WORK_TYPE_NAMES.get(
            WorkTypeCode(work_type_code) if work_type_code in [e.value for e in WorkTypeCode] else None,
            work_type_code
        )

        return WorkTypeStats(
            work_type_code=work_type_code,
            work_type_name=work_type_name,
            total_images=total_images,
            status_breakdown=status_breakdown,
            condition_code_counts=condition_code_counts,
            feedback_breakdown=dict(feedback_counts),
        )

    def get_images_by_work_type(
        self,
        work_type_code: str,
        limit: int = 50,
        last_key: Optional[str] = None,
    ) -> tuple[list[ImageRecord], Optional[str]]:
        """
        Get images for a specific work type with pagination.
        Returns list of images and optional next page token.
        """
        images = []
        scan_kwargs = {"Limit": limit * 10}
        
        if last_key:
            scan_kwargs["ExclusiveStartKey"] = {"session_id": last_key}

        while len(images) < limit:
            response = self.table.scan(**scan_kwargs)
            items = response.get("Items", [])

            for item in items:
                item_work_type = item.get("work_type", "METR")
                
                if item_work_type == work_type_code:
                    s3_url = self._generate_s3_url(item.get("s3_key", ""))
                    
                    image = ImageRecord(
                        session_id=item.get("session_id", ""),
                        timestamp=item.get("timestamp", ""),
                        s3_bucket=item.get("s3_bucket", self.s3_bucket),
                        s3_key=item.get("s3_key", ""),
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
                    images.append(image)
                    
                    if len(images) >= limit:
                        break

            if "LastEvaluatedKey" not in response:
                break
            scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]

        next_token = images[-1].session_id if len(images) == limit else None
        return images, next_token

    def get_all_work_type_stats(self) -> list[WorkTypeStats]:
        """Get stats for all work types that have images"""
        work_type_stats = {}
        
        scan_kwargs = {}
        while True:
            response = self.table.scan(**scan_kwargs)
            items = response.get("Items", [])

            for item in items:
                work_type = item.get("work_type", "METR")
                
                if work_type not in work_type_stats:
                    work_type_stats[work_type] = {
                        "total": 0,
                        "status": defaultdict(int),
                        "feedback": defaultdict(int),
                        "conditions": defaultdict(int),
                    }
                
                stats = work_type_stats[work_type]
                stats["total"] += 1
                stats["status"][item.get("status", "uploaded")] += 1
                stats["feedback"][item.get("feedback_type", "unknown")] += 1
                
                condition = item.get("condition_code")
                if condition:
                    stats["conditions"][condition] += 1

            if "LastEvaluatedKey" not in response:
                break
            scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]

        result = []
        for code, stats in work_type_stats.items():
            try:
                work_type_enum = WorkTypeCode(code)
                name = WORK_TYPE_NAMES.get(work_type_enum, code)
            except ValueError:
                name = code

            result.append(WorkTypeStats(
                work_type_code=code,
                work_type_name=name,
                total_images=stats["total"],
                status_breakdown=StatusBreakdown(
                    uploaded=stats["status"].get("uploaded", 0),
                    reviewed=stats["status"].get("reviewed", 0),
                    labeled=stats["status"].get("labeled", 0),
                    trained=stats["status"].get("trained", 0),
                ),
                condition_code_counts=[
                    ConditionCodeCount(code=c, count=cnt)
                    for c, cnt in sorted(stats["conditions"].items(), key=lambda x: -x[1])
                ],
                feedback_breakdown=dict(stats["feedback"]),
            ))

        return sorted(result, key=lambda x: -x.total_images)

    def _generate_s3_url(self, s3_key: str) -> str:
        """Generate a public S3 URL for the given key"""
        if not s3_key:
            return ""
        return f"https://{self.s3_bucket}.s3.{self.region}.amazonaws.com/{s3_key}"

    def update_image_status(self, session_id: str, status: str) -> bool:
        """Update the status of an image"""
        try:
            self.table.update_item(
                Key={"session_id": session_id},
                UpdateExpression="SET #status = :status",
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={":status": status},
            )
            return True
        except ClientError as e:
            print(f"Error updating status: {e}")
            return False


dynamodb_service = DynamoDBService()
