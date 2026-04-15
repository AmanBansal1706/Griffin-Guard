import io
import json
import os
from datetime import datetime, timezone

import boto3
import pyarrow as pa
import pyarrow.parquet as pq

s3 = boto3.client("s3")
SOURCE_BUCKET = os.getenv("VIPER_SOURCE_BUCKET")
DEST_BUCKET = os.getenv("VIPER_CURATED_BUCKET")
PREFIX = os.getenv("VIPER_SOURCE_PREFIX", "tagged/")
BACKFILL_HOURS = int(os.getenv("VIPER_BACKFILL_HOURS", "1"))


def _iterate_objects(prefix: str):
    token = None
    while True:
        params = {"Bucket": SOURCE_BUCKET, "Prefix": prefix}
        if token:
            params["ContinuationToken"] = token
        page = s3.list_objects_v2(**params)
        for obj in page.get("Contents", []):
            yield obj
        if not page.get("IsTruncated"):
            break
        token = page.get("NextContinuationToken")


def _compact_hour(ts: datetime):
    hour_prefix = f"{PREFIX}year={ts.year:04d}/month={ts.month:02d}/day={ts.day:02d}/hour={ts.hour:02d}/"
    records = []
    for obj in _iterate_objects(hour_prefix):
        if not obj["Key"].endswith(".json"):
            continue
        raw = s3.get_object(Bucket=SOURCE_BUCKET, Key=obj["Key"])["Body"].read().decode("utf-8")
        records.append(json.loads(raw))
    if not records:
        return {"status": "empty", "prefix": hour_prefix}

    table = pa.Table.from_pylist(records)
    sink = io.BytesIO()
    pq.write_table(table, sink, compression="snappy")
    sink.seek(0)

    out_key = hour_prefix.replace("tagged/", "curated/") + "batch.parquet"
    s3.put_object(
        Bucket=DEST_BUCKET,
        Key=out_key,
        Body=sink.read(),
        ContentType="application/octet-stream",
    )
    return {"status": "ok", "rows": len(records), "key": out_key}


def run():
    now = datetime.now(timezone.utc)
    outputs = []
    for h in range(BACKFILL_HOURS):
        ts = now.replace(minute=0, second=0, microsecond=0)
        ts = ts.fromtimestamp(ts.timestamp() - (h * 3600), tz=timezone.utc)
        outputs.append(_compact_hour(ts))
    return outputs


if __name__ == "__main__":
    print(run())
