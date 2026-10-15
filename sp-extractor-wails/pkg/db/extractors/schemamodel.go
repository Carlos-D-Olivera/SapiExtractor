package extractors

import (
	"database/sql"
	"strings"

	"sp-extractor-wails/pkg/db"
)

// TableRef identifies a table by schema and name.
type TableRef struct {
	Schema string
	Name   string
}

func (t TableRef) key() string {
	return strings.ToLower(t.Schema) + "." + strings.ToLower(t.Name)
}

// BuildSchemaModel performs a breadth-first expansion over the foreign-key graph
// starting at seed, up to depth hops (depth >= 1), and loads the columns of the
// tables that end up in the graph. loadCols is used to fetch columns per table.
func BuildSchemaModel(
	conn *sql.DB,
	allFKs []db.ForeignKey,
	seed TableRef,
	depth int,
	loadCols func(schema, table string) ([]db.TableColumn, error),
) (db.SchemaModel, error) {
	if depth < 1 {
		depth = 1
	}

	// Adjacency: table key -> set of table keys it is connected to.
	adj := map[string]map[string]bool{}
	touch := func(a, b TableRef) {
		if adj[a.key()] == nil {
			adj[a.key()] = map[string]bool{}
		}
		adj[a.key()][b.key()] = true
	}
	tableByKey := map[string]TableRef{}
	addTable := func(t TableRef) {
		tableByKey[t.key()] = t
	}
	for _, fk := range allFKs {
		from := TableRef{fk.FromSchema, fk.FromTable}
		to := TableRef{fk.ToSchema, fk.ToTable}
		addTable(from)
		addTable(to)
		touch(from, to)
		touch(to, from)
	}

	// BFS from seed, level by level.
	visited := map[string]bool{}
	seedKey := seed.key()
	visited[seedKey] = true
	tableByKey[seedKey] = seed
	frontier := []string{seedKey}
	for d := 0; d < depth; d++ {
		var next []string
		for _, k := range frontier {
			for nk := range adj[k] {
				if !visited[nk] {
					visited[nk] = true
					next = append(next, nk)
				}
			}
		}
		frontier = next
		if len(frontier) == 0 {
			break
		}
	}

	// Keep only edges whose both endpoints are in the visited set.
	var edges []db.ForeignKey
	for _, fk := range allFKs {
		from := TableRef{fk.FromSchema, fk.FromTable}.key()
		to := TableRef{fk.ToSchema, fk.ToTable}.key()
		if visited[from] && visited[to] {
			edges = append(edges, fk)
		}
	}

	model := db.SchemaModel{Tables: []db.SchemaTable{}, Edges: edges}
	if model.Edges == nil {
		model.Edges = []db.ForeignKey{}
	}
	for k := range visited {
		ref := tableByKey[k]
		cols, err := loadCols(ref.Schema, ref.Name)
		if err != nil {
			return model, err
		}
		if cols == nil {
			cols = []db.TableColumn{}
		}
		model.Tables = append(model.Tables, db.SchemaTable{Schema: ref.Schema, Name: ref.Name, Columns: cols})
	}
	return model, nil
}

// escapeLike neutralizes LIKE wildcards in a user-supplied search term.
func escapeLike(term string) string {
	replacer := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_")
	return replacer.Replace(term)
}
