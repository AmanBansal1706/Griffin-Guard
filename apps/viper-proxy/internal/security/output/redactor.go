package output

import "strings"

func Redact(text string, findings []Finding) string {
	out := text
	for _, f := range findings {
		if f.Confidence < 0.8 {
			continue
		}
		mask := "[REDACTED_" + strings.ToUpper(f.Type) + "]"
		out = strings.ReplaceAll(out, f.Value, mask)
	}
	return out
}
