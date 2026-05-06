# Portal database & S3 sync — design for later implementation

This document captures agreed **architecture and schema** so implementation can proceed without re-deriving context. It complements [`ARCHITECTURE.md`](./ARCHITECTURE.md) (S3 layout, `metadata.json`) and replaces ad-hoc chat as the spec source.

**Status:** design only — not implemented in code yet.

---

## Goals

1. **AWS RDS (PostgreSQL recommended)** holds **queryable session state** and portal workflow data.
2. **S3** remains **blob storage** (images, `metadata.json`, `.pt`, exports).
3. **Sync:** when a field tech upload completes / `metadata.json` changes, a **worker** upserts a **DB row** the portal lists and updates.
4. **User identity** stays in **existing Azure SQL** (separate system); this DB stores only **`…_identity_id`** string references (no duplicate auth tables).

**Phase 0 product rule:** everyone in the portal can do everything; **roles** (`admin` / `reviewer` / `labeller`) come later — still log **`actor_identity_id`** on mutations for audit.

---

## Sync pipeline (recommended)

```
S3 (Put/CompleteMultipartUpload on **/metadata.json)
  → SQS (standard + DLQ)
  → Lambda
  → RDS upsert on sessions.session_id
```

- **Filter in Lambda:** only process keys **`…/metadata.json`** (ignore `original.jpg`, `dial_*.jpg` noise) unless you add a deliberate stub path later.
- **Optional:** scope S3 event prefix to `AWS_S3_BASE_PREFIX` if all uploads live under one env prefix.
- **Idempotency:** upsert on **`session_id`** from JSON body; include **`metadata_etag`** / hash to skip no-op writes.
- **Moves:** when the portal (or app) **copies** the session to a new prefix, a new `metadata.json` event fires — update **`s3_session_prefix`** and **`folder_status`** for the same `session_id`.

**Conflict policy (Lambda vs portal):**

- **Device / S3-sourced columns** (predictions, `app_version`, timestamps from metadata, etc.): Lambda **may overwrite** on each sync.
- **Portal-owned columns** (`is_human_reviewed`, `human_verdict`, `review_notes`, `reviewed_*`): Lambda **must not** overwrite unless you add an explicit “device reset review” product rule.

---

## S3 key context (from `server/index.js`)

- Bucket: `AWS_S3_BUCKET` (default `meter-reader-training-feedback`), region `AWS_REGION`.
- Optional root: `AWS_S3_BASE_PREFIX` prepended to all relative prefixes.
- Session = prefix ending in `/` with **`metadata.json`** inside.
- Multiple **roots per portal work type** (e.g. `1000` + `METR`); legacy meter-reading paths at bucket-relative `f_*` / `s_*` and `correct/` / `incorrect/`.
- **One DB row per `session_id`**; dedupe the same way the portal already dedupes listings.

---

## Table: `sessions`

Primary key: **`session_id`** (`text`) — from `metadata.json`.

| Column | Type | Source / notes |
|--------|------|----------------|
| `session_id` | `text` PK | metadata |
| `s3_bucket` | `text` NOT NULL | event |
| `s3_session_prefix` | `text` NOT NULL | derived from object key (trailing `/`) |
| `portal_work_type` | `text` | `1000`…`5000` — infer from scan roots / mapping |
| `s3_root_segment` | `text` nullable | e.g. `METR`, `1000` — debug / analytics |
| `source_type` | `text` | `field` \| `simulator` |
| `folder_status` | `text` | Portal queue: `correct`, `incorrect_new`, `incorrect_analyzed`, … |
| `captured_at` | `timestamptz` | metadata `timestamp` |
| `work_type_code` | `text` nullable | metadata `work_type` |
| `work_type_name` | `text` nullable | metadata |
| `upload_mode` | `text` nullable | metadata |
| `image_source` | `text` nullable | metadata |
| `user_name` | `text` nullable | metadata |
| `user_email` | `text` nullable | metadata if present |
| `ml_prediction` | `text` nullable | metadata |
| `ml_raw_prediction` | `text` nullable | metadata |
| `user_correction` | `text` nullable | metadata |
| `feedback_type` | `text` nullable | metadata |
| `confidence` | `double precision` nullable | metadata |
| `processing_time_ms` | `integer` nullable | metadata |
| `dial_count` | `integer` nullable | metadata |
| `dial_details` | `jsonb` nullable | metadata |
| `app_version` | `text` nullable | metadata |
| `condition_code` | `text` nullable | metadata |
| `image_count` | `integer` NOT NULL DEFAULT 0 | Lambda can `ListObjects` or approximate |
| `is_human_reviewed` | `boolean` NOT NULL DEFAULT false | **Portal**; mirror in metadata.json when write-back exists |
| `human_verdict` | `text` nullable | e.g. `pending`, `correct`, `incorrect`, `not_sure`, `no_dials` |
| `reviewed_at` | `timestamptz` nullable | Portal |
| `reviewed_by_identity_id` | `text` nullable | **Azure / corp id** |
| `review_notes` | `text` nullable | Portal |
| `metadata_etag` | `text` nullable | S3 |
| `metadata_sha256` | `text` nullable | optional |
| `last_metadata_sync_at` | `timestamptz` | Lambda |
| `ingest_source` | `text` | e.g. `s3_lambda`, `portal_backfill` |
| `created_at` | `timestamptz` DEFAULT now() | |
| `updated_at` | `timestamptz` DEFAULT now() | trigger or app |

**Suggested indexes**

- `(folder_status, captured_at DESC)`
- `(is_human_reviewed, folder_status)`
- `(portal_work_type, captured_at DESC)`
- `(source_type, captured_at DESC)`
- `(last_metadata_sync_at)` — reconcile sweeps

Use `CHECK` constraints or Postgres `ENUM`s for `source_type`, `folder_status`, `human_verdict` once values are frozen.

---

## Table: `session_events` (audit)

| Column | Type |
|--------|------|
| `id` | `bigserial` PK |
| `session_id` | `text` FK → `sessions.session_id` |
| `event_type` | `text` — `metadata_sync`, `review_update`, `s3_move`, … |
| `actor_identity_id` | `text` nullable — null for Lambda |
| `payload` | `jsonb` |
| `created_at` | `timestamptz` DEFAULT now() |

Index: `(session_id, created_at DESC)`.

---

## Later tables (pipeline — same DB)

### `dataset_snapshots`

Export / frozen dataset for labeling or training: `id` (uuid PK), `label`, `filter_json`, `session_count`, `image_count`, `s3_zip_key`, `sha256`, `status` (`draft` | `frozen` | `superseded`), `created_by_identity_id`, `created_at`.

### `training_runs`

`id` (uuid PK), `dataset_snapshot_id` (FK nullable), `name`, `state` (`draft` | `dataset_ready` | `training_in_progress` | `artifact_uploaded` | `eval_pending` | `eval_complete` | `promoted` | `failed`), optional Roboflow ids, `notes`, `created_by_identity_id`, timestamps.

### `model_artifacts`

`id` (uuid PK), `training_run_id` (FK), `s3_key`, `file_name`, `sha256`, `size_bytes`, `uploaded_by_identity_id`, `uploaded_at`.

### `evaluations`

`id` (uuid PK), `model_artifact_id` (FK), `metrics_json`, `summary`, optional `s3_report_key`, `created_by_identity_id`, `created_at`.

### `model_versions` (optional release spine)

`id` (uuid PK), `version_label` (unique), `primary_artifact_id`, `primary_eval_id`, `promoted_at`, `promoted_by_identity_id`, `deprecated_at`, `release_notes`.

---

## Minimal v1 scope

Ship **only** `sessions` + `session_events` + Lambda S3 sync + portal read/write against RDS; add pipeline tables when the UI needs them.

---

## iOS / metadata contract note

Add to **`metadata.json`** (when app ships it): **`is_human_reviewed`** (boolean, default `false`).  
DB column name **`is_human_reviewed`** (snake_case); if the app uses camelCase, map once in Lambda / API.

---

## Related docs

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — S3 paths, `metadata.json` field list, API surface today.
- [`DYNAMODB_AND_PIPELINE_ROADMAP.md`](./DYNAMODB_AND_PIPELINE_ROADMAP.md) — older index idea (Dynamo); **this doc supersedes for RDS** unless you explicitly choose DynamoDB instead.

---

## Open implementation choices

- RDS vs Aurora Serverless v2; VPC + Secrets Manager.
- Whether Lambda recomputes **`image_count`** every sync or nightly only (cost vs freshness).
- Whether portal **write-back** updates `metadata.json` on S3 after review (event will re-fire — handler must respect portal-owned column rules).
