#!/usr/bin/env python3
"""
Bulk reclassify mis-tagged field S3 sessions → simulator (awaiting review).

Keep Field only when capture day is 2026-05-29 … 2026-05-31 (UTC date) and
collector is not reetika* / nirmala.

Uses concurrent S3 copy/delete (much faster than sequential Node script).
After --execute, run: npm run backfill:dynamo-sessions

Usage:
  python3 scripts/reclassify_field_sessions_bulk.py --dry-run
  python3 scripts/reclassify_field_sessions_bulk.py --execute
  python3 scripts/reclassify_field_sessions_bulk.py --execute --workers 32 --work-type 1000
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import boto3
from botocore.config import Config

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_SRC = REPO_ROOT / "src" / ".env"

FIELD_WINDOW_DAYS = {"2026-05-29", "2026-05-30", "2026-05-31"}

WORK_TYPES = ["1000", "2000", "3000", "4000", "5000"]
WORK_TYPE_S3_FOLDER_PREFIXES = {
    "1000": ["1000", "METR"],
    "2000": ["2000", "GO95"],
    "3000": ["3000", "RISR"],
    "4000": ["4000", "LEAK"],
    "5000": ["5000", "INTR"],
}

STATUS_FOLDER_MAP = {
    "correct": "correct",
    "incorrect_new": "incorrect",
    "incorrect_analyzed": "incorrect_analyzed",
    "incorrect_labeled": "incorrect_labeled",
    "incorrect_training": "incorrect_training",
    "no_dials": "no_dials",
    "not_sure": "not_sure",
}

DAY_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})")

_print_lock = threading.Lock()


def load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def log(msg: str) -> None:
    with _print_lock:
        print(msg, flush=True)


def with_s3_base(relative: str, base_prefix: str) -> str:
    rel = relative.lstrip("/")
    if not base_prefix:
        return rel
    return f"{base_prefix.rstrip('/')}/{rel}"


def is_internal_test_collector(user_name: str) -> bool:
    name = (user_name or "").strip().lower()
    if not name:
        return False
    return name.startswith("reetika") or name == "nirmala"


def capture_day_key(iso: str | None) -> str | None:
    if not iso:
        return None
    m = DAY_RE.match(str(iso).strip())
    return m.group(1) if m else None


def should_stay_field(metadata: dict) -> bool:
    user = metadata.get("user_name") or metadata.get("user_email") or ""
    if is_internal_test_collector(user):
        return False
    day = capture_day_key(metadata.get("timestamp"))
    return bool(day and day in FIELD_WINDOW_DAYS)


def rewrite_prefix_source(source_prefix: str, target_source: str) -> str | None:
    norm = source_prefix if source_prefix.endswith("/") else f"{source_prefix}/"
    parts = [p for p in norm.split("/") if p]
    for i in range(len(parts) - 2, -1, -1):
        seg = parts[i]
        if seg.startswith("f_") or seg.startswith("s_"):
            suffix = seg[2:]
            mode = "f_" if target_source == "field" else "s_"
            parts[i] = f"{mode}{suffix}"
            return "/".join(parts) + "/"
        if seg == "correct" and target_source == "simulator":
            parts[i] = "s_correct"
            return "/".join(parts) + "/"
        if seg == "incorrect" and target_source == "simulator":
            parts[i] = "s_incorrect"
            return "/".join(parts) + "/"
    return None


def get_field_folder_jobs(work_type: str, s3_base: str) -> list[tuple[str, str]]:
    jobs: list[tuple[str, str]] = []
    roots = WORK_TYPE_S3_FOLDER_PREFIXES.get(work_type, [work_type])
    for root in dict.fromkeys(roots):
        for status, suffix in STATUS_FOLDER_MAP.items():
            jobs.append((with_s3_base(f"{root}/f_{suffix}/", s3_base), status))
        jobs.append((with_s3_base(f"{root}/f_skipped_review/", s3_base), "incorrect_new"))

    if work_type == "1000":
        for status, suffix in STATUS_FOLDER_MAP.items():
            jobs.append((with_s3_base(f"f_{suffix}/", s3_base), status))
        jobs.append((with_s3_base("f_skipped_review/", s3_base), "incorrect_new"))
        jobs.append((with_s3_base("correct/", s3_base), "correct"))
        jobs.append((with_s3_base("incorrect/", s3_base), "incorrect_new"))

    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for folder, status in jobs:
        if folder not in seen:
            seen.add(folder)
            out.append((folder, status))
    return out


def list_session_prefixes(s3, bucket: str, folder: str) -> list[str]:
    prefix = folder if folder.endswith("/") else f"{folder}/"
    out: list[str] = []
    token = None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix, "Delimiter": "/"}
        if token:
            kwargs["ContinuationToken"] = token
        resp = s3.list_objects_v2(**kwargs)
        for cp in resp.get("CommonPrefixes") or []:
            if cp.get("Prefix"):
                out.append(cp["Prefix"])
        if not resp.get("IsTruncated"):
            break
        token = resp.get("NextContinuationToken")
    return out


def list_object_keys(s3, bucket: str, prefix: str) -> list[str]:
    norm = prefix if prefix.endswith("/") else f"{prefix}/"
    keys: list[str] = []
    token = None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": norm}
        if token:
            kwargs["ContinuationToken"] = token
        resp = s3.list_objects_v2(**kwargs)
        for obj in resp.get("Contents") or []:
            if obj.get("Key"):
                keys.append(obj["Key"])
        if not resp.get("IsTruncated"):
            break
        token = resp.get("NextContinuationToken")
    return keys


def read_metadata(s3, bucket: str, prefix: str) -> dict | None:
    key = f"{prefix}metadata.json"
    try:
        body = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
        return json.loads(body)
    except s3.exceptions.NoSuchKey:
        return None
    except Exception as e:
        if "NoSuchKey" in str(e) or "404" in str(e):
            return None
        raise


def copy_keys_parallel(s3, bucket: str, jobs: list[tuple[str, str]], copy_workers: int) -> None:
    def _copy(pair: tuple[str, str]) -> None:
        src, dst = pair
        s3.copy_object(Bucket=bucket, CopySource={"Bucket": bucket, "Key": src}, Key=dst)

    with ThreadPoolExecutor(max_workers=copy_workers) as pool:
        list(pool.map(_copy, jobs))


def delete_keys_batch(s3, bucket: str, keys: list[str]) -> None:
    for i in range(0, len(keys), 1000):
        chunk = keys[i : i + 1000]
        s3.delete_objects(
            Bucket=bucket,
            Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True},
        )


def move_session(
    s3,
    bucket: str,
    source_prefix: str,
    *,
    execute: bool,
    copy_workers: int,
) -> str:
    target_prefix = rewrite_prefix_source(source_prefix, "simulator")
    if not target_prefix or target_prefix == source_prefix:
        return "failed:bad_prefix"

    metadata = read_metadata(s3, bucket, source_prefix)
    if metadata is None:
        if read_metadata(s3, bucket, target_prefix) is not None:
            return "skipped:already_at_target"
        return "skipped:no_metadata"

    if should_stay_field(metadata):
        return "keep_field"

    if not execute:
        return "would_move"

    keys = list_object_keys(s3, bucket, source_prefix)
    if not keys:
        return "failed:empty"

    copy_jobs = []
    for key in keys:
        rel = key[len(source_prefix) :] if key.startswith(source_prefix) else key
        copy_jobs.append((key, f"{target_prefix}{rel}"))

    copy_keys_parallel(s3, bucket, copy_jobs, copy_workers)

    metadata["upload_mode"] = "simulator"
    s3.put_object(
        Bucket=bucket,
        Key=f"{target_prefix}metadata.json",
        Body=json.dumps(metadata, indent=2).encode("utf-8"),
        ContentType="application/json; charset=utf-8",
    )

    delete_keys_batch(s3, bucket, keys)
    return "moved"


def collect_jobs(s3, bucket: str, work_types: list[str], s3_base: str) -> list[str]:
    prefixes: list[str] = []
    for wt in work_types:
        for folder, _status in get_field_folder_jobs(wt, s3_base):
            found = list_session_prefixes(s3, bucket, folder)
            log(f"📂 {folder} → {len(found)} sessions")
            prefixes.extend(found)
    return prefixes


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--workers", type=int, default=24)
    parser.add_argument("--copy-workers", type=int, default=8)
    parser.add_argument("--work-type", action="append", dest="work_types")
    args = parser.parse_args()

    execute = args.execute and not args.dry_run
    load_dotenv(ENV_SRC)

    bucket = (os.environ.get("AWS_S3_BUCKET") or "meter-reader-training-feedback").strip()
    region = (os.environ.get("AWS_REGION") or "us-east-1").strip()
    s3_base = (os.environ.get("AWS_S3_BASE_PREFIX") or "").strip()
    work_types = args.work_types or WORK_TYPES

    if os.environ.get("AWS_PROFILE"):
        os.environ.pop("AWS_ACCESS_KEY_ID", None)
        os.environ.pop("AWS_SECRET_ACCESS_KEY", None)
        os.environ.pop("AWS_SESSION_TOKEN", None)

    cfg = Config(max_pool_connections=max(50, args.workers * 4), retries={"max_attempts": 10})
    s3 = boto3.client("s3", region_name=region, config=cfg)

    mode = "EXECUTE" if execute else "DRY RUN"
    log(f"\n🚀 {mode} — bulk reclassify field → simulator")
    log(f"   Bucket: s3://{bucket}/")
    log(f"   Workers: {args.workers} sessions, {args.copy_workers} copies/session")
    log(f"   Keep field: {', '.join(sorted(FIELD_WINDOW_DAYS))} (non-internal only)\n")

    session_prefixes = collect_jobs(s3, bucket, work_types, s3_base)
    log(f"\n📋 {len(session_prefixes)} field session folders to inspect\n")

    counts = {
        "keep_field": 0,
        "would_move": 0,
        "moved": 0,
        "skipped:already_at_target": 0,
        "skipped:no_metadata": 0,
        "failed:bad_prefix": 0,
        "failed:empty": 0,
    }

    def task(prefix: str) -> tuple[str, str]:
        result = move_session(
            s3,
            bucket,
            prefix,
            execute=execute,
            copy_workers=args.copy_workers,
        )
        return prefix, result

    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(task, p): p for p in session_prefixes}
        for fut in as_completed(futures):
            prefix, result = fut.result()
            bucket_key = result if result in counts else "failed:other"
            if bucket_key not in counts:
                counts[bucket_key] = 0
            counts[bucket_key] += 1
            done += 1
            if result == "moved" and (done <= 10 or done % 50 == 0):
                log(f"   ✅ [{done}/{len(session_prefixes)}] {prefix.split('/')[-2]}")
            elif result.startswith("failed") and done <= 30:
                log(f"   ⚠️ {prefix}: {result}")

    moved = counts["moved"] + counts["would_move"]
    log(
        f"\n✅ Done: keep field {counts['keep_field']}, "
        f"{'moved' if execute else 'would move'} {moved}, "
        f"already moved {counts['skipped:already_at_target']}, "
        f"no metadata {counts['skipped:no_metadata']}, "
        f"failed {counts['failed:bad_prefix'] + counts['failed:empty']}\n"
    )

    if execute and moved > 0:
        log("Next: AWS_DYNAMODB_SESSIONS_TABLE=amr-sessions npm run backfill:dynamo-sessions\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
