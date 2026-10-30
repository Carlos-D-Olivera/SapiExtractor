package compare

import (
	"fmt"
	"regexp"
	"strings"

	"sp-extractor-wails/pkg/db"
	"sp-extractor-wails/pkg/db/scriptgen"
)

// SyncOptions controls what the generated script may do.
type SyncOptions struct {
	// IncludeDrops emits the destructive statements (dropping objects, columns,
	// indexes and foreign keys that only exist in the target). Without it they
	// are written as comments so they can be reviewed and enabled by hand.
	IncludeDrops bool `json:"includeDrops"`
}

// SyncItem is one object to bring from the source into the target.
type SyncItem struct {
	Object    db.DbObject
	Status    Status
	SourceDef string        // routines, views and triggers
	Source    *db.TableMeta // tables
	Target    *db.TableMeta // tables that exist on both sides
}

// BuildSync returns a script that makes the target look like the source for
// the given items. It never touches objects that are not listed.
func BuildSync(t db.DatabaseType, items []SyncItem, opts SyncOptions) string {
	w := &syncWriter{t: t, drops: opts.IncludeDrops}

	var tables, routines, drops []SyncItem
	for _, it := range items {
		switch {
		case it.Status == OnlyTarget:
			drops = append(drops, it)
		case it.Object.Type == db.Table:
			tables = append(tables, it)
		case it.Status == OnlySource || it.Status == Different:
			routines = append(routines, it)
		}
	}

	var fks []string // created after every table exists
	for _, it := range tables {
		w.section(it)
		fks = append(fks, w.table(it)...)
	}
	if len(fks) > 0 {
		w.raw("-- Llaves foráneas de las tablas nuevas")
		for _, f := range fks {
			w.raw(f)
		}
	}
	for _, it := range routines {
		w.section(it)
		w.routine(it)
	}
	for _, it := range drops {
		w.section(it)
		w.drop(it)
	}
	if len(w.lines) == 0 {
		return "-- No hay cambios que sincronizar con la selección actual."
	}
	return strings.TrimSpace(strings.Join(w.lines, "\n")) + "\n"
}

type syncWriter struct {
	t     db.DatabaseType
	drops bool
	lines []string
	n     int // statements written (not comments)
}

func (w *syncWriter) raw(s string) { w.lines = append(w.lines, s) }

func (w *syncWriter) section(it SyncItem) {
	label := map[Status]string{OnlySource: "no existe en el destino", Different: "distinto", OnlyTarget: "solo en el destino"}[it.Status]
	w.lines = append(w.lines, "", fmt.Sprintf("-- ===== %s: %s (%s) =====", typeLabel(it.Object.Type), it.Object.FullName(), label))
}

func typeLabel(t db.DbObjectType) string {
	switch t {
	case db.Table:
		return "TABLA"
	case db.StoredProcedure:
		return "PROCEDIMIENTO"
	case db.Function:
		return "FUNCIÓN"
	case db.View:
		return "VISTA"
	case db.Trigger:
		return "TRIGGER"
	}
	return string(t)
}

func (w *syncWriter) end() string {
	if w.t == db.SQLServer {
		return "\nGO"
	}
	return ""
}

// stmt writes an executable statement. Destructive ones are commented out unless drops are enabled.
func (w *syncWriter) stmt(s string, destructive bool) {
	s = strings.TrimRight(s, "; \n")
	if destructive && !w.drops {
		w.raw("-- (omitido: activa «Incluir DROP» para ejecutarlo)")
		for _, l := range strings.Split(s+";", "\n") {
			w.raw("-- " + l)
		}
		return
	}
	w.raw(s + ";" + w.end())
	w.n++
}

func (w *syncWriter) warn(format string, a ...any) { w.raw("-- ⚠ " + fmt.Sprintf(format, a...)) }

var routineHeader = regexp.MustCompile(`(?is)\A((?:\s|--[^\n]*\n|/\*.*?\*/)*)(?:create\s+or\s+alter|create|alter)(\s+(?:proc(?:edure)?|function|view|trigger)\b)`)

// CreateOrAlter rewrites the leading CREATE/ALTER of a SQL Server definition to
// CREATE OR ALTER so the same script works whether or not the object exists.
func CreateOrAlter(def string) string {
	return routineHeader.ReplaceAllString(def, "${1}CREATE OR ALTER${2}")
}

func (w *syncWriter) routine(it SyncItem) {
	def := strings.TrimSpace(it.SourceDef)
	if def == "" {
		w.warn("la definición del origen está vacía (¿objeto cifrado?); se omite")
		return
	}
	switch w.t {
	case db.SQLServer:
		def = CreateOrAlter(def)
	case db.MySQL:
		w.stmt(fmt.Sprintf("DROP PROCEDURE IF EXISTS %s", scriptgen.QuoteIdent(w.t, it.Object.Name)), false)
	}
	w.raw(strings.TrimRight(def, "; \n") + ";" + w.end())
	w.n++
}

func (w *syncWriter) drop(it SyncItem) {
	o := it.Object
	name := scriptgen.QualifiedName(w.t, o.Schema, o.Name)
	var kind string
	switch o.Type {
	case db.Table:
		kind = "TABLE"
	case db.StoredProcedure:
		kind = "PROCEDURE"
	case db.Function:
		kind = "FUNCTION"
	case db.View:
		kind = "VIEW"
	case db.Trigger:
		kind = "TRIGGER"
	}
	// PostgreSQL routines are identified by their signature, and its triggers by their table.
	if w.t == db.PostgreSQL && (o.Type == db.StoredProcedure || o.Type == db.Function || o.Type == db.Trigger) {
		w.warn("PostgreSQL necesita la firma/tabla para borrar este objeto; hazlo a mano: DROP %s %s", kind, name)
		return
	}
	w.stmt(fmt.Sprintf("DROP %s IF EXISTS %s", kind, name), true)
}

// ---- tables

// table writes the statements for one table and returns the FK statements that must run after every table exists.
func (w *syncWriter) table(it SyncItem) []string {
	if it.Source == nil {
		w.warn("no se pudo leer la estructura del origen; se omite")
		return nil
	}
	if it.Status == OnlySource {
		var late []string
		for _, s := range scriptgen.Generate(w.t, *it.Source) {
			switch s.ID {
			case "create", "indexes":
				w.raw(s.SQL)
				w.n++
			case "fks":
				late = append(late, s.SQL)
			}
		}
		return late
	}
	if it.Target == nil {
		w.warn("no se pudo leer la estructura del destino; se omite")
		return nil
	}
	src, dst := *it.Source, *it.Target
	tbl := scriptgen.QualifiedName(w.t, src.Schema, src.Name)
	for _, c := range TableChanges(src, dst) {
		switch c.Area {
		case AreaColumn:
			w.column(tbl, c, src, dst)
		case AreaPrimaryKey:
			w.warn("llave primaria distinta (origen %s, destino %s); revísala a mano", orNone(c.Source), orNone(c.Target))
		case AreaIndex:
			w.index(c, src, dst)
		case AreaForeignKey:
			w.foreignKey(tbl, c, src, dst)
		}
	}
	return nil
}

func orNone(s string) string {
	if s == "" {
		return "sin PK"
	}
	return s
}

func findColumn(m db.TableMeta, name string) (db.MetaColumn, bool) {
	for _, c := range m.Columns {
		if strings.EqualFold(c.Name, name) {
			return c, true
		}
	}
	return db.MetaColumn{}, false
}

func (w *syncWriter) column(tbl string, c TableChange, src, dst db.TableMeta) {
	if w.t != db.SQLServer {
		// Column DDL differs a lot between engines: report instead of guessing.
		w.raw(fmt.Sprintf("-- columna %s: origen [%s] / destino [%s]", c.Name, orNone2(c.Source), orNone2(c.Target)))
		return
	}
	q := scriptgen.QuoteIdent(w.t, c.Name)
	switch c.Status {
	case OnlySource:
		col, _ := findColumn(src, c.Name)
		line := col.DataType
		if col.Identity {
			line += fmt.Sprintf(" IDENTITY(%d,%d)", orOne(col.IdentitySeed), orOne(col.IdentityStep))
		}
		if col.Nullable {
			line += " NULL"
		} else {
			line += " NOT NULL"
			if col.Default == "" && !col.Identity {
				w.warn("%s es NOT NULL sin DEFAULT: fallará si la tabla ya tiene filas", c.Name)
			}
		}
		if col.Default != "" {
			line += " DEFAULT " + col.Default
		}
		w.stmt(fmt.Sprintf("ALTER TABLE %s ADD %s %s", tbl, q, line), false)
	case OnlyTarget:
		w.stmt(fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", tbl, q), true)
	case Different:
		sc, _ := findColumn(src, c.Name)
		dc, _ := findColumn(dst, c.Name)
		if sc.Identity != dc.Identity {
			w.warn("%s: IDENTITY no se puede cambiar con ALTER COLUMN; hay que recrear la columna o la tabla", c.Name)
		}
		if normDefault(sc.Default) != normDefault(dc.Default) {
			w.warn("%s: el DEFAULT difiere (origen %s, destino %s); revísalo a mano", c.Name, orNone2(sc.Default), orNone2(dc.Default))
		}
		if normType(sc.DataType) != normType(dc.DataType) || sc.Nullable != dc.Nullable {
			if !sc.Nullable && dc.Nullable {
				w.warn("%s pasa a NOT NULL: fallará si hay valores NULL", c.Name)
			}
			w.warn("%s: cambiar el tipo puede truncar datos o fallar si la columna está en índices/constraints", c.Name)
			null := "NOT NULL"
			if sc.Nullable {
				null = "NULL"
			}
			w.stmt(fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s %s %s", tbl, q, sc.DataType, null), false)
		}
	}
}

func orNone2(s string) string {
	if s == "" {
		return "—"
	}
	return s
}

func orOne(v int64) int64 {
	if v == 0 {
		return 1
	}
	return v
}

func findIndex(m db.TableMeta, name string) (db.MetaIndex, bool) {
	for _, ix := range m.Indexes {
		if strings.EqualFold(ix.Name, name) {
			return ix, true
		}
	}
	return db.MetaIndex{}, false
}

func (w *syncWriter) dropIndex(m db.TableMeta, ix db.MetaIndex) {
	if w.t == db.PostgreSQL {
		w.stmt(fmt.Sprintf("DROP INDEX IF EXISTS %s", scriptgen.QualifiedName(w.t, m.Schema, ix.Name)), true)
		return
	}
	w.stmt(fmt.Sprintf("DROP INDEX %s ON %s", scriptgen.QuoteIdent(w.t, ix.Name), scriptgen.QualifiedName(w.t, m.Schema, m.Name)), true)
}

func (w *syncWriter) createIndex(m db.TableMeta, ix db.MetaIndex) {
	one := db.TableMeta{Schema: m.Schema, Name: m.Name, Indexes: []db.MetaIndex{ix}}
	for _, s := range scriptgen.Generate(w.t, one) {
		if s.ID == "indexes" {
			w.raw(s.SQL)
			w.n++
		}
	}
}

func (w *syncWriter) index(c TableChange, src, dst db.TableMeta) {
	switch c.Status {
	case OnlySource:
		if ix, ok := findIndex(src, c.Name); ok {
			w.createIndex(src, ix)
		}
	case OnlyTarget:
		if ix, ok := findIndex(dst, c.Name); ok {
			w.dropIndex(dst, ix)
		}
	case Different:
		// Recreating means dropping the target's one first; without drops only report it.
		if !w.drops {
			w.warn("el índice %s difiere: para recrearlo hay que borrar el del destino (activa «Incluir DROP»)", c.Name)
			return
		}
		if old, ok := findIndex(dst, c.Name); ok {
			w.dropIndex(dst, old)
		}
		if ix, ok := findIndex(src, c.Name); ok {
			w.createIndex(src, ix)
		}
	}
}

func fkRows(m db.TableMeta, name string) []db.ForeignKey {
	var out []db.ForeignKey
	for _, f := range m.ForeignKeys {
		if strings.EqualFold(f.Name, name) {
			out = append(out, f)
		}
	}
	return out
}

func (w *syncWriter) foreignKey(tbl string, c TableChange, src, dst db.TableMeta) {
	drop := func() {
		if w.t == db.MySQL {
			w.stmt(fmt.Sprintf("ALTER TABLE %s DROP FOREIGN KEY %s", tbl, scriptgen.QuoteIdent(w.t, c.Name)), true)
			return
		}
		w.stmt(fmt.Sprintf("ALTER TABLE %s DROP CONSTRAINT %s", tbl, scriptgen.QuoteIdent(w.t, c.Name)), true)
	}
	add := func() {
		one := db.TableMeta{Schema: src.Schema, Name: src.Name, ForeignKeys: fkRows(src, c.Name)}
		for _, s := range scriptgen.Generate(w.t, one) {
			if s.ID == "fks" {
				w.raw(s.SQL)
				w.n++
			}
		}
	}
	switch c.Status {
	case OnlySource:
		add()
	case OnlyTarget:
		drop()
	case Different:
		if !w.drops {
			w.warn("la llave foránea %s difiere: para recrearla hay que borrar la del destino (activa «Incluir DROP»)", c.Name)
			return
		}
		drop()
		add()
	}
}
