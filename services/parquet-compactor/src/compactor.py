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
CHECKPOINT_BUCKET = os.getenv("VIPER_CHECKPOINT_BUCKET", DEST_BUCKET)
CHECKPOINT_KEY = os.getenv("VIPER_CHECKPOINT_KEY", "compactor/checkpoint.json")
MIN_PARTITION_RECORDS = int(os.getenv("VIPER_MIN_PARTITION_RECORDS", "1"))


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
    object_count = 0
    for obj in _iterate_objects(hour_prefix):
        if not obj["Key"].endswith(".json"):
            continue
        object_count += 1
        raw = s3.get_object(Bucket=SOURCE_BUCKET, Key=obj["Key"])["Body"].read().decode("utf-8")
        records.append(json.loads(raw))
    if not records:
        return {"status": "empty", "prefix": hour_prefix}
    if object_count < MIN_PARTITION_RECORDS:
        return {"status": "incomplete", "prefix": hour_prefix, "objects_seen": object_count}

    table = pa.Table.from_pylist(records)
    sink = io.BytesIO()
    pq.write_table(table, sink, compression="snappy")
    sink.seek(0)

    out_key = hour_prefix.replace("tagged/", "curated/") + f"batch-{int(ts.timestamp())}.parquet"
    try:
        s3.head_object(Bucket=DEST_BUCKET, Key=out_key)
        return {"status": "exists", "rows": len(records), "key": out_key}
    except s3.exceptions.ClientError:
        pass
    s3.put_object(
        Bucket=DEST_BUCKET,
        Key=out_key,
        Body=sink.read(),
        ContentType="application/octet-stream",
    )
    return {"status": "ok", "rows": len(records), "key": out_key}


def _save_checkpoint(output: dict):
    if not CHECKPOINT_BUCKET:
        return
    s3.put_object(
        Bucket=CHECKPOINT_BUCKET,
        Key=CHECKPOINT_KEY,
        Body=json.dumps(output).encode("utf-8"),
        ContentType="application/json",
    )


def run():
    now = datetime.now(timezone.utc)
    outputs = []
    summary = {"ok": 0, "empty": 0, "exists": 0, "incomplete": 0}
    for h in range(BACKFILL_HOURS):
        ts = now.replace(minute=0, second=0, microsecond=0)
        ts = ts.fromtimestamp(ts.timestamp() - (h * 3600), tz=timezone.utc)
        out = _compact_hour(ts)
        outputs.append(out)
        status = out.get("status", "unknown")
        if status in summary:
            summary[status] += 1
        _save_checkpoint({"timestamp": ts.isoformat(), "result": out})
    return {"summary": summary, "outputs": outputs}


if __name__ == "__main__":
    print(run())
