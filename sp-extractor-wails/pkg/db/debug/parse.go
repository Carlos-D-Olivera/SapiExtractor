package debug

import (
	"context"
	"database/sql"
	"regexp"
	"strings"
	"unicode"
)

// Arg is one argument of a captured EXEC call.
type Arg struct {
	Name       string `json:"name"` // "" for positional arguments
	Value      string `json:"value"`
	IsNull     bool   `json:"isNull"`
	UseDefault bool   `json:"useDefault"`
	Output     bool   `json:"output"`
}

// ExecCall is a parsed `EXEC [schema.]proc args…` statement.
type ExecCall struct {
	Schema string `json:"schema"` // "" when the call did not qualify the name
	Name   string `json:"name"`
	Args   []Arg  `json:"args"`
}

var (
	execKeyword  = regexp.MustCompile(`(?i)\bexec(?:ute)?\s+`)
	setVarRe     = regexp.MustCompile(`(?is)\bset\s+(@[A-Za-z0-9_]+)\s*=\s*(N?'(?:[^']|'')*'|[^\s]+)`)
	outputSuffix = regexp.MustCompile(`(?i)\s+out(?:put)?$`)
	returnVarRe  = regexp.MustCompile(`^@[A-Za-z0-9_#$@]+\s*$`)
)

// ParseExec parses the text of a captured procedure call, as shown by Extended
// Events / Profiler for RPC calls ("exec dbo.usp @a=1,@b=N'x'") or typed in a
// batch ("EXEC usp 1, 'x'"). A DECLARE/SET preamble that defines output
// variables is understood. ok is false when text is not a plain EXEC call.
func ParseExec(text string) (ExecCall, bool) {
	s := strings.TrimSpace(stripLeadingComments(text))

	vars := map[string]string{}
	if strings.HasPrefix(strings.ToLower(s), "declare") {
		i := firstExecOutsideQuotes(s)
		if i < 0 {
			return ExecCall{}, false
		}
		for _, m := range setVarRe.FindAllStringSubmatch(s[:i], -1) {
			vars[strings.ToLower(m[1])] = m[2]
		}
		s = s[i:]
	}

	loc := execKeyword.FindStringIndex(s)
	if loc == nil || loc[0] != 0 {
		return ExecCall{}, false
	}
	rest := strings.TrimSpace(s[loc[1]:])

	// EXEC @rc = proc …
	if strings.HasPrefix(rest, "@") {
		eq := strings.Index(rest, "=")
		if eq < 0 || !returnVarRe.MatchString(rest[:eq]) {
			return ExecCall{}, false // EXEC @procName: the target is a variable
		}
		rest = strings.TrimSpace(rest[eq+1:])
	}

	parts, rest, ok := readNameParts(rest)
	if !ok {
		return ExecCall{}, false
	}
	call := ExecCall{Name: parts[len(parts)-1]}
	if len(parts) >= 2 {
		call.Schema = parts[len(parts)-2]
	}

	rest = strings.TrimSpace(strings.TrimRight(strings.TrimSpace(rest), ";"))
	if rest == "" {
		return call, true
	}
	for _, piece := range splitTopLevel(rest) {
		if a, ok := parseArg(piece, vars); ok {
			call.Args = append(call.Args, a)
		}
	}
	return call, true
}

func stripLeadingComments(s string) string {
	for {
		s = strings.TrimLeftFunc(s, unicode.IsSpace)
		switch {
		case strings.HasPrefix(s, "--"):
			nl := strings.IndexByte(s, '\n')
			if nl < 0 {
				return ""
			}
			s = s[nl+1:]
		case strings.HasPrefix(s, "/*"):
			end := strings.Index(s[2:], "*/")
			if end < 0 {
				return ""
			}
			s = s[end+4:]
		default:
			return s
		}
	}
}

// firstExecOutsideQuotes finds the EXEC keyword that starts the call, skipping
// any that appear inside a string literal of the preamble.
func firstExecOutsideQuotes(s string) int {
	for _, loc := range execKeyword.FindAllStringIndex(s, -1) {
		if strings.Count(s[:loc[0]], "'")%2 == 0 {
			return loc[0]
		}
	}
	return -1
}

// readNameParts reads a possibly qualified, possibly bracketed name
// ([db].[schema].[proc]) and returns its parts plus the remaining text.
func readNameParts(s string) ([]string, string, bool) {
	var parts []string
	i := 0
	for {
		if i >= len(s) {
			return nil, "", false
		}
		var part string
		switch s[i] {
		case '[':
			j := i + 1
			var b strings.Builder
			for j < len(s) {
				if s[j] == ']' {
					if j+1 < len(s) && s[j+1] == ']' {
						b.WriteByte(']')
						j += 2
						continue
					}
					break
				}
				b.WriteByte(s[j])
				j++
			}
			if j >= len(s) {
				return nil, "", false
			}
			part, i = b.String(), j+1
		case '"':
			j := strings.IndexByte(s[i+1:], '"')
			if j < 0 {
				return nil, "", false
			}
			part, i = s[i+1:i+1+j], i+j+2
		default:
			j := i
			for j < len(s) && (s[j] == '_' || s[j] == '#' || s[j] == '$' || unicode.IsLetter(rune(s[j])) || unicode.IsDigit(rune(s[j]))) {
				j++
			}
			if j == i {
				return nil, "", false
			}
			part, i = s[i:j], j
		}
		parts = append(parts, part)
		if i < len(s) && s[i] == '.' {
			i++
			continue
		}
		break
	}
	// Optional procedure number suffix (";1").
	if i < len(s) && s[i] == ';' {
		j := i + 1
		for j < len(s) && unicode.IsDigit(rune(s[j])) {
			j++
		}
		i = j
	}
	return parts, s[i:], true
}

// splitTopLevel splits on commas that are outside quotes, parentheses and brackets.
func splitTopLevel(s string) []string {
	var out []string
	depth, start := 0, 0
	inStr := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case inStr:
			if c == '\'' {
				inStr = false // '' toggles twice
			}
		case c == '\'':
			inStr = true
		case c == '(' || c == '[':
			depth++
		case c == ')' || c == ']':
			depth--
		case c == ',' && depth == 0:
			out = append(out, strings.TrimSpace(s[start:i]))
			start = i + 1
		}
	}
	if last := strings.TrimSpace(s[start:]); last != "" {
		out = append(out, last)
	}
	return out
}

func parseArg(piece string, vars map[string]string) (Arg, bool) {
	piece = strings.TrimSpace(piece)
	if piece == "" {
		return Arg{}, false
	}
	var a Arg
	if outputSuffix.MatchString(piece) {
		a.Output = true
		piece = strings.TrimSpace(outputSuffix.ReplaceAllString(piece, ""))
	}
	raw := piece
	if strings.HasPrefix(piece, "@") {
		j := 1
		for j < len(piece) && (piece[j] == '_' || piece[j] == '#' || piece[j] == '$' || piece[j] == '@' || unicode.IsLetter(rune(piece[j])) || unicode.IsDigit(rune(piece[j]))) {
			j++
		}
		after := strings.TrimLeftFunc(piece[j:], unicode.IsSpace)
		if strings.HasPrefix(after, "=") {
			a.Name = piece[:j]
			raw = strings.TrimSpace(after[1:])
		}
	}
	a.Value, a.IsNull, a.UseDefault = parseValue(raw, vars)
	return a, true
}

// parseValue converts a T-SQL literal (or @variable defined in the preamble)
// into the plain text the user would type.
func parseValue(raw string, vars map[string]string) (value string, isNull, useDefault bool) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "@") {
		resolved, ok := vars[strings.ToLower(raw)]
		if !ok {
			return "", true, false // an output variable with no initial value
		}
		raw = strings.TrimSpace(resolved)
	}
	switch {
	case strings.EqualFold(raw, "null"):
		return "", true, false
	case strings.EqualFold(raw, "default"):
		return "", false, true
	}
	lower := strings.ToLower(raw)
	if (strings.HasPrefix(lower, "n'") || strings.HasPrefix(raw, "'")) && strings.HasSuffix(raw, "'") {
		body := raw[strings.IndexByte(raw, '\'')+1 : len(raw)-1]
		return strings.ReplaceAll(body, "''", "'"), false, false
	}
	return raw, false, false
}

// Prefill is what the debug panel needs to open for a call seen in a trace.
type Prefill struct {
	Schema     string   `json:"schema"`
	Name       string   `json:"name"`
	Args       []Arg    `json:"args"`
	Parsed     bool     `json:"parsed"`     // false when only the procedure name could be determined
	Candidates []string `json:"candidates"` // every schema that has a procedure with this name
}

// ResolveProcedure finds the schema(s) of a procedure by name in the connected
// database. hintSchema (may be empty) is preferred, then dbo.
func ResolveProcedure(ctx context.Context, conn *sql.DB, name, hintSchema string) (actualName string, schemas []string, err error) {
	rows, err := conn.QueryContext(ctx, `SELECT s.name, p.name
	 FROM sys.procedures p
	 INNER JOIN sys.schemas s ON s.schema_id = p.schema_id
	 WHERE p.name = @p1
	 ORDER BY CASE WHEN s.name = @p2 THEN 0 WHEN s.name = N'dbo' THEN 1 ELSE 2 END, s.name`, name, hintSchema)
	if err != nil {
		return "", nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var schema, pname string
		if err := rows.Scan(&schema, &pname); err != nil {
			return "", nil, err
		}
		schemas = append(schemas, schema)
		actualName = pname
	}
	return actualName, schemas, rows.Err()
}
