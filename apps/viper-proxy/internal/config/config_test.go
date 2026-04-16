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
