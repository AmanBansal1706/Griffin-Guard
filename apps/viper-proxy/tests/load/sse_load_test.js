import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<250"]
  },
  scenarios: {
    sse: {
      executor: "constant-vus",
      vus: 500,
      duration: "2m"
    }
  }
};

export default function () {
  const res = http.post("http://localhost:8080/v1/chat/completions", JSON.stringify({ prompt: "hello" }), {
    headers: { "Content-Type": "application/json" }
  });
  check(res, { "status is < 500": (r) => r.status < 500 });
  sleep(0.5);
}
