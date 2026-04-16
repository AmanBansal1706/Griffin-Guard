package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Environment           string
	ListenAddr            string
	UpstreamURL           string
	ReadTimeout           time.Duration
	WriteTimeout          time.Duration
	IdleTimeout           time.Duration
	RequestMaxBytes       int64
	ThreatScoreThreshold  float64
	LogQueueSize          int
	LogWorkers            int
	LogBucket             string
	LogRegion             string
	WALPath               string
	ModelPath             string
	ONNXEndpoint          string
	AllowDebugEvents      bool
	DebugEventsToken      string
	ScannerFailOpen       bool
	LoggerFailOpen        bool
	StreamTerminateOnLeak bool
	DebugEventsMax        int
}

func Load() Config {
	return Config{
		Environment:           get("VIPER_ENV", "dev"),
		ListenAddr:            get("VIPER_LISTEN_ADDR", ":8080"),
		UpstreamURL:           get("VIPER_UPSTREAM_URL", "https://api.openai.com"),
		ReadTimeout:           getDuration("VIPER_READ_TIMEOUT", 15*time.Second),
		WriteTimeout:          getDuration("VIPER_WRITE_TIMEOUT", 65*time.Second),
		IdleTimeout:           getDuration("VIPER_IDLE_TIMEOUT", 120*time.Second),
		RequestMaxBytes:       getInt64("VIPER_REQUEST_MAX_BYTES", 1<<20),
		ThreatScoreThreshold:  getFloat("VIPER_THREAT_SCORE_THRESHOLD", 0.85),
		LogQueueSize:          getInt("VIPER_LOG_QUEUE_SIZE", 1000),
		LogWorkers:            getInt("VIPER_LOG_WORKERS", 20),
		LogBucket:             get("VIPER_LOG_BUCKET", "vipergo-raw-logs"),
		LogRegion:             get("VIPER_LOG_REGION", "us-east-1"),
		WALPath:               get("VIPER_WAL_PATH", "./var/logs/viper.wal"),
		ModelPath:             get("VIPER_MODEL_PATH", "./models/distilbert.onnx"),
		ONNXEndpoint:          get("VIPER_ONNX_ENDPOINT", ""),
		AllowDebugEvents:      getBool("VIPER_ALLOW_DEBUG_EVENTS", false),
		DebugEventsToken:      get("VIPER_DEBUG_EVENTS_TOKEN", ""),
		ScannerFailOpen:       getBool("VIPER_SCANNER_FAIL_OPEN", false),
		LoggerFailOpen:        getBool("VIPER_LOGGER_FAIL_OPEN", false),
		StreamTerminateOnLeak: getBool("VIPER_STREAM_TERMINATE_ON_LEAK", false),
		DebugEventsMax:        getInt("VIPER_DEBUG_EVENTS_MAX", 500),
	}
}

func (c Config) IsProduction() bool {
	return c.Environment == "prod" || c.Environment == "production"
}

func (c Config) Validate() error {
	if c.UpstreamURL == "" {
		return fmt.Errorf("VIPER_UPSTREAM_URL is required")
	}
	if c.LogBucket == "" {
		return fmt.Errorf("VIPER_LOG_BUCKET is required")
	}
	if c.LogRegion == "" {
		return fmt.Errorf("VIPER_LOG_REGION is required")
	}
	if c.RequestMaxBytes <= 0 {
		return fmt.Errorf("VIPER_REQUEST_MAX_BYTES must be > 0")
	}
	if c.LogWorkers <= 0 || c.LogQueueSize <= 0 {
		return fmt.Errorf("VIPER_LOG_WORKERS and VIPER_LOG_QUEUE_SIZE must be > 0")
	}
	if c.ThreatScoreThreshold < 0 || c.ThreatScoreThreshold > 1 {
		return fmt.Errorf("VIPER_THREAT_SCORE_THRESHOLD must be between 0 and 1")
	}
	if c.DebugEventsMax <= 0 {
		return fmt.Errorf("VIPER_DEBUG_EVENTS_MAX must be > 0")
	}
	if c.AllowDebugEvents && c.DebugEventsToken == "" {
		return fmt.Errorf("VIPER_DEBUG_EVENTS_TOKEN is required when VIPER_ALLOW_DEBUG_EVENTS=true")
	}
	if c.IsProduction() && c.AllowDebugEvents {
		return fmt.Errorf("VIPER_ALLOW_DEBUG_EVENTS must be false in production")
	}
	return nil
}

func get(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func getInt(k string, def int) int {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func getInt64(k string, def int64) int64 {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return def
	}
	return n
}

func getFloat(k string, def float64) float64 {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	n, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return def
	}
	return n
}

func getBool(k string, def bool) bool {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

func getDuration(k string, def time.Duration) time.Duration {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return def
	}
	return d
}
