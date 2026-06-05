package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"vipergo/apps/viper-proxy/internal/config"
)

func TestDebugEventsHandlerRejectsMissingToken(t *testing.T) {
	cfg := config.Config{
		AllowDebugEvents: true,
		DebugEventsToken: "secret-token",
		DebugEventsMax:   10,
	}
	req := httptest.NewRequest(http.MethodGet, "/debug/events", nil)
	rec := httptest.NewRecorder()

	debugEventsHandler(cfg).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 when token missing, got %d", rec.Code)
	}
}

func TestDebugEventsHandlerHandlesCORSPreflight(t *testing.T) {
	cfg := config.Config{
		AllowDebugEvents:       true,
		DebugEventsToken:       "secret-token",
		DebugEventsAllowOrigin: "http://localhost:3000",
		DebugEventsMax:         10,
	}
	req := httptest.NewRequest(http.MethodOptions, "/debug/events", nil)
	rec := httptest.NewRecorder()

	debugEventsHandler(cfg).ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204 for preflight, got %d", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Fatalf("expected allow-origin header to be set, got %q", got)
	}
}

func TestNewLogSinkReturnsLocalWriter(t *testing.T) {
	cfg := config.Config{
		LogSink:      "local",
		LocalLogPath: "./var/logs/test.local.jsonl",
	}
	sink, err := newLogSink(cfg)
	if err != nil {
		t.Fatalf("expected local log sink, got error %v", err)
	}
	if sink == nil {
		t.Fatalf("expected non-nil sink")
	}
}
