import pathlib
import sys
import types

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1] / "src"))

boto3_stub = types.SimpleNamespace(client=lambda *_args, **_kwargs: types.SimpleNamespace())
sys.modules.setdefault("boto3", boto3_stub)
pyarrow_module = types.ModuleType("pyarrow")
pyarrow_module.Table = types.SimpleNamespace(from_pylist=lambda rows: rows)
parquet_module = types.ModuleType("pyarrow.parquet")
parquet_module.write_table = lambda *_args, **_kwargs: None
sys.modules.setdefault("pyarrow", pyarrow_module)
sys.modules.setdefault("pyarrow.parquet", parquet_module)

import compactor  # noqa: E402


def test_iterate_objects_handles_single_page(monkeypatch):
    class FakeS3:
        def list_objects_v2(self, **_kwargs):
            return {"Contents": [{"Key": "tagged/year=2026/file.json"}], "IsTruncated": False}

    monkeypatch.setattr(compactor, "s3", FakeS3())
    out = list(compactor._iterate_objects("tagged/"))
    assert len(out) == 1


def test_run_returns_summary(monkeypatch):
    monkeypatch.setattr(compactor, "BACKFILL_HOURS", 1)
    monkeypatch.setattr(compactor, "_compact_hour", lambda _ts: {"status": "empty", "prefix": "p"})
    monkeypatch.setattr(compactor, "_save_checkpoint", lambda _payload: None)
    result = compactor.run()
    assert "summary" in result
    assert result["summary"]["empty"] == 1
