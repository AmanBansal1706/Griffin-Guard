package config

import "testing"

func TestValidateRejectsBadThreshold(t *testing.T) {
	cfg := Load()
	cfg.ThreatScoreThreshold = 2
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for threshold > 1")
	}
}

func TestValidateRejectsDebugInProd(t *testing.T) {
	cfg := Load()
	cfg.Environment = "production"
	cfg.AllowDebugEvents = true
	cfg.DebugEventsToken = "token"
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for debug events in production")
	}
}

func TestValidateAllowsLocalLogSinkWithoutS3(t *testing.T) {
	cfg := Load()
	cfg.LogSink = "local"
	cfg.LogBucket = ""
	cfg.LogRegion = ""
	cfg.LocalLogPath = "./var/logs/events.local.jsonl"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected local log sink validation to pass, got %v", err)
	}
}

func TestValidateRejectsUnknownLogSink(t *testing.T) {
	cfg := Load()
	cfg.LogSink = "stdout"
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for unknown log sink")
	}
}
