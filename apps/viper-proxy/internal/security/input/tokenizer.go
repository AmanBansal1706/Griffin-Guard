package input

import (
	"strings"
	"sync"
)

type Tokenizer struct {
	cache sync.Map
}

type EncodedInput struct {
	InputIDs      []int64
	AttentionMask []int64
}

func NewTokenizer() *Tokenizer {
	return &Tokenizer{}
}

func (t *Tokenizer) Tokenize(text string, maxLen int) EncodedInput {
	if v, ok := t.cache.Load(text); ok {
		return v.(EncodedInput)
	}
	words := strings.Fields(strings.ToLower(text))
	inputIDs := make([]int64, maxLen)
	attention := make([]int64, maxLen)
	for i := 0; i < len(words) && i < maxLen; i++ {
		inputIDs[i] = hashToken(words[i]) % 30000
		attention[i] = 1
	}
	out := EncodedInput{InputIDs: inputIDs, AttentionMask: attention}
	t.cache.Store(text, out)
	return out
}

func hashToken(s string) int64 {
	var h int64 = 1469598103934665603
	for i := 0; i < len(s); i++ {
		h ^= int64(s[i])
		h *= 1099511628211
	}
	if h < 0 {
		return -h
	}
	return h
}
