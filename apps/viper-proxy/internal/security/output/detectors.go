package output

import "regexp"

type Finding struct {
	Type       string
	Value      string
	Confidence float64
	Severity   string
}

var (
	emailRe = regexp.MustCompile(`[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}`)
	phoneRe = regexp.MustCompile(`\+?[0-9][0-9\-\(\) ]{8,}[0-9]`)
	keyRe   = regexp.MustCompile(`(?i)(api[_\-]?key|token|secret)[=: ]+[a-z0-9\-_]{12,}`)
	ccRe    = regexp.MustCompile(`\b(?:\d[ -]*?){13,16}\b`)
)

func Detect(text string) []Finding {
	findings := make([]Finding, 0, 8)
	for _, m := range emailRe.FindAllString(text, -1) {
		findings = append(findings, Finding{Type: "email", Value: m, Confidence: 0.92, Severity: "red_flag"})
	}
	for _, m := range phoneRe.FindAllString(text, -1) {
		findings = append(findings, Finding{Type: "phone", Value: m, Confidence: 0.82, Severity: "red_flag"})
	}
	for _, m := range keyRe.FindAllString(text, -1) {
		findings = append(findings, Finding{Type: "api_key", Value: m, Confidence: 0.97, Severity: "critical"})
	}
	for _, m := range ccRe.FindAllString(text, -1) {
		findings = append(findings, Finding{Type: "credit_card", Value: m, Confidence: 0.95, Severity: "critical"})
	}
	return dedupeFindings(findings)
}

func dedupeFindings(in []Finding) []Finding {
	seen := make(map[string]struct{}, len(in))
	out := make([]Finding, 0, len(in))
	for _, f := range in {
		key := f.Type + "::" + f.Value
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, f)
	}
	return out
}
