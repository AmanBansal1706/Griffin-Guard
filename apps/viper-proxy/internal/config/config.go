package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
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
	ScannerFailOpen       bool
	LoggerFailOpen        bool
	StreamTerminateOnLeak bool
}

func Load() Config {
	return Config{
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
		ScannerFailOpen:       getBool("VIPER_SCANNER_FAIL_OPEN", true),
		LoggerFailOpen:        getBool("VIPER_LOGGER_FAIL_OPEN", true),
		StreamTerminateOnLeak: getBool("VIPER_STREAM_TERMINATE_ON_LEAK", false),
	}
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
