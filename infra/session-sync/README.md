# DynamoDB session index + Lambda sync

Portal lists and filters sessions from **DynamoDB** instead of scanning S3. Images and `metadata.json` remain on **S3** (source of truth). A Lambda upserts Dynamo when `metadata.json` is written; the portal **dual-writes** Dynamo on reviewer saves and bulk-moves.

## Before you deploy — correct AWS account

AMR prod lives in **`us-west-2`** (Elastic Beanstalk). Your laptop may have other AWS profiles (e.g. Beanstalk in a different account).

**Always verify before deploy:**

```bash
export AWS_PROFILE=<your-amr-profile>   # not the default if that is the wrong account
export AWS_REGION=us-west-2

aws sts get-caller-identity
aws s3api head-bucket --bucket meter-reader-training-feedback
aws elasticbeanstalk describe-environments --region us-west-2 \
  --query "Environments[?contains(EnvironmentName,'amrportal')].EnvironmentName"
```

If `head-bucket` returns **403** or EB list is **empty**, you are on the **wrong account** — switch profile or run `aws configure --profile amr`.

## Deploy (SAM)

From this directory (with `AWS_PROFILE` + region set):

```bash
cd meter_reading_website/infra/session-sync
sam build
sam deploy \
  --stack-name amr-session-index \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM \
  --region us-west-2 \
  --parameter-overrides SessionsTableName=amr-sessions S3BucketName=meter-reader-training-feedback \
  --no-confirm-changeset
```

Note the outputs: `SessionsTableName`, `SessionSyncFunctionArn`.

## Wire S3 → Lambda (existing bucket)

After deploy, add a notification on your **existing** bucket (merges with any existing config):

```bash
export BUCKET=meter-reader-training-feedback
export LAMBDA_ARN="<SessionSyncFunctionArn from deploy>"

aws lambda add-permission \
  --function-name "$(aws lambda list-functions --query "Functions[?contains(FunctionName,'amr-session-sync')].FunctionName | [0]" --output text)" \
  --statement-id s3-metadata-sync \
  --action lambda:InvokeFunction \
  --principal s3.amazonaws.com \
  --source-arn "arn:aws:s3:::${BUCKET}" \
  --source-account "$(aws sts get-caller-identity --query Account --output text)"

# Save current notifications, append Lambda rule, put back (adjust if you already have notifications)
aws s3api put-bucket-notification-configuration --bucket "${BUCKET}" --notification-configuration '{
  "LambdaFunctionConfigurations": [{
    "Id": "amr-metadata-json-sync",
    "LambdaFunctionArn": "'"${LAMBDA_ARN}"'",
    "Events": ["s3:ObjectCreated:*"],
    "Filter": { "Key": { "FilterRules": [{ "Name": "suffix", "Value": "metadata.json" }] } }
  }]
}'
```

If the bucket already has notifications, merge manually in the AWS Console (S3 → Properties → Event notifications).

## Portal env

Add to `.env` / Elastic Beanstalk / hosting env:

```env
AWS_DYNAMODB_SESSIONS_TABLE=amr-sessions
# Optional: fall back to S3 listing if Dynamo query fails
DYNAMO_SESSIONS_FALLBACK_S3=true
# Optional: presign original.jpg for list thumbnails (default true)
DYNAMO_ATTACH_LIST_IMAGES=true
```

IAM user/role for the portal needs `dynamodb:GetItem`, `Query`, `PutItem`, `UpdateItem` on the table (+ `s3:*` as today).

## Backfill existing S3 sessions

```bash
cd meter_reading_website
npm run backfill:dynamo-sessions
# Or one work type:
AWS_DYNAMODB_SESSIONS_TABLE=amr-sessions node scripts/backfill-dynamo-sessions.mjs --work-type=1000
```

Run once after deploy, before switching traffic. New uploads sync via Lambda automatically.

## Rollback

Unset `AWS_DYNAMODB_SESSIONS_TABLE` on the portal — it reverts to S3 listing. Dynamo and Lambda can stay in place.
