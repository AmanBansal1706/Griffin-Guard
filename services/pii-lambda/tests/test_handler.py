import json
import pathlib
import sys
import types

import pytest

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1] / "src"))

boto3_stub = types.SimpleNamespace(client=lambda *_args, **_kwargs: types.SimpleNamespace())
sys.modules.setdefault("boto3", boto3_stub)

import handler  # noqa: E402


def test_already_processed_false_on_missing_object(monkeypatch):
    class FakeClientError(Exception):
        pass

    class FakeS3:
        class exceptions:  # noqa: D106
            ClientError = FakeClientError

        def head_object(self, **_kwargs):
            raise FakeClientError("missing")

    monkeypatch.setattr(handler, "s3", FakeS3())
    assert handler._already_processed("b", "k") is False


def test_with_retry_eventually_succeeds():
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] < 2:
            raise RuntimeError("retry")
        return "ok"

    assert handler._with_retry(flaky) == "ok"


def test_lambda_handler_handles_empty_records(monkeypatch):
    monkeypatch.setattr(handler, "s3", object())
    result = handler.lambda_handler({"Records": []}, None)
    assert result["statusCode"] == 200
    assert result["processed"] == 0
    assert result["errors"] == 0


def test_send_to_dlq_writes_payload(monkeypatch):
    writes = []

    class FakeS3:
        def put_object(self, **kwargs):
            writes.append(kwargs)
            return {}

    monkeypatch.setattr(handler, "s3", FakeS3())
    monkeypatch.setattr(handler, "DLQ_BUCKET", "dlq-bucket")
    handler._send_to_dlq({"eventTime": "now"}, "boom")
    assert len(writes) == 1
    body = json.loads(writes[0]["Body"].decode("utf-8"))
    assert body["error"] == "boom"
