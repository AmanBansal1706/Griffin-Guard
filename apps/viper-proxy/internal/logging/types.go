package logging

import "time"

type Event struct {
	Timestamp      time.Time         `json:"timestamp"`
	RequestID      string            `json:"request_id"`
	TenantID       string            `json:"tenant_id,omitempty"`
	UserID         string            `json:"user_id,omitempty"`
	Method         string            `json:"method"`
	Path           string            `json:"path"`
	Upstream       string            `json:"upstream"`
	InputScore     float64           `json:"input_score,omitempty"`
	InputBlocked   bool              `json:"input_blocked"`
	OutputLeak     bool              `json:"output_leak"`
	LeakTypes      []string          `json:"leak_types,omitempty"`
	Action         string            `json:"action"`
	StatusCode     int               `json:"status_code"`
	LatencyMs      int64             `json:"latency_ms"`
	PolicyVersion  string            `json:"policy_version"`
	ReasonCode     string            `json:"reason_code,omitempty"`
	RuleID         string            `json:"rule_id,omitempty"`
	DecisionSource string            `json:"decision_source,omitempty"`
	FailureMode    string            `json:"failure_mode,omitempty"`
	AdditionalData map[string]string `json:"additional_data,omitempty"`
}
