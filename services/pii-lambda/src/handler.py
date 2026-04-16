import json
import os
import time
from hashlib import sha256
from urllib.parse import unquote_plus

import boto3

from tagging import tag_payload

s3 = boto3.client("s3")
DEST_BUCKET = os.getenv("VIPER_TAGGED_BUCKET", "")
DLQ_BUCKET = os.getenv("VIPER_DLQ_BUCKET", "")
MAX_RETRIES = int(os.getenv("VIPER_S3_MAX_RETRIES", "3"))
RETRY_BASE_SECONDS = float(os.getenv("VIPER_S3_RETRY_BASE_SECONDS", "0.3"))


def _already_processed(bucket: str, key: str) -> bool:
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except s3.exceptions.ClientError:
        return False


def _with_retry(fn):
    last_exc = None
    for attempt in range(MAX_RETRIES):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt == MAX_RETRIES - 1:
                break
            time.sleep(RETRY_BASE_SECONDS * (2**attempt))
    raise last_exc


def _send_to_dlq(record, error_message: str):
    if not DLQ_BUCKET:
        return
    key = f"dlq/{record.get('eventTime', 'unknown')}-{sha256(str(record).encode('utf-8')).hexdigest()}.json"
    _with_retry(
        lambda: s3.put_object(
            Bucket=DLQ_BUCKET,
            Key=key,
            Body=json.dumps({"record": record, "error": error_message}).encode("utf-8"),
            ContentType="application/json",
        )
    )


def lambda_handler(event, _context):
    processed = 0
    skipped = 0
    errors = []
    for record in event.get("Records", []):
        try:
            bucket = record["s3"]["bucket"]["name"]
            key = unquote_plus(record["s3"]["object"]["key"])
            obj = _with_retry(lambda: s3.get_object(Bucket=bucket, Key=key))
            payload = obj["Body"].read().decode("utf-8")
            tags = tag_payload(payload)
            try:
                data = json.loads(payload)
            except json.JSONDecodeError as exc:
                raise ValueError(f"malformed JSON payload in {bucket}/{key}: {exc}") from exc
            data["pii_tag"] = tags["tag"]
            data["pii_entities"] = tags["entities"]
            data["risk_score"] = tags["risk_score"]
            data["source_hash"] = sha256(payload.encode("utf-8")).hexdigest()

            target_bucket = DEST_BUCKET or bucket
            target_key = key.replace("year=", "tagged/year=", 1)
            if _already_processed(target_bucket, target_key):
                skipped += 1
                continue
            _with_retry(
                lambda: s3.put_object(
                    Bucket=target_bucket,
                    Key=target_key,
                    Body=json.dumps(data).encode("utf-8"),
                    ContentType="application/json",
                )
            )
            processed += 1
        except Exception as exc:
            errors.append({"record": record, "error": str(exc)})
            _send_to_dlq(record, str(exc))
            continue
    return {"statusCode": 200, "processed": processed, "skipped": skipped, "errors": len(errors)}
