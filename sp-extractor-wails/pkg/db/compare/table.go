package compare

import (
	"fmt"
	"strings"

	"sp-extractor-wails/pkg/db"
)

// Areas of a table that can differ.
const (
	AreaColumn     = "column"
	AreaPrimaryKey = "primaryKey"
	AreaIndex      = "index"
	AreaForeignKey = "foreignKey"
)

// TableChange is one structural difference between the source and target version of a table.
// Source/Target hold a readable description of the element on that side ("" when it does not exist there).
type TableChange struct {
	Area   string `json:"area"`
	Name   string `json:"name"`
	Status Status `json:"status"` // Different, OnlySource or OnlyTarget
	Source string `json:"source"`
	Target string `json:"target"`
}

// named is one comparable element (index or foreign key) of a table.
type named struct {
	name string // as declared
	sig  string // normalized structure, used for equality
	text string // readable description
}

// TableChanges lists every structural difference between two versions of a
// table: columns (type, nullability, identity, default), primary key columns,
// indexes and foreign keys. Constraint and index names alone are not a
// difference: engines generate them (PK__t__3213E83F...) so they differ between
// environments for no reason.
func TableChanges(src, dst db.TableMeta) []TableChange {
	out := []TableChange{}
	out = append(out, columnChanges(src, dst)...)

	if sp, dp := strings.Join(lowerAll(src.PrimaryKey), ","), strings.Join(lowerAll(dst.PrimaryKey), ","); sp != dp {
		c := TableChange{Area: AreaPrimaryKey, Name: "Llave primaria", Status: Different}
		if len(src.PrimaryKey) > 0 {
			c.Source = "(" + strings.Join(src.PrimaryKey, ", ") + ")"
		}
		if len(dst.PrimaryKey) > 0 {
			c.Target = "(" + strings.Join(dst.PrimaryKey, ", ") + ")"
		}
		switch {
		case c.Source == "":
			c.Status = OnlyTarget
		case c.Target == "":
			c.Status = OnlySource
		}
		out = append(out, c)
	}

	out = append(out, matchNamed(AreaIndex, indexes(src), indexes(dst))...)
	out = append(out, matchNamed(AreaForeignKey, foreignKeys(src), foreignKeys(dst))...)
	return out
}

func lowerAll(in []string) []string {
	out := make([]string, len(in))
	for i, s := range in {
		out[i] = strings.ToLower(s)
	}
	return out
}

// ---- columns

func colSig(c db.MetaColumn) string {
	id := ""
	if c.Identity {
		id = fmt.Sprintf("identity(%d,%d)", c.IdentitySeed, c.IdentityStep)
	}
	return strings.Join([]string{
		normType(c.DataType), map[bool]string{true: "null", false: "notnull"}[c.Nullable], id, normDefault(c.Default),
	}, "|")
}

func colText(c db.MetaColumn) string {
	s := c.DataType
	if c.Identity {
		s += fmt.Sprintf(" IDENTITY(%d,%d)", c.IdentitySeed, c.IdentityStep)
	}
	if c.Nullable {
		s += " NULL"
	} else {
		s += " NOT NULL"
	}
	if c.Default != "" {
		s += " DEFAULT " + c.Default
	}
	return s
}

func columnChanges(src, dst db.TableMeta) []TableChange {
	byName := func(m db.TableMeta) map[string]db.MetaColumn {
		out := make(map[string]db.MetaColumn, len(m.Columns))
		for _, c := range m.Columns {
			out[strings.ToLower(c.Name)] = c
		}
		return out
	}
	s, d := byName(src), byName(dst)
	var out []TableChange
	for _, c := range src.Columns { // declared order keeps the output stable and readable
		o, ok := d[strings.ToLower(c.Name)]
		switch {
		case !ok:
			out = append(out, TableChange{Area: AreaColumn, Name: c.Name, Status: OnlySource, Source: colText(c)})
		case colSig(c) != colSig(o):
			out = append(out, TableChange{Area: AreaColumn, Name: c.Name, Status: Different, Source: colText(c), Target: colText(o)})
		}
	}
	for _, c := range dst.Columns {
		if _, ok := s[strings.ToLower(c.Name)]; !ok {
			out = append(out, TableChange{Area: AreaColumn, Name: c.Name, Status: OnlyTarget, Target: colText(c)})
		}
	}
	return out
}

// normType lowercases and removes spaces: "NVARCHAR(50)" == "nvarchar(50)".
func normType(t string) string {
	return strings.ToLower(strings.Join(strings.Fields(t), ""))
}

// normDefault makes equivalent default expressions compare equal: SQL Server
// stores them wrapped in parentheses (((0)) for 0) and in any letter case.
func normDefault(d string) string {
	d = strings.ToLower(strings.Join(strings.Fields(d), " "))
	for len(d) >= 2 && d[0] == '(' && d[len(d)-1] == ')' && wrapped(d) {
		d = strings.TrimSpace(d[1 : len(d)-1])
	}
	return d
}

// wrapped reports whether the first '(' of s closes at its last character.
func wrapped(s string) bool {
	depth := 0
	inStr := false
	for i := 0; i < len(s); i++ {
		switch c := s[i]; {
		case c == '\'':
			inStr = !inStr
		case inStr:
		case c == '(':
			depth++
		case c == ')':
			depth--
			if depth == 0 && i != len(s)-1 {
				return false
			}
		}
	}
	return depth == 0
}

// ---- indexes and foreign keys

func indexes(m db.TableMeta) []named {
	out := make([]named, 0, len(m.Indexes))
	for _, ix := range m.Indexes {
		kind := "INDEX"
		if ix.Unique {
			kind = "UNIQUE INDEX"
		}
		text := fmt.Sprintf("%s (%s)", kind, strings.Join(ix.Columns, ", "))
		if len(ix.Included) > 0 {
			text += " INCLUDE (" + strings.Join(ix.Included, ", ") + ")"
		}
		sig := strings.ToLower(text)
		if ix.Definition != "" { // PostgreSQL: the full statement, which embeds the index name
			text = ix.Definition
			sig = normDefault(ix.Definition)
		}
		out = append(out, named{name: ix.Name, sig: sig, text: text})
	}
	return out
}

func foreignKeys(m db.TableMeta) []named {
	type fk struct {
		from, to []string
		ref      string
	}
	order := []string{}
	groups := map[string]*fk{}
	for _, f := range m.ForeignKeys {
		g, ok := groups[f.Name]
		if !ok {
			g = &fk{ref: f.ToSchema + "." + f.ToTable}
			groups[f.Name] = g
			order = append(order, f.Name)
		}
		g.from = append(g.from, f.FromColumn)
		g.to = append(g.to, f.ToColumn)
	}
	out := make([]named, 0, len(order))
	for _, name := range order {
		g := groups[name]
		text := fmt.Sprintf("(%s) → %s (%s)", strings.Join(g.from, ", "), g.ref, strings.Join(g.to, ", "))
		out = append(out, named{name: name, sig: strings.ToLower(text), text: text})
	}
	return out
}

// matchNamed pairs elements by name (changed when their structure differs) and
// then pairs the leftovers by structure, so a renamed-but-identical index or
// foreign key is not reported.
func matchNamed(area string, src, dst []named) []TableChange {
	var out []TableChange
	dstByName := map[string]int{}
	for i, d := range dst {
		dstByName[strings.ToLower(d.name)] = i
	}
	usedDst := map[int]bool{}
	var leftSrc []named
	for _, s := range src {
		i, ok := dstByName[strings.ToLower(s.name)]
		if !ok {
			leftSrc = append(leftSrc, s)
			continue
		}
		usedDst[i] = true
		if s.sig != dst[i].sig {
			out = append(out, TableChange{Area: area, Name: s.name, Status: Different, Source: s.text, Target: dst[i].text})
		}
	}
	var leftDst []named
	for i, d := range dst {
		if !usedDst[i] {
			leftDst = append(leftDst, d)
		}
	}
	// Leftovers with the same structure are the same element under another name.
	for _, s := range leftSrc {
		matched := false
		for j, d := range leftDst {
			if d.sig == s.sig && d.name != "" {
				leftDst = append(leftDst[:j], leftDst[j+1:]...)
				matched = true
				break
			}
		}
		if !matched {
			out = append(out, TableChange{Area: area, Name: s.name, Status: OnlySource, Source: s.text})
		}
	}
	for _, d := range leftDst {
		out = append(out, TableChange{Area: area, Name: d.name, Status: OnlyTarget, Target: d.text})
	}
	return out
}
