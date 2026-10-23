package main

import (
	"regexp"
	"strconv"
	"strings"
)

// goLine matches an SSMS/sqlcmd batch separator: GO, optionally followed by a
// repeat count and/or a trailing -- comment, alone on its line.
var goLine = regexp.MustCompile(`(?i)^\s*GO(?:\s+(\d+))?\s*(?:--.*)?$`)

// splitBatches splits a T-SQL script on GO separators the way SSMS does. GO is a
// client directive, not T-SQL, so the server rejects it (and, worse, statements
// such as CREATE PROCEDURE must be the first statement of their batch).
//
// A "GO" line inside a block comment or a string literal is not a separator.
// "GO 3" repeats the preceding batch three times. Empty batches are dropped.
func splitBatches(script string) []string {
	var batches []string
	var cur []string
	inBlock, inStr := false, false

	flush := func(repeat int) {
		text := strings.TrimSpace(strings.Join(cur, "\n"))
		cur = nil
		if text == "" {
			return
		}
		for i := 0; i < repeat; i++ {
			batches = append(batches, text)
		}
	}

	script = strings.ReplaceAll(script, "\r\n", "\n")
	for _, line := range strings.Split(script, "\n") {
		if !inBlock && !inStr {
			if m := goLine.FindStringSubmatch(line); m != nil {
				repeat := 1
				if m[1] != "" {
					if n, err := strconv.Atoi(m[1]); err == nil && n > 0 {
						repeat = n
					}
				}
				flush(repeat)
				continue
			}
		}
		cur = append(cur, line)
		inBlock, inStr = scanLineState(line, inBlock, inStr)
	}
	flush(1)
	return batches
}

// scanLineState advances the block-comment / string-literal state over one line.
func scanLineState(line string, inBlock, inStr bool) (bool, bool) {
	for i := 0; i < len(line); i++ {
		c := line[i]
		switch {
		case inBlock:
			if c == '*' && i+1 < len(line) && line[i+1] == '/' {
				inBlock = false
				i++
			}
		case inStr:
			if c == '\'' { // '' inside a literal toggles twice, which is correct
				inStr = false
			}
		default:
			switch {
			case c == '-' && i+1 < len(line) && line[i+1] == '-':
				return inBlock, inStr // rest of the line is a comment
			case c == '/' && i+1 < len(line) && line[i+1] == '*':
				inBlock = true
				i++
			case c == '\'':
				inStr = true
			}
		}
	}
	return inBlock, inStr
}
