package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type S3Writer struct {
	client *s3.Client
	bucket string
}

func NewS3Writer(client *s3.Client, bucket string) *S3Writer {
	return &S3Writer{client: client, bucket: bucket}
}

func (s *S3Writer) Write(ctx context.Context, e Event) error {
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	ts := e.Timestamp.UTC()
	key := fmt.Sprintf("year=%04d/month=%02d/day=%02d/hour=%02d/%d-%s.json",
		ts.Year(), ts.Month(), ts.Day(), ts.Hour(), ts.UnixNano(), e.RequestID)
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		_, err = s.client.PutObject(ctx, &s3.PutObjectInput{
			Bucket:      aws.String(s.bucket),
			Key:         aws.String(key),
			Body:        bytes.NewReader(b),
			ContentType: aws.String("application/json"),
		})
		if err == nil {
			return nil
		}
		lastErr = err
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(attempt+1) * 200 * time.Millisecond):
		}
	}
	return lastErr
}

func BatchWindow() time.Duration {
	return 750 * time.Millisecond
}
