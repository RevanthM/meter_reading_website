# Deploy to AWS Elastic Beanstalk

| Environment | Branch (auto-deploy) | Purpose |
|---------------|----------------------|---------|
| `amrportal` | `main` | Production — single instance, no ALB (clone dev config) |
| `meter-reading-dev` | `reetika` | Dev / staging |
| `meter-reading-prod` | manual only | Legacy load-balanced prod |

## Prerequisites

1. **AWS credentials** for the account that **owns** that Elastic Beanstalk application (not necessarily the same account as other apps on your laptop). Configure with `aws configure` or `export AWS_PROFILE=...`.
2. **EB CLI** (optional but easiest): `brew install aws-elasticbeanstalk` then `eb --version`.
3. **Region**: `us-west-2` (from the hostname unless your environment was moved).

Verify the environment exists for your profile:

```bash
aws elasticbeanstalk describe-environments --region us-west-2 \
  --query "Environments[?contains(CNAME, 'meter-reading') || EnvironmentName=='meter-reading-prod'].[EnvironmentName,ApplicationName,CNAME]" \
  --output table
```

If this returns **empty**, switch to the IAM user/role that created the EB environment (or ask the account owner for deploy permissions).

## First-time setup (`eb init`)

From the repo root (`meter_reading_website/`):

```bash
cd meter_reading_website
eb init
```

- Pick **the same region** as the environment (`us-west-2`).
- Choose **Use an existing application** and select the application that contains `meter-reading-prod` (exact names are in the [Elastic Beanstalk console](https://console.aws.amazon.com/elasticbeanstalk)).

This creates `.elasticbeanstalk/config.yml` (local only; sensitive bits stay out of git per `.gitignore`).

Link the CLI to the environment:

```bash
eb use amrportal
# replace with the exact Environment name from the console if different
```

## Create a new environment

GitHub Actions → **Create Elastic Beanstalk environment** → set name, pick **standard** (single instance, no ALB), clone env vars from an existing env. **Terminate** an environment with the same name first if recreating.

Or locally (account with EB permissions):

```bash
aws elasticbeanstalk describe-environments --region us-west-2 \
  --environment-names amrportal --output table
```

After the env is **Ready**, deploy via **Deploy to Elastic Beanstalk** (target `amrportal`) or push to `main`.

## Build and deploy

The app serves the Vite build from `dist/` via `server/index.js`. **Commit a fresh `dist/`** (or run a CI step that builds before `eb deploy`) so production does not need devDependencies for `vite build`.

```bash
npm ci
npm run build
eb deploy
```

`Procfile` runs `web: npm start` → `node server/index.js`, which listens on `PORT` (set by Elastic Beanstalk).

## Environment properties

Set in the EB console → **Configuration** → **Software** → **Environment properties** (or SSM), for example:

- `AWS_S3_BUCKET`, `AWS_REGION`, `AWS_S3_BASE_PREFIX` (if used)
- `FIREBASE_SERVICE_ACCOUNT_BASE64`, `VITE_*` Firebase client vars as required by `server/index.js` / the SPA
- **`ROBOFLOW_API_KEY`** — required for Model Factory / Roboflow Hub (`/api/roboflow/*`). Use the same private key as local `src/.env`. **Never** prefix with `VITE_` (the browser must not see it).
- **`ROBOFLOW_WORKSPACE`** (optional) — e.g. `analoggasmeter` if auto-resolve from the API key fails.

Deploy zips **exclude** `.env` and `src/.env` (see `.github/workflows/deploy-eb.yml`), so Roboflow works locally but stays off in EB until you set these properties.

Verify after an environment restart:

```bash
curl -sS "https://<your-prod-host>/api/health" | jq .roboflow
curl -sS "https://<your-prod-host>/api/roboflow/status"
```

Expect `"roboflow": true` and `{ "configured": true, "workspace": "..." }`.

CLI (same account/region as the environment):

```bash
eb use meter-reading-prod
eb setenv ROBOFLOW_API_KEY='your_key' ROBOFLOW_WORKSPACE='analoggasmeter'
```

Do **not** commit real `.env` files; configure secrets only in EB or AWS Secrets Manager.

## Alternative: deploy without EB CLI

Create a zip of the project (excluding `node_modules` per `.ebignore`), upload to S3, then `create-application-version` + `update-environment` via AWS CLI or CodePipeline. The EB CLI wraps the same API.
