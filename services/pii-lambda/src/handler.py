import json
import os
from hashlib import sha256
from urllib.parse import unquote_plus

import boto3

from tagging import tag_payload

s3 = boto3.client("s3")
DEST_BUCKET = os.getenv("VIPER_TAGGED_BUCKET", "")


def _already_processed(bucket: str, key: str) -> bool:
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except s3.exceptions.ClientError:
        return False


def lambda_handler(event, _context):
    processed = 0
    skipped = 0
    for record in event.get("Records", []):
        try:
            bucket = record["s3"]["bucket"]["name"]
            key = unquote_plus(record["s3"]["object"]["key"])
            obj = s3.get_object(Bucket=bucket, Key=key)
            payload = obj["Body"].read().decode("utf-8")
            tags = tag_payload(payload)
            data = json.loads(payload)
            data["pii_tag"] = tags["tag"]
            data["pii_entities"] = tags["entities"]
            data["risk_score"] = tags["risk_score"]
            data["source_hash"] = sha256(payload.encode("utf-8")).hexdigest()

            target_bucket = DEST_BUCKET or bucket
            target_key = key.replace("year=", "tagged/year=", 1)
            if _already_processed(target_bucket, target_key):
                skipped += 1
                continue
            s3.put_object(
                Bucket=target_bucket,
                Key=target_key,
                Body=json.dumps(data).encode("utf-8"),
                ContentType="application/json",
            )
            processed += 1
        except Exception:
            continue
    return {"statusCode": 200, "processed": processed, "skipped": skipped}
