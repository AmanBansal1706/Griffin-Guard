package integration

import (
	"bytes"
	"net/http/httptest"
	"strings"
	"testing"

	"vipergo/apps/viper-proxy/internal/security/output"
)

func TestOutputRedactionMode(t *testing.T) {
	upstream := strings.NewReader("user email is alice@example.com and api_key=abcd1234efgh5678")
	w := httptest.NewRecorder()
	res, err := output.InterceptAndWrite(w, upstream, false)
	if err != nil {
		t.Fatalf("unexpected interception error: %v", err)
	}
	body := w.Body.String()
	if strings.Contains(body, "alice@example.com") {
		t.Fatalf("email should be redacted in response body")
	}
	if !res.AnyLeakSeen {
		t.Fatalf("expected leak detection")
	}
}

func TestOutputTerminateMode(t *testing.T) {
	upstream := bytes.NewBufferString("token=verysecretvalue12345")
	w := httptest.NewRecorder()
	res, err := output.InterceptAndWrite(w, upstream, true)
	if err != nil {
		t.Fatalf("unexpected interception error: %v", err)
	}
	if !res.Terminated {
		t.Fatalf("expected stream termination when leak detected")
	}
}
