package debug

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

// MaxSteps bounds the statements kept for display; longer runs are cut.
const MaxSteps = 5000

// Step is one executed statement, with the statements it triggered (EXEC of
// another procedure, trigger firing, dynamic SQL) as children.
type Step struct {
	Seq         int     `json:"seq"`
	Kind        string  `json:"kind"`      // "stmt" | "error"
	Object      string  `json:"object"`    // procedure/trigger name, or "SQL dinámico"
	SourceKey   string  `json:"sourceKey"` // key into Result.Sources ("" when there is no source)
	Level       int     `json:"level"`
	Line        int     `json:"line"` // 1-based line in the source, 0 = unknown
	EndLine     int     `json:"endLine"`
	Text        string  `json:"text"`
	DurationUs  int64   `json:"durationUs"`
	CPUUs       int64   `json:"cpuUs"`
	Reads       int64   `json:"reads"`
	Writes      int64   `json:"writes"`
	Rows        int64   `json:"rows"`
	Count       int     `json:"count"`  // identical consecutive executions merged into this step
	Branch      string  `json:"branch"` // deduced outcome of an IF / WHILE condition
	Note        string  `json:"note"`
	ErrorNumber int64   `json:"errorNumber"`
	Severity    int64   `json:"severity"`
	Children    []*Step `json:"children"`

	start, end int // rune span of the statement in its source, -1 when unknown
}

// Source is the text of a procedure/trigger that appears in the execution.
type Source struct {
	Key  string `json:"key"`
	Name string `json:"name"`
	Text string `json:"text"`
}

// srcInfo pairs a Source with the index used to map offsets to lines.
type srcInfo struct {
	Source
	idx *srcIndex
}

// srcIndex maps UTF-16 byte offsets (what SQL Server reports) to runes and lines.
type srcIndex struct {
	runes []rune
	u16   []int // rune index of every UTF-16 code unit
	nl    []int // rune index of every '\n'
}

func newSrcIndex(text string) *srcIndex {
	ix := &srcIndex{runes: []rune(text)}
	for i, r := range ix.runes {
		ix.u16 = append(ix.u16, i)
		if r >= 0x10000 {
			ix.u16 = append(ix.u16, i)
		}
		if r == '\n' {
			ix.nl = append(ix.nl, i)
		}
	}
	return ix
}

// span converts a [offset, offsetEnd) byte range into a rune range.
func (s *srcIndex) span(off, offEnd int64) (int, int, bool) {
	unit := int(off / 2)
	if off < 0 || unit >= len(s.u16) {
		return 0, 0, false
	}
	start := s.u16[unit]
	end := len(s.runes)
	if offEnd >= 0 {
		if eu := int(offEnd / 2); eu < len(s.u16) {
			end = s.u16[eu]
		}
	}
	if end < start {
		return 0, 0, false
	}
	return start, end, true
}

// line is the 1-based line of rune index i.
func (s *srcIndex) line(i int) int { return 1 + sort.SearchInts(s.nl, i) }

func norm(s string) string {
	return strings.TrimRight(strings.ToLower(strings.Join(strings.Fields(s), " ")), "; ")
}

// buildSteps turns raw events into a flat, ordered list of steps, locating
// each one in its source when available.
func buildSteps(events []rawEvent, srcs map[string]*srcInfo) []*Step {
	steps := make([]*Step, 0, len(events))
	lastLevel := 1
	for i, e := range events {
		st := &Step{Seq: i + 1, Kind: e.Kind, Text: strings.TrimSpace(e.Text), Count: 1, start: -1, end: -1}
		if e.Kind == "error" {
			st.Level = lastLevel
			st.ErrorNumber, st.Severity = e.ErrNo, e.Severity
			steps = append(steps, st)
			continue
		}
		st.Level, lastLevel = e.Level, e.Level
		st.DurationUs, st.CPUUs, st.Reads, st.Writes, st.Rows = e.Duration, e.CPU, e.Reads, e.Writes, e.Rows
		st.Line = e.Line
		st.Object = e.ObjectName
		if e.ObjectID > 0 {
			key := strconv.FormatInt(e.ObjectID, 10)
			if src := srcs[key]; src != nil {
				st.SourceKey = key
				if st.Object == "" {
					st.Object = src.Name
				}
				if s, en, ok := src.idx.span(e.Offset, e.OffsetEnd); ok && matches(string(src.idx.runes[s:en]), st.Text) {
					st.start, st.end = s, en
					st.Line = src.idx.line(s)
					st.EndLine = src.idx.line(maxInt(s, en-1))
				}
			}
		}
		if st.Object == "" {
			st.Object = "SQL dinámico"
		}
		if st.EndLine == 0 {
			st.EndLine = st.Line
		}
		steps = append(steps, st)
	}
	return steps
}

// matches reports whether the source slice and the event's statement text are
// the same statement (the event text may be trimmed or end at a semicolon).
func matches(sourceSlice, eventText string) bool {
	a, b := norm(sourceSlice), norm(eventText)
	if b == "" {
		return false
	}
	return a == b || strings.Contains(a, b) || strings.Contains(b, a)
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// ---------------------------------------------------------------- branches

func isIdentRune(r rune) bool { return r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r) }

func hasWordPrefix(u, w string) bool {
	return strings.HasPrefix(u, w) && (len(u) == len(w) || !isIdentRune(rune(u[len(w)])))
}

// conditionKind returns "IF" or "WHILE" when the statement is such a condition.
func conditionKind(text string) string {
	u := strings.ToUpper(strings.TrimSpace(text))
	if hasWordPrefix(u, "ELSE") {
		u = strings.TrimSpace(u[len("ELSE"):])
	}
	switch {
	case hasWordPrefix(u, "IF"):
		return "IF"
	case hasWordPrefix(u, "WHILE"):
		return "WHILE"
	}
	return ""
}

// skipTrivia advances past whitespace and comments.
func skipTrivia(rs []rune, i int) int {
	for i < len(rs) {
		switch {
		case unicode.IsSpace(rs[i]):
			i++
		case rs[i] == '-' && i+1 < len(rs) && rs[i+1] == '-':
			for i < len(rs) && rs[i] != '\n' {
				i++
			}
		case rs[i] == '/' && i+1 < len(rs) && rs[i+1] == '*':
			i += 2
			for i+1 < len(rs) && !(rs[i] == '*' && rs[i+1] == '/') {
				i++
			}
			i += 2
		default:
			return i
		}
	}
	return len(rs)
}

// wordAt reports whether keyword w (case-insensitive) starts at i as a whole word.
func wordAt(rs []rune, i int, w string) bool {
	if i < 0 || i+len(w) > len(rs) {
		return false
	}
	if !strings.EqualFold(string(rs[i:i+len(w)]), w) {
		return false
	}
	return i+len(w) == len(rs) || !isIdentRune(rs[i+len(w)])
}

// prevWord returns the upper-cased word before position i, ignoring a BEGIN
// that sits between it and i.
func prevWord(rs []rune, i int) string {
	for pass := 0; pass < 2; pass++ {
		j := i
		for j > 0 && unicode.IsSpace(rs[j-1]) {
			j--
		}
		k := j
		for k > 0 && isIdentRune(rs[k-1]) {
			k--
		}
		w := strings.ToUpper(string(rs[k:j]))
		if w == "BEGIN" {
			i = k
			continue
		}
		return w
	}
	return ""
}

// bodyStarts lists the positions where the first statement of the block that
// follows a condition ending at condEnd may begin (with or without BEGIN).
func bodyStarts(rs []rune, condEnd int) []int {
	t := skipTrivia(rs, condEnd)
	starts := []int{t}
	if wordAt(rs, t, "BEGIN") {
		starts = append(starts, skipTrivia(rs, t+len("BEGIN")))
	}
	return starts
}

// nextInBlock is the next executed statement of the same procedure at the same
// nesting level, or nil when the block returned first.
func nextInBlock(steps []*Step, i int) *Step {
	cur := steps[i]
	for j := i + 1; j < len(steps); j++ {
		s := steps[j]
		if s.Kind != "stmt" {
			continue
		}
		if s.Level < cur.Level {
			return nil
		}
		if s.Level == cur.Level && s.SourceKey == cur.SourceKey {
			return s
		}
	}
	return nil
}

// annotateBranches deduces, for every IF / WHILE condition that ran, whether
// execution entered its block. The server does not report the truth value of a
// condition; it is inferred from which statement ran next.
func annotateBranches(steps []*Step, srcs map[string]*srcInfo) {
	evals := map[string]int{} // WHILE condition -> times evaluated
	for _, st := range steps {
		if st.Kind == "stmt" && st.SourceKey != "" && st.start >= 0 && conditionKind(st.Text) == "WHILE" {
			evals[st.SourceKey+":"+strconv.Itoa(st.start)]++
		}
	}
	seen := map[string]int{}

	for i, st := range steps {
		if st.Kind != "stmt" || st.SourceKey == "" || st.start < 0 {
			continue
		}
		kind := conditionKind(st.Text)
		if kind == "" {
			continue
		}
		key := st.SourceKey + ":" + strconv.Itoa(st.start)
		if kind == "WHILE" {
			seen[key]++
			st.Note = fmt.Sprintf("evaluación %d de %d", seen[key], evals[key])
		}

		next := nextInBlock(steps, i)
		if next == nil {
			continue
		}
		if next.start >= st.start && next.start < st.end {
			st.Note = strings.TrimSpace(st.Note + " rango ambiguo: no se pudo deducir la rama")
			continue
		}
		rs := srcs[st.SourceKey].idx.runes
		taken := false
		for _, p := range bodyStarts(rs, st.end) {
			if next.start == p {
				taken = true
			}
		}
		switch {
		case kind == "WHILE" && taken:
			st.Branch = "ENTRA"
		case kind == "WHILE":
			st.Branch = "SALE"
		case taken:
			st.Branch = "THEN"
		case prevWord(rs, next.start) == "ELSE":
			st.Branch = "ELSE"
		default:
			st.Branch = "SALTADO"
		}
	}
}

// ---------------------------------------------------------------------- tree

// nest groups a flat, completion-ordered list into a tree. A statement that
// calls another module (EXEC, trigger firing, dynamic SQL) completes after the
// statements it ran, which sit at a deeper nest level just before it.
func nest(flat []*Step) []*Step {
	var pending []*Step
	for _, st := range flat {
		k := len(pending)
		for k > 0 && pending[k-1].Level > st.Level {
			k--
		}
		if k < len(pending) {
			st.Children = append([]*Step(nil), pending[k:]...)
		}
		pending = append(pending[:k], st)
	}
	return pending
}

// mergeRepeats folds consecutive identical leaf statements (tight loops) into
// one step with a Count.
func mergeRepeats(nodes []*Step) []*Step {
	out := make([]*Step, 0, len(nodes))
	for _, n := range nodes {
		n.Children = mergeRepeats(n.Children)
		if len(out) > 0 {
			p := out[len(out)-1]
			if canMerge(p, n) {
				p.Count += n.Count
				p.DurationUs += n.DurationUs
				p.CPUUs += n.CPUUs
				p.Reads += n.Reads
				p.Writes += n.Writes
				p.Rows += n.Rows
				continue
			}
		}
		out = append(out, n)
	}
	return out
}

func canMerge(a, b *Step) bool {
	return a.Kind == "stmt" && b.Kind == "stmt" &&
		len(a.Children) == 0 && len(b.Children) == 0 &&
		a.Level == b.Level && a.SourceKey == b.SourceKey && a.Object == b.Object &&
		a.Line == b.Line && a.Text == b.Text && a.Branch == b.Branch && a.Note == ""
}

// Build assembles the execution tree from raw events.
func build(events []rawEvent, srcs map[string]*srcInfo) (steps []*Step, truncated bool) {
	if len(events) > MaxSteps {
		events, truncated = events[:MaxSteps], true
	}
	flat := buildSteps(events, srcs)
	annotateBranches(flat, srcs)
	return mergeRepeats(nest(flat)), truncated
}
