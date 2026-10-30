// Package compare decides whether two databases hold the same programmable
// objects (procedures, functions, views, triggers) and produces line diffs of
// the ones that differ. It is pure (no database access) so it can be unit-tested.
package compare

import (
	"regexp"
	"sort"
	"strings"

	"sp-extractor-wails/pkg/db"
)

// Options controls which differences are ignored when comparing definitions.
type Options struct {
	IgnoreWhitespace bool `json:"ignoreWhitespace"` // CRLF/LF, indentation, trailing and repeated spaces, blank lines
	IgnoreCase       bool `json:"ignoreCase"`
	IgnoreComments   bool `json:"ignoreComments"`
}

// Status is the comparison outcome of one object.
type Status string

const (
	Same       Status = "same"
	Different  Status = "different"
	OnlySource Status = "onlySource"
	OnlyTarget Status = "onlyTarget"
)

// Entry is one object of one side, with its definition when it exists on both sides.
type Entry struct {
	Type       db.DbObjectType
	Schema     string
	Name       string
	ParentName string
	Definition string
	// Table holds the structure of a table (Type == db.Table) instead of a definition text.
	Table *db.TableMeta
}

// Item is the comparison result of one object.
type Item struct {
	Type       db.DbObjectType `json:"type"`
	Schema     string          `json:"schema"`
	Name       string          `json:"name"`
	ParentName string          `json:"parentName"`
	Status     Status          `json:"status"`
}

// Summary counts the items per status.
type Summary struct {
	Same       int `json:"same"`
	Different  int `json:"different"`
	OnlySource int `json:"onlySource"`
	OnlyTarget int `json:"onlyTarget"`
}

// Result is the full comparison of two object inventories.
type Result struct {
	Items   []Item  `json:"items"`
	Summary Summary `json:"summary"`
}

// Key identifies an object across databases. Names are case-insensitive (the
// default for SQL Server and MySQL). MySQL "schemas" are databases, so they are
// left out: the two sides always live in different ones.
func Key(t db.DatabaseType, o db.DbObject) string {
	schema := o.Schema
	if t == db.MySQL {
		schema = ""
	}
	return strings.ToLower(string(o.Type) + "|" + schema + "|" + o.ParentName + "|" + o.Name)
}

func entryKey(t db.DatabaseType, e Entry) string {
	return Key(t, db.DbObject{Type: e.Type, Schema: e.Schema, ParentName: e.ParentName, Name: e.Name})
}

var typeOrder = map[db.DbObjectType]int{
	db.Table:           0,
	db.StoredProcedure: 1,
	db.Function:        2,
	db.View:            3,
	db.Trigger:         4,
}

// Compare matches both inventories by Key and classifies every object. Entries
// present on both sides must carry their Definition.
func Compare(t db.DatabaseType, source, target []Entry, opts Options) Result {
	tgt := make(map[string]Entry, len(target))
	for _, e := range target {
		tgt[entryKey(t, e)] = e
	}
	seen := make(map[string]bool, len(source))
	var res Result
	add := func(e Entry, st Status) {
		res.Items = append(res.Items, Item{Type: e.Type, Schema: e.Schema, Name: e.Name, ParentName: e.ParentName, Status: st})
		switch st {
		case Same:
			res.Summary.Same++
		case Different:
			res.Summary.Different++
		case OnlySource:
			res.Summary.OnlySource++
		case OnlyTarget:
			res.Summary.OnlyTarget++
		}
	}
	for _, s := range source {
		k := entryKey(t, s)
		seen[k] = true
		o, ok := tgt[k]
		switch {
		case !ok:
			add(s, OnlySource)
		case sameObject(s, o, opts):
			add(s, Same)
		default:
			add(s, Different)
		}
	}
	for _, e := range target {
		if !seen[entryKey(t, e)] {
			add(e, OnlyTarget)
		}
	}
	res.Items = orderItems(res.Items)
	return res
}

func orderItems(items []Item) []Item {
	if items == nil {
		items = []Item{}
	}
	sort.SliceStable(items, func(i, j int) bool {
		a, b := items[i], items[j]
		if typeOrder[a.Type] != typeOrder[b.Type] {
			return typeOrder[a.Type] < typeOrder[b.Type]
		}
		if !strings.EqualFold(a.Schema, b.Schema) {
			return strings.ToLower(a.Schema) < strings.ToLower(b.Schema)
		}
		if !strings.EqualFold(a.Name, b.Name) {
			return strings.ToLower(a.Name) < strings.ToLower(b.Name)
		}
		return strings.ToLower(a.ParentName) < strings.ToLower(b.ParentName)
	})
	return items
}

func sameObject(a, b Entry, opts Options) bool {
	if a.Type == db.Table {
		if a.Table == nil || b.Table == nil {
			return a.Table == b.Table
		}
		return len(TableChanges(*a.Table, *b.Table)) == 0
	}
	return equalText(a.Definition, b.Definition, opts)
}

func equalText(a, b string, opts Options) bool {
	la, lb := prepare(a, opts), prepare(b, opts)
	if len(la) != len(lb) {
		return false
	}
	for i := range la {
		if la[i].key != lb[i].key {
			return false
		}
	}
	return true
}

// line is a source line (shown to the user) and the normalized key used to compare it.
type line struct {
	text string
	key  string
	num  int // 1-based line number in the original text
}

var (
	spaces = regexp.MustCompile(`\s+`)
	// CREATE / ALTER / CREATE OR ALTER differ between environments but mean the same here.
	header = regexp.MustCompile(`(?i)^(?:create\s+or\s+alter|create\s+or\s+replace|create|alter)\s+(proc(?:edure)?|function|view|trigger)\b`)
)

func prepare(text string, opts Options) []line {
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
	raw := strings.Split(text, "\n")
	out := make([]line, 0, len(raw))
	inBlock := false
	headerDone := false
	for i, l := range raw {
		l = strings.TrimRight(l, " \t")
		key := l
		hadContent := strings.TrimSpace(l) != ""
		if opts.IgnoreComments {
			key, inBlock = stripComments(key, inBlock)
			if hadContent && strings.TrimSpace(key) == "" {
				continue // comment-only line
			}
		}
		if opts.IgnoreWhitespace {
			key = strings.TrimSpace(spaces.ReplaceAllString(key, " "))
			if key == "" {
				continue
			}
		}
		if opts.IgnoreCase {
			key = strings.ToLower(key)
		}
		if !headerDone && strings.TrimSpace(key) != "" {
			headerDone = true
			if opts.IgnoreWhitespace {
				key = header.ReplaceAllStringFunc(key, func(m string) string {
					sub := header.FindStringSubmatch(m)
					kind := strings.ToLower(sub[1])
					if kind == "proc" {
						kind = "procedure"
					}
					if opts.IgnoreCase {
						return "create " + kind
					}
					return "CREATE " + strings.ToUpper(kind)
				})
			}
		}
		out = append(out, line{text: l, key: key, num: i + 1})
	}
	return out
}

// stripComments removes `-- ...` and `/* ... */` fragments from one line,
// leaving string literals untouched. inBlock carries an open block comment over
// from the previous line.
func stripComments(l string, inBlock bool) (string, bool) {
	var b strings.Builder
	inStr := false
	for i := 0; i < len(l); i++ {
		c := l[i]
		switch {
		case inBlock:
			if c == '*' && i+1 < len(l) && l[i+1] == '/' {
				inBlock = false
				i++
			}
		case inStr:
			b.WriteByte(c)
			if c == '\'' {
				inStr = false
			}
		case c == '\'':
			inStr = true
			b.WriteByte(c)
		case c == '-' && i+1 < len(l) && l[i+1] == '-':
			return b.String(), inBlock
		case c == '/' && i+1 < len(l) && l[i+1] == '*':
			inBlock = true
			i++
		default:
			b.WriteByte(c)
		}
	}
	return b.String(), inBlock
}
