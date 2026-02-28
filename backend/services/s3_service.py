import boto3
from botocore.exceptions import ClientError
from typing import Optional

from config import get_settings


class S3Service:
    """Service for interacting with S3 bucket"""

    def __init__(self):
        settings = get_settings()
        self.s3_client = boto3.client(
            "s3",
            region_name=settings.aws_region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )
        self.bucket_name = settings.s3_bucket_name
        self.region = settings.aws_region

    def generate_presigned_url(self, s3_key: str, expiration: int = 3600) -> Optional[str]:
        """
        Generate a presigned URL for accessing a private S3 object.
        
        Args:
            s3_key: The S3 object key
            expiration: URL expiration time in seconds (default 1 hour)
            
        Returns:
            Presigned URL or None if error
        """
        try:
            url = self.s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket_name, "Key": s3_key},
                ExpiresIn=expiration,
            )
            return url
        except ClientError as e:
            print(f"Error generating presigned URL: {e}")
            return None

    def get_public_url(self, s3_key: str) -> str:
        """Generate a public S3 URL (requires bucket to be public)"""
        return f"https://{self.bucket_name}.s3.{self.region}.amazonaws.com/{s3_key}"

    def list_objects_by_prefix(self, prefix: str, max_keys: int = 1000) -> list[dict]:
        """
        List objects in the bucket with a given prefix.
        
        Args:
            prefix: S3 key prefix to filter by
            max_keys: Maximum number of keys to return
            
        Returns:
            List of object metadata dicts
        """
        try:
            response = self.s3_client.list_objects_v2(
                Bucket=self.bucket_name,
                Prefix=prefix,
                MaxKeys=max_keys,
            )
            return response.get("Contents", [])
        except ClientError as e:
            print(f"Error listing objects: {e}")
            return []

    def get_object_metadata(self, s3_key: str) -> Optional[dict]:
        """Get metadata for an S3 object"""
        try:
            response = self.s3_client.head_object(
                Bucket=self.bucket_name,
                Key=s3_key,
            )
            return {
                "content_length": response.get("ContentLength"),
                "content_type": response.get("ContentType"),
                "last_modified": response.get("LastModified"),
                "metadata": response.get("Metadata", {}),
            }
        except ClientError as e:
            print(f"Error getting object metadata: {e}")
            return None


s3_service = S3Service()
