package input

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"
)

type ONNXEngine struct {
	ready    bool
	model    string
	endpoint string
	client   *http.Client
}

type inferRequest struct {
	InputIDs      []int64 `json:"input_ids"`
	AttentionMask []int64 `json:"attention_mask"`
}

type inferResponse struct {
	ThreatScore float64 `json:"threat_score"`
}

func NewONNXEngine(modelPath string, endpoint string) (*ONNXEngine, error) {
	if strings.TrimSpace(modelPath) == "" {
		return nil, errors.New("model path is required")
	}
	if _, err := os.Stat(modelPath); err != nil {
		return nil, err
	}
	e := &ONNXEngine{
		ready:    strings.TrimSpace(endpoint) != "",
		model:    modelPath,
		endpoint: strings.TrimSpace(endpoint),
		client: &http.Client{
			Timeout: 1200 * time.Millisecond,
		},
	}
	return e, nil
}

func (e *ONNXEngine) IsReady() bool {
	return e.ready
}

func (e *ONNXEngine) Infer(ctx context.Context, input EncodedInput) (float64, error) {
	if !e.ready {
		return 0, errors.New("onnx inference endpoint is not configured")
	}
	reqBody, err := json.Marshal(inferRequest{
		InputIDs:      input.InputIDs,
		AttentionMask: input.AttentionMask,
	})
	if err != nil {
		return 0, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.endpoint, bytes.NewReader(reqBody))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, errors.New("onnx inference service returned non-200")
	}
	var out inferResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return 0, err
	}
	if out.ThreatScore < 0 || out.ThreatScore > 1 {
		return 0, errors.New("invalid threat_score from inference service")
	}
	return out.ThreatScore, nil
}
