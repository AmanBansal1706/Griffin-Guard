package input

import (
	"context"
	"fmt"
)

type Classifier struct {
	tokenizer *Tokenizer
	engine    *ONNXEngine
	maxLen    int
}

func NewClassifier(tokenizer *Tokenizer, engine *ONNXEngine) *Classifier {
	return &Classifier{
		tokenizer: tokenizer,
		engine:    engine,
		maxLen:    256,
	}
}

func (c *Classifier) Score(ctx context.Context, prompt string) (float64, error) {
	encoded := c.tokenizer.Tokenize(prompt, c.maxLen)
	return c.engine.Infer(ctx, encoded)
}

func ExplainDecision(score float64, threshold float64) string {
	if score > threshold {
		return fmt.Sprintf("blocked due to threat score %.3f > %.3f", score, threshold)
	}
	return fmt.Sprintf("allowed with threat score %.3f <= %.3f", score, threshold)
}
