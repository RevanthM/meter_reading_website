# DynamoDB, Lambda, and pipeline — future reference

This document captures **decisions and options** discussed for AMR (Analog Meter Reader): indexing, AWS automation, Roboflow linkage, and how they relate to the **portal** and **iOS** without re-reading old threads.

**Companion:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) describes the **current** S3-first portal and HTTP API.

---

## Goals

- **Portal:** fast lists, filters, and analytics without scanning the entire S3 prefix tree on every request.
- **iOS:** keep the **current flow** — upload images + `metadata.json` to S3 **as today** (no requirement to change the app for Dynamo).
- **S3:** remain the **blob store** indefinitely (JPEGs / PNGs). Dynamo is an **index + queryable fields**, not a replacement for object storage.

---

## Recommended architecture (best practice)

| Layer | Role |
|--------|------|
| **iOS** | Upload session folder to **S3** only (unchanged). |
| **Lambda** (or worker) | On **S3 `ObjectCreated`** for `**/metadata.json` (or periodic crawl): **read JSON** → **`PutItem` / `UpdateItem`** in DynamoDB. Idempotent on `session_id`. |
| **DynamoDB** | One **item per session** + **GSI(s)** for dashboard queries (work type + status + time). |
| **Portal API** | List/detail from **Dynamo**; build **presigned URLs** for images using **`s3_session_prefix`** (or explicit keys) on the item. |
| **Portal bulk-move** | Today: S3 copy/delete. Later: **same transaction or follow-up** → **update Dynamo `status` (+ GSI keys)** so the index matches folders. |

**Why not rely on iOS writing Dynamo too?**

- Two writers (app + Lambda) → **conflicts, ordering, partial failures** unless carefully designed.
- **Credentials on device** are weaker than **IAM on Lambda**.
- You still need a **replay from S3** path if anything misses an event — so **S3 → Lambda** is the clean default.

**Optional later:** a minimal iOS `PutItem` after upload is only a **bridge** if Lambda is not ready; treat S3 + Lambda as source of truth and **reconcile** from S3.

---

## DynamoDB data model (sketch)

**Primary key**

- **`session_id`** (string, same as `metadata.json`) as **partition key** — O(1) get by id.

**Attributes (mirror `metadata.json` + portal fields)**

- `timestamp`, `work_type`, `upload_mode`, `image_source`, `user_name`
- `feedback_type`, `ml_prediction`, `ml_raw_prediction`, `user_correction`
- `dial_count`, `confidence`, `processing_time_ms`, `dial_details` (as Map/List as appropriate)
- `app_version` (and later Roboflow fields — see below)
- **`status`** — portal queue: `correct`, `incorrect_new`, `incorrect_analyzed`, … (must stay in sync when folders move)
- **`s3_bucket`**, **`s3_session_prefix`** — for presigning `original.jpg`, `dial_*.jpg`, etc.

**GSI example (for list pages)**

- **GSI1 partition key:** e.g. `WT#1000#ST#incorrect_new` (portal work type + status)
- **GSI1 sort key:** ISO `timestamp` descending  
  → Query “all incorrect_new for meter reading, newest first” without S3 listing.

Adjust naming to your single-table conventions if you adopt a broader AMR table later.

---

## Population and migration

1. **Create table + GSI(s)** in AWS (Console, CDK, SAM, Terraform).
2. **Backfill:** one-off script or job that walks the same prefixes the portal uses today, parses each `metadata.json`, **upserts** Dynamo (may take hours for huge buckets; use pagination and backoff).
3. **Incremental:** **S3 event notification** → **Lambda** on `metadata.json` **Put** (filter by prefix if possible).
4. **Portal:** switch **read** path from `getAllReadings` (S3 scan) to **Query/Scan** Dynamo (with GSIs); keep **GetObject/presign** for images from S3.
5. **Bulk-move / status change:** update **both** S3 and Dynamo until stable; then you can **stop** full-bucket listing for the main dashboard (S3 remains for objects).

**“Disable S3 checks”** means: stop using S3 **listing** as the index — **not** deleting the bucket or stopping image reads.

---

## Rough effort (order of magnitude)

| Work | Calendar (one engineer, familiar with AWS) |
|------|-----------------------------------------------|
| Table + IAM + Lambda + S3 event + DLQ | ~0.5–2 days |
| Backfill existing data | ~1 day (volume-dependent) |
| Portal read path + counts from Dynamo | ~2–4 days |
| Bulk-move updates Dynamo | ~0.5–1 day |

Repo can hold **SAM/CDK + handler code + README**; **deploy** uses your AWS account (`sam deploy`, etc.).

---

## Roboflow ↔ release linkage (recap)

- **Roboflow “accuracy”** (mAP, validation metrics) = **dataset / train run** quality in Roboflow.
- **Portal “Models” metrics** = **queue rates by `app_version`** (user feedback folders) — **not** the same as Roboflow mAP; label clearly in UI.

**Linkage:** add to `metadata.json` (from iOS constants when you ship a build) alongside `app_version`:

- e.g. `roboflow_dataset_version`, optional `roboflow_project` / workspace slug  
  Set manually at first when you export → Core ML → bump app; automate from Roboflow API later.

Portal then parses those fields in `parseSession` (when implemented) and shows them on reading detail / analytics.

---

## Field semantics (for stakeholders)

- **Incorrect sessions:** determined **in the app** when the user taps **Incorrect** (and optional correction); S3 folder + `feedback_type` reflect that. Sub-statuses (`incorrect_analyzed`, …) are **portal workflow** moves.
- **ZIP export for retrain:** `GET /api/export/incorrect-retrain-zip` — all `incorrect_*` queues for chosen work type + source; see `ARCHITECTURE.md`.

---

## Security reminder

- Avoid long-lived **AWS keys in the iOS app**; prefer **presigned uploads** or **server/API** for credentials. Rotate any keys that were ever embedded in a binary.

---

## Where to continue portal work

Application code for the portal lives under **`meter_reading_website/`** (`src/`, `server/`). New backend indexing should live in **this repo’s server** or a **separate infra repo** (Lambda/IaC), depending on team preference — link both in the main README when you add Lambda.

When you pick up **portal-only** work again, start from **`server/index.js`** (API + S3) and **`src/`** (React routes, contexts, components).
