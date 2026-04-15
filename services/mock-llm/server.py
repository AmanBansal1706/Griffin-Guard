from flask import Flask, Response, request
import json
import time

app = Flask(__name__)


@app.post("/v1/chat/completions")
def chat():
    payload = request.get_json(force=True, silent=True) or {}
    prompt = payload.get("prompt", "")
    stream = bool(payload.get("stream", True))
    if not stream:
        return {
            "id": "mock-chat-1",
            "object": "chat.completion",
            "choices": [{"message": {"content": f"Echo: {prompt}"}}],
        }

    def generate():
        chunks = [
            {"choices": [{"delta": {"content": "Hello from mock model. "}}]},
            {"choices": [{"delta": {"content": "Contact: admin@example.com "}}]},
            {"choices": [{"delta": {"content": "token=abcd1234efgh5678"}}]},
        ]
        for c in chunks:
            yield f"data: {json.dumps(c)}\n\n"
            time.sleep(0.2)
        yield "data: [DONE]\n\n"

    return Response(generate(), mimetype="text/event-stream")


@app.get("/healthz")
def health():
    return {"ok": True}


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=9100)
