#!/usr/bin/env python3
"""
Download images under an S3 prefix and write a CSV: image file name + expected meter reading.

Expected value is read from session metadata.json in the same folder as the image
(parent key dirname + "metadata.json"), using `user_correction` first, then `ml_prediction`.

Layouts supported:

1) Session folder (portal-style):
  s3://BUCKET/1000/unit_test_images/<session>/image.jpg
  s3://BUCKET/1000/unit_test_images/<session>/metadata.json

2) Flat folder (e.g. s3://meter-reader-training-feedback/1000/unit_test_images/3_1965.jpeg):
  Tries s3://.../1000/unit_test_images/metadata.json (shared), then sidecar
  s3://.../1000/unit_test_images/3_1965.json, then filename heuristic ``<digits>_<digits>.jpeg``
  → expected_meter_value = second number (e.g. ``1965``).

Override with ``--expect-filename-regex`` or ``--no-filename-heuristic``.

Usage:
  export AWS_PROFILE=...   # or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
  pip install -r scripts/requirements-unit-test-s3.txt
  python scripts/unit_test_s3_to_csv.py \\
    --bucket meter-reader-training-feedback \\
    --prefix 1000/unit_test_images/ \\
    --out-dir ./unit_test_downloads \\
    --csv ./unit_test_manifest.csv

  # List only (no download):
  python scripts/unit_test_s3_to_csv.py --bucket meter-reader-training-feedback --dry-run
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from pathlib import PurePosixPath
from typing import Any

try:
    import boto3
    from botocore.exceptions import ClientError
except ImportError:
    print("Install boto3: pip install -r scripts/requirements-unit-test-s3.txt", file=sys.stderr)
    sys.exit(1)

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}

# Flat names like 3_1965.jpeg → expected "1965" (second integer group).
_FLAT_TWO_INT_RE = re.compile(r"^(\d+)_(\d+)\.(jpe?g|png|webp|heic|heif)$", re.IGNORECASE)


def normalize_prefix(p: str) -> str:
    p = p.strip()
    if not p:
        return ""
    return p if p.endswith("/") else p + "/"


def is_image_key(key: str) -> bool:
    lower = key.lower()
    return any(lower.endswith(s) for s in IMAGE_SUFFIXES)


def metadata_key_for_image(image_key: str) -> str:
    parent = str(PurePosixPath(image_key).parent)
    if parent == ".":
        return "metadata.json"
    return parent + "/metadata.json"


def expected_from_metadata(meta: dict[str, Any]) -> str:
    uc = meta.get("user_correction")
    if uc is not None and str(uc).strip() != "":
        return str(uc).strip()
    mp = meta.get("ml_prediction")
    if mp is not None and str(mp).strip() != "":
        return str(mp).strip()
    return ""


def filename_expectation(basename: str, pattern: re.Pattern[str] | None) -> str:
    if not pattern:
        return ""
    m = pattern.search(basename)
    if not m:
        return ""
    if m.lastindex:
        return m.group(1).strip()
    return m.group(0).strip()


def flat_two_int_expected(basename: str) -> str:
    m = _FLAT_TWO_INT_RE.match(basename)
    if not m:
        return ""
    return m.group(2)


def sidecar_metadata_key(image_key: str) -> str:
    """e.g. .../3_1965.jpeg → .../3_1965.json"""
    p = PurePosixPath(image_key)
    return str(p.with_suffix(".json"))


def main() -> None:
    ap = argparse.ArgumentParser(description="S3 unit-test images → local files + CSV manifest")
    ap.add_argument(
        "--bucket",
        default=os.environ.get("UNIT_TEST_S3_BUCKET")
        or os.environ.get("AWS_S3_BUCKET")
        or "meter-reader-training-feedback",
        help="S3 bucket (env: UNIT_TEST_S3_BUCKET, else AWS_S3_BUCKET, else meter-reader-training-feedback)",
    )
    ap.add_argument(
        "--prefix",
        default=os.environ.get("UNIT_TEST_S3_PREFIX", "1000/unit_test_images/"),
        help="Key prefix under bucket (default: 1000/unit_test_images/)",
    )
    ap.add_argument(
        "--out-dir",
        default="./unit_test_downloads",
        help="Local directory to store downloaded images",
    )
    ap.add_argument(
        "--csv",
        default="./unit_test_manifest.csv",
        help="Output CSV path",
    )
    ap.add_argument(
        "--region",
        default=os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-west-2")),
        help="AWS region",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not download; still write CSV with resolved expected values when metadata exists",
    )
    ap.add_argument(
        "--expect-filename-regex",
        default="",
        help="Optional: first capture group (or full match) used as expected meter if metadata is empty",
    )
    ap.add_argument(
        "--no-filename-heuristic",
        action="store_true",
        help="Disable <n>_<meter>.jpg → expected meter = second number when metadata is empty",
    )
    args = ap.parse_args()

    prefix = normalize_prefix(args.prefix)
    pattern = re.compile(args.expect_filename_regex) if args.expect_filename_regex.strip() else None

    s3 = boto3.client("s3", region_name=args.region)
    paginator = s3.get_paginator("list_objects_v2")

    image_keys: list[str] = []
    try:
        for page in paginator.paginate(Bucket=args.bucket, Prefix=prefix):
            for obj in page.get("Contents") or []:
                key = obj.get("Key") or ""
                if key.endswith("/") or not is_image_key(key):
                    continue
                image_keys.append(key)
    except ClientError as e:
        print(f"S3 list failed: {e}", file=sys.stderr)
        sys.exit(2)

    image_keys.sort()
    if not image_keys:
        print(f"No images found under s3://{args.bucket}/{prefix}", file=sys.stderr)
        sys.exit(3)

    meta_cache: dict[str, dict[str, Any]] = {}

    def load_metadata(meta_key: str) -> dict[str, Any]:
        if meta_key in meta_cache:
            return meta_cache[meta_key]
        try:
            resp = s3.get_object(Bucket=args.bucket, Key=meta_key)
            body = resp["Body"].read()
            data = json.loads(body.decode("utf-8"))
            if not isinstance(data, dict):
                data = {}
        except ClientError:
            data = {}
        except (json.JSONDecodeError, UnicodeDecodeError):
            data = {}
        meta_cache[meta_key] = data
        return data

    if not args.dry_run:
        os.makedirs(args.out_dir, exist_ok=True)

    rows: list[dict[str, str]] = []
    for image_key in image_keys:
        base = PurePosixPath(image_key).name
        meta_key = metadata_key_for_image(image_key)
        meta = load_metadata(meta_key)
        expected = expected_from_metadata(meta)
        side_key = sidecar_metadata_key(image_key)
        if not expected and side_key != meta_key:
            side = load_metadata(side_key)
            expected = expected_from_metadata(side)
        if not expected and pattern:
            expected = filename_expectation(base, pattern)
        if not expected and not args.no_filename_heuristic:
            expected = flat_two_int_expected(base)

        rel_local = image_key[len(prefix) :] if image_key.startswith(prefix) else image_key
        rel_local = rel_local.lstrip("/")
        safe_path = os.path.join(args.out_dir, rel_local)
        if not args.dry_run:
            os.makedirs(os.path.dirname(safe_path) or args.out_dir, exist_ok=True)
            try:
                s3.download_file(args.bucket, image_key, safe_path)
            except ClientError as e:
                print(f"Download failed {image_key}: {e}", file=sys.stderr)
                continue

        rows.append(
            {
                "s3_key": image_key,
                "image_file_name": base,
                "relative_path": rel_local,
                "expected_meter_value": expected,
                "metadata_s3_key": meta_key,
            }
        )

    fieldnames = ["image_file_name", "expected_meter_value", "relative_path", "s3_key", "metadata_s3_key"]
    with open(args.csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fieldnames})

    print(f"Wrote {len(rows)} rows to {args.csv}")
    if args.dry_run:
        print("(dry-run: no files downloaded)")
    else:
        print(f"Downloaded under {os.path.abspath(args.out_dir)}")


if __name__ == "__main__":
    main()
