#!/usr/bin/env python3
"""
Re-label capture_location.place_label using neighborhood · city format.

Uses OpenStreetMap Nominatim (rate-limited). Updates S3 metadata.json + DynamoDB index.

Usage:
  python3 scripts/relabel_capture_locations.py --dry-run
  python3 scripts/relabel_capture_locations.py --execute
  AWS_DYNAMODB_SESSIONS_TABLE=amr-sessions python3 scripts/relabel_capture_locations.py --execute --limit 200
"""
from __future__ import annotations

import argparse
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

import boto3
from botocore.config import Config

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_SRC = REPO_ROOT / "src" / ".env"

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "AnalogMeterReader-AMR/1.0 (location relabel backfill)"


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


def normalized(value: str | None) -> str | None:
    if not value:
        return None
    trimmed = value.strip()
    return trimmed or None


def equals_case_insensitive(lhs: str, rhs: str) -> bool:
    return lhs.lower() == rhs.lower()


def format_place_label(area: str | None, city: str | None, state: str | None) -> str | None:
    area = normalized(area)
    city = normalized(city)
    state = normalized(state)
    if area and city and area.lower() != city.lower():
        return f"{area} · {city}"
    if city and state:
        return f"{city}, {state}"
    return city or area or state


def filter_area_key(place_label: str) -> str:
    trimmed = place_label.strip()
    if " · " in trimmed:
        return trimmed.split(" · ", 1)[0].strip()
    if "," in trimmed:
        return trimmed.split(",", 1)[0].strip()
    return trimmed


def reverse_geocode(lat: float, lon: float) -> tuple[str | None, str | None, str | None]:
    params = urllib.parse.urlencode(
        {
            "lat": lat,
            "lon": lon,
            "format": "jsonv2",
            "addressdetails": 1,
        }
    )
    req = urllib.request.Request(
        f"{NOMINATIM_URL}?{params}",
        headers={"User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    addr = data.get("address") or {}
    area = (
        addr.get("suburb")
        or addr.get("neighbourhood")
        or addr.get("quarter")
        or addr.get("hamlet")
        or addr.get("city_district")
    )
    city = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("municipality")
    state = addr.get("state")
    return normalized(area), normalized(city), normalized(state)


def needs_relabel(place_label: str | None) -> bool:
    if not place_label or not place_label.strip():
        return True
    return " · " not in place_label


def iter_metadata_keys(s3, bucket: str, prefixes: list[str]):
    for prefix in prefixes:
        token = None
        while True:
            kwargs = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": 500}
            if token:
                kwargs["ContinuationToken"] = token
            resp = s3.list_objects_v2(**kwargs)
            for obj in resp.get("Contents") or []:
                key = obj["Key"]
                if key.endswith("metadata.json"):
                    yield key
            if not resp.get("IsTruncated"):
                break
            token = resp.get("NextContinuationToken")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0, help="Max sessions to process (0 = all)")
    args = parser.parse_args()

    execute = args.execute and not args.dry_run
    load_dotenv(ENV_SRC)

    bucket = (os.environ.get("AWS_S3_BUCKET") or "meter-reader-training-feedback").strip()
    region = (os.environ.get("AWS_REGION") or "us-east-1").strip()
    table = (os.environ.get("AWS_DYNAMODB_SESSIONS_TABLE") or "").strip()

    if os.environ.get("AWS_PROFILE"):
        for key in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
            os.environ.pop(key, None)

    s3 = boto3.client("s3", region_name=region, config=Config(max_pool_connections=20))

    prefixes = [
        "1000/s_correct/",
        "1000/s_skipped_review/",
        "1000/f_correct/",
        "1000/f_skipped_review/",
        "1000/s_incorrect/",
        "1000/f_incorrect/",
    ]

    scanned = 0
    updated = 0
    skipped = 0
    failed = 0
    last_geocode = 0.0

    print(f"\n{'EXECUTE' if execute else 'DRY RUN'} — relabel capture locations\n")

    for key in iter_metadata_keys(s3, bucket, prefixes):
        if args.limit and scanned >= args.limit:
            break
        scanned += 1

        try:
            meta = json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())
        except Exception as exc:
            failed += 1
            print(f"  ⚠️ read {key}: {exc}")
            continue

        loc = meta.get("capture_location") or {}
        lat = loc.get("latitude")
        lon = loc.get("longitude")
        old_label = loc.get("place_label")

        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            skipped += 1
            continue
        if not needs_relabel(old_label):
            skipped += 1
            continue

        elapsed = time.time() - last_geocode
        if elapsed < 1.1:
            time.sleep(1.1 - elapsed)
        last_geocode = time.time()

        try:
            area, city, state = reverse_geocode(float(lat), float(lon))
            new_label = format_place_label(area, city, state)
        except Exception as exc:
            failed += 1
            print(f"  ⚠️ geocode {meta.get('session_id', key)}: {exc}")
            continue

        if not new_label:
            skipped += 1
            continue

        old_key = filter_area_key(old_label or "")
        new_key = filter_area_key(new_label)
        if old_key.lower() == new_key.lower() and old_label and " · " in old_label:
            skipped += 1
            continue

        if execute:
            loc["place_label"] = new_label
            meta["capture_location"] = loc
            s3.put_object(
                Bucket=bucket,
                Key=key,
                Body=json.dumps(meta, indent=2).encode("utf-8"),
                ContentType="application/json; charset=utf-8",
            )

        updated += 1
        if updated <= 15 or updated % 25 == 0:
            print(f"  {'✅' if execute else '↪'} {meta.get('session_id', key)}")
            print(f"      {old_label!r} → {new_label!r}")

    print(f"\nDone: scanned {scanned}, {'updated' if execute else 'would update'} {updated}, skipped {skipped}, failed {failed}\n")
    if execute and updated > 0 and table:
        print(f"Next: AWS_DYNAMODB_SESSIONS_TABLE={table} npm run backfill:dynamo-sessions\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
