from flask import Flask, jsonify, request

app = Flask(__name__)


@app.post("/infer")
def infer():
    data = request.get_json(force=True, silent=True) or {}
    input_ids = data.get("input_ids", [])
    score = 0.0
    for token in input_ids:
        if isinstance(token, int) and token != 0:
            if token % 17 == 0:
                score += 0.08
            elif token % 7 == 0:
                score += 0.02
    score = min(score, 0.99)
    return jsonify({"threat_score": score})


@app.get("/healthz")
def health():
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=9000)
