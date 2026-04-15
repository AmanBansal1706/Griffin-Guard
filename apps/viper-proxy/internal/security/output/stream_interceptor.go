package output

import (
	"bytes"
	"io"
	"net/http"
	"sort"
)

type StreamResult struct {
	LeakTypes   []string
	Terminated  bool
	AnyLeakSeen bool
}

func InterceptAndWrite(w http.ResponseWriter, upstream io.Reader, terminateOnLeak bool) (StreamResult, error) {
	flusher, _ := w.(http.Flusher)
	buf := make([]byte, 1024)
	rolling := bytes.NewBuffer(make([]byte, 0, 4096))
	seenTypes := map[string]struct{}{}
	res := StreamResult{}

	for {
		n, err := upstream.Read(buf)
		if n > 0 {
			chunk := string(buf[:n])
			rolling.WriteString(chunk)
			if rolling.Len() > 4096 {
				keep := rolling.Bytes()[rolling.Len()-4096:]
				rolling.Reset()
				rolling.Write(keep)
			}
			findings := Detect(rolling.String())
			if len(findings) > 0 {
				res.AnyLeakSeen = true
				for _, f := range findings {
					seenTypes[f.Type] = struct{}{}
				}
				if terminateOnLeak {
					res.Terminated = true
					break
				}
				chunk = Redact(chunk, findings)
			}
			if _, werr := w.Write([]byte(chunk)); werr != nil {
				return res, werr
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return res, err
		}
	}
	for t := range seenTypes {
		res.LeakTypes = append(res.LeakTypes, t)
	}
	sort.Strings(res.LeakTypes)
	return res, nil
}
