# AMR portal — data architecture

## Current phase: S3 as source of truth

The iOS app uploads **images** and a **`metadata.json`** file per session under a predictable prefix. The portal Node server **lists and parses** those objects, returns **presigned URLs** for images, and can **copy/delete** objects to change review status (folder = workflow stage).

### Session identity

- **`session_id`** in `metadata.json` is the stable primary key for a capture. The portal exposes it as `reading.id`.
- **`s3SessionPrefix`** (full S3 key prefix ending with `/`, e.g. `METR/s_correct/METR_s_20250428_a1b2c3d4/`) is returned with each reading so status changes move the correct folder without guessing paths.

### Metadata contract (`metadata.json`)

Authoritative fields for display and future DynamoDB sync (mirror these columns later):

| Field | Purpose |
|--------|--------|
| `session_id` | Unique session id |
| `timestamp` | ISO capture / upload time |
| `work_type` / `work_type_name` | App work-type code (e.g. `METR`) |
| `upload_mode` | `simulator` / `field` |
| `image_source` | `camera` / `gallery` |
| `user_name` | Collector label from app |
| `feedback_type` | `correct`, `incorrect`, `not_sure`, `no_dials` (folder suffix alignment) |
| `ml_prediction` / `ml_raw_prediction` | Model output |
| `user_correction` | Ground truth when user said incorrect |
| `dial_count`, `confidence`, `processing_time_ms`, `dial_details` | Model diagnostics |
| `app_version` | iOS `AppConfig.appVersion` — group sessions in **Models** analytics to compare generations |

Portal UI and any export should prefer **metadata** over inferring meaning from the path alone.

### S3 layout (aligned with iOS)

Pattern:

```text
{workTypeFolder}/{s_|f_}{statusSuffix}/{session_id}/original.jpg
{workTypeFolder}/{s_|f_}{statusSuffix}/{session_id}/metadata.json
{workTypeFolder}/{s_|f_}{statusSuffix}/{session_id}/dial_N.jpg
```

- **`s_`** = simulator, **`f_`** = field (matches app `UploadMode`).
- Portal “work type” **1000–5000** maps to **both** numeric folders and iOS short codes (e.g. meter reading **1000** scans **`1000/`** and **`METR/`**). See `WORK_TYPE_S3_FOLDER_PREFIXES` in `server/index.js`.

Legacy bucket-root folders (`s_correct/`, `f_incorrect/`, `correct/`, …) remain supported for meter reading (**1000**) only.

## Next phase: DynamoDB as index

Goals when you implement it:

1. **DynamoDB** holds queryable rows keyed by `session_id` (and GSIs for `work_type`, `status`, `timestamp`, `user_name`, etc.).
2. **S3** remains blob storage; each Dynamo item stores `s3SessionPrefix` or explicit keys for `original.jpg` / `metadata.json`.
3. **Portal API** swaps list/detail implementation to **Query Dynamo** + presign S3 from stored keys, with the same JSON shape to the frontend where possible.
4. **Sync options**: S3 event → Lambda upsert; periodic backfill from S3; or dual-write from the app after upload.

**Detailed roadmap** (Dynamo keys, Lambda vs iOS, migration steps, effort, Roboflow linkage, semantics): **[`docs/DYNAMODB_AND_PIPELINE_ROADMAP.md`](./DYNAMODB_AND_PIPELINE_ROADMAP.md)**.

Until then, the server module keeps listing logic centralized; the HTTP routes are the integration surface the React app calls.

## Roboflow

Roboflow integration stays **server-side** (API key in env). The portal can push sessions to datasets for labeling; model evaluation scores live in Roboflow and are optional follow-ons.

## Portal HTTP API (S3 phase)

- **`GET /api/readings`** — Query `source`, `workType` (portal code `1000`…`5000`). Returns readings with **`s3SessionPrefix`** when known.
- **`GET /api/readings/:id`** — Optional `?workType=1000` tries that portal scope first (faster, uses cache), then falls back across all portal work types until the `session_id` is found.
- **`POST /api/readings/bulk-move`** — Body entries may include **`s3SessionPrefix`**. When present, the server moves objects under that prefix to the target status folder (correct layout for `METR/…` and `1000/…`). When omitted, legacy root-only move logic is used.
- **`GET /api/model-analytics`** — Query `source`, `workType`. Returns per-`app_version` aggregates (session counts, queue rates, mean confidence / latency / dial count) for the **Models** page.
- **`GET /api/export/incorrect-retrain-zip`** — Query `source`, `workType`. Streams a **ZIP** of every session in any **`incorrect_*`** queue: one folder per `session_id` with `original.jpg`, `dial_*.jpg`, and `metadata.json`. Optional env **`EXPORT_INCORRECT_MAX_SESSIONS`** (default 3000) caps count per request.

## Security

- Do not commit AWS keys or Firebase service account JSON; use `.env` / `src/.env` per `.env.example`.
- Presigned URLs expire (currently 1 hour); refresh by reloading readings.
