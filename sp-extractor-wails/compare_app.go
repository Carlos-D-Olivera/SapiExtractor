package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"sp-extractor-wails/pkg/db"
	"sp-extractor-wails/pkg/db/compare"
)

// compareWorkers bounds the concurrent definition queries per side.
const compareWorkers = 6

// CompareRequest selects what to compare between two workspaces.
type CompareRequest struct {
	Types   []string        `json:"types"`
	Options compare.Options `json:"options"`
}

// compareSessions resolves both sides and checks they can be compared.
func (a *App) compareSessions(srcWs, dstWs string) (*WorkspaceSession, *WorkspaceSession, error) {
	if srcWs == dstWs {
		return nil, nil, fmt.Errorf("elige un destino distinto del origen")
	}
	src, err := a.getSession(srcWs)
	if err != nil {
		return nil, nil, err
	}
	dst, err := a.getSession(dstWs)
	if err != nil {
		return nil, nil, fmt.Errorf("el destino no está conectado: %w", err)
	}
	if src.connInfo.DbType != dst.connInfo.DbType {
		return nil, nil, fmt.Errorf("solo se pueden comparar bases del mismo motor (%s contra %s)", src.connInfo.DbType, dst.connInfo.DbType)
	}
	return src, dst, nil
}

// withSideSchema returns obj as the given session knows it. MySQL "schemas" are
// databases, so each side is queried with its own.
func withSideSchema(s *WorkspaceSession, obj db.DbObject) db.DbObject {
	if s.connInfo.DbType == db.MySQL {
		obj.Schema = s.connInfo.DbName
	}
	return obj
}

func (s *WorkspaceSession) definitionOf(obj db.DbObject) (string, error) {
	obj = withSideSchema(s, obj)
	if err := s.extractor.FillDefinition(s.conn, &obj); err != nil {
		return "", err
	}
	return obj.Definition, nil
}

// tableMetaOf reads a table's structure; fks is the side's database-wide FK list.
func (s *WorkspaceSession) tableMetaOf(obj db.DbObject, fks []db.ForeignKey) (db.TableMeta, error) {
	obj = withSideSchema(s, obj)
	return s.extractor.TableMetaWithFKs(s.conn, obj.Schema, obj.Name, fks)
}

// sideForeignKeys loads the FK list once per side (non-nil, so it is reused for every table).
func (s *WorkspaceSession) sideForeignKeys() ([]db.ForeignKey, error) {
	fks, err := s.extractor.ListForeignKeys(s.conn)
	if fks == nil {
		fks = []db.ForeignKey{}
	}
	return fks, err
}

// CompareObjects compares the objects of two connected workspaces
// (source = srcWs, target = dstWs). Progress goes out through "compare:progress".
func (a *App) CompareObjects(srcWs, dstWs string, req CompareRequest) (compare.Result, error) {
	src, dst, err := a.compareSessions(srcWs, dstWs)
	if err != nil {
		return compare.Result{Items: []compare.Item{}}, err
	}

	ctx, cancel := context.WithCancel(a.ctx)
	src.compareMu.Lock()
	if src.compareCancel != nil {
		src.compareMu.Unlock()
		cancel()
		return compare.Result{Items: []compare.Item{}}, fmt.Errorf("ya hay una comparación en curso")
	}
	src.compareCancel = cancel
	src.compareMu.Unlock()
	defer func() {
		cancel()
		src.compareMu.Lock()
		src.compareCancel = nil
		src.compareMu.Unlock()
	}()

	t := src.connInfo.DbType
	emit := func(phase string, done, total int) {
		runtime.EventsEmit(a.ctx, "compare:progress", map[string]any{
			"workspaceId": srcWs, "phase": phase, "done": done, "total": total,
		})
	}

	// 1. Inventories of both sides.
	emit("listing", 0, 0)
	srcObjs, dstObjs := map[string]db.DbObject{}, map[string]db.DbObject{}
	for _, name := range req.Types {
		if ctx.Err() != nil {
			return compare.Result{Items: []compare.Item{}}, ctx.Err()
		}
		ot := db.DbObjectType(name)
		l, err := src.extractor.ExtractObjects(src.conn, ot, "", 0)
		if err != nil {
			return compare.Result{Items: []compare.Item{}}, fmt.Errorf("origen: %w", err)
		}
		for _, o := range l {
			srcObjs[compare.Key(t, o)] = o
		}
		l, err = dst.extractor.ExtractObjects(dst.conn, ot, "", 0)
		if err != nil {
			return compare.Result{Items: []compare.Item{}}, fmt.Errorf("destino: %w", err)
		}
		for _, o := range l {
			dstObjs[compare.Key(t, o)] = o
		}
	}

	// 2. Definitions (or table structures), only for objects present on both sides.
	var srcFKs, dstFKs []db.ForeignKey
	for _, name := range req.Types {
		if db.DbObjectType(name) != db.Table {
			continue
		}
		if srcFKs, err = src.sideForeignKeys(); err != nil {
			return compare.Result{Items: []compare.Item{}}, fmt.Errorf("origen: %w", err)
		}
		if dstFKs, err = dst.sideForeignKeys(); err != nil {
			return compare.Result{Items: []compare.Item{}}, fmt.Errorf("destino: %w", err)
		}
	}
	var common []string
	for k := range srcObjs {
		if _, ok := dstObjs[k]; ok {
			common = append(common, k)
		}
	}
	total := len(common) * 2
	var (
		mu       sync.Mutex
		done     int
		firstErr error
		srcDefs  = make(map[string]string, len(common))
		dstDefs  = make(map[string]string, len(common))
		srcMetas = map[string]*db.TableMeta{}
		dstMetas = map[string]*db.TableMeta{}
	)
	type job struct {
		key  string
		side *WorkspaceSession
		obj  db.DbObject
		out  map[string]string
		fks  []db.ForeignKey
		meta map[string]*db.TableMeta
	}
	jobs := make(chan job)
	var wg sync.WaitGroup
	for i := 0; i < compareWorkers*2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				if ctx.Err() != nil {
					continue // drain
				}
				var def string
				var meta db.TableMeta
				var err error
				if j.obj.Type == db.Table {
					meta, err = j.side.tableMetaOf(j.obj, j.fks)
				} else {
					def, err = j.side.definitionOf(j.obj)
				}
				mu.Lock()
				if err != nil && firstErr == nil {
					firstErr = fmt.Errorf("%s: %w", j.obj.Name, err)
				}
				if j.obj.Type == db.Table {
					j.meta[j.key] = &meta
				} else {
					j.out[j.key] = def
				}
				done++
				report := done%5 == 0 || done == total
				d := done
				mu.Unlock()
				if report {
					emit("definitions", d, total)
				}
			}
		}()
	}
	emit("definitions", 0, total)
	for _, k := range common {
		jobs <- job{k, src, srcObjs[k], srcDefs, srcFKs, srcMetas}
		jobs <- job{k, dst, dstObjs[k], dstDefs, dstFKs, dstMetas}
	}
	close(jobs)
	wg.Wait()
	if ctx.Err() != nil {
		return compare.Result{Items: []compare.Item{}}, fmt.Errorf("comparación cancelada")
	}
	if firstErr != nil {
		return compare.Result{Items: []compare.Item{}}, firstErr
	}

	// 3. Classify.
	toEntries := func(objs map[string]db.DbObject, defs map[string]string, metas map[string]*db.TableMeta) []compare.Entry {
		out := make([]compare.Entry, 0, len(objs))
		for k, o := range objs {
			out = append(out, compare.Entry{Type: o.Type, Schema: o.Schema, Name: o.Name, ParentName: o.ParentName, Definition: defs[k], Table: metas[k]})
		}
		return out
	}
	return compare.Compare(t, toEntries(srcObjs, srcDefs, srcMetas), toEntries(dstObjs, dstDefs, dstMetas), req.Options), nil
}

// CancelCompare aborts the comparison started from the given source workspace.
func (a *App) CancelCompare(srcWs string) {
	src, err := a.getSession(srcWs)
	if err != nil {
		return
	}
	src.compareMu.Lock()
	defer src.compareMu.Unlock()
	if src.compareCancel != nil {
		src.compareCancel()
	}
}

// CompareObjectDiff returns the side-by-side diff of one object between source and target.
func (a *App) CompareObjectDiff(srcWs, dstWs string, obj db.DbObject, opts compare.Options) (compare.Diff, error) {
	src, dst, err := a.compareSessions(srcWs, dstWs)
	if err != nil {
		return compare.Diff{Rows: []compare.Row{}}, err
	}
	var srcDef, dstDef string
	var srcErr, dstErr error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); srcDef, srcErr = src.definitionOf(obj) }()
	go func() { defer wg.Done(); dstDef, dstErr = dst.definitionOf(obj) }()
	wg.Wait()
	if srcErr != nil {
		return compare.Diff{Rows: []compare.Row{}}, fmt.Errorf("origen: %w", srcErr)
	}
	if dstErr != nil {
		return compare.Diff{Rows: []compare.Row{}}, fmt.Errorf("destino: %w", dstErr)
	}
	return compare.DiffText(srcDef, dstDef, opts), nil
}

// CompareTableDetail returns the structural differences of one table between source and target.
func (a *App) CompareTableDetail(srcWs, dstWs string, obj db.DbObject) ([]compare.TableChange, error) {
	src, dst, err := a.compareSessions(srcWs, dstWs)
	if err != nil {
		return []compare.TableChange{}, err
	}
	var sm, dm db.TableMeta
	var sErr, dErr error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); sm, sErr = src.tableMetaOf(obj, nil) }()
	go func() { defer wg.Done(); dm, dErr = dst.tableMetaOf(obj, nil) }()
	wg.Wait()
	if sErr != nil {
		return []compare.TableChange{}, fmt.Errorf("origen: %w", sErr)
	}
	if dErr != nil {
		return []compare.TableChange{}, fmt.Errorf("destino: %w", dErr)
	}
	return compare.TableChanges(sm, dm), nil
}

// SyncRef identifies one compared object and its status, as listed by CompareObjects.
type SyncRef struct {
	Type       string `json:"type"`
	Schema     string `json:"schema"`
	ParentName string `json:"parentName"`
	Name       string `json:"name"`
	Status     string `json:"status"`
}

// SyncRequest selects the objects to bring from the source into the target.
type SyncRequest struct {
	Items   []SyncRef           `json:"items"`
	Options compare.SyncOptions `json:"options"`
}

// GenerateSyncScript builds a script that makes the target (dstWs) match the
// source (srcWs) for the selected objects. It only returns text: nothing runs.
func (a *App) GenerateSyncScript(srcWs, dstWs string, req SyncRequest) (string, error) {
	src, dst, err := a.compareSessions(srcWs, dstWs)
	if err != nil {
		return "", err
	}
	var srcFKs, dstFKs []db.ForeignKey
	loadedFKs := false
	items := make([]compare.SyncItem, 0, len(req.Items))
	for _, r := range req.Items {
		obj := db.DbObject{Type: db.DbObjectType(r.Type), Schema: r.Schema, ParentName: r.ParentName, Name: r.Name}
		it := compare.SyncItem{Object: obj, Status: compare.Status(r.Status)}
		switch {
		case it.Status == compare.OnlyTarget:
			// nothing to read: it can only be dropped
		case obj.Type == db.Table:
			if !loadedFKs {
				if srcFKs, err = src.sideForeignKeys(); err != nil {
					return "", fmt.Errorf("origen: %w", err)
				}
				if dstFKs, err = dst.sideForeignKeys(); err != nil {
					return "", fmt.Errorf("destino: %w", err)
				}
				loadedFKs = true
			}
			sm, err := src.tableMetaOf(obj, srcFKs)
			if err != nil {
				return "", fmt.Errorf("%s: %w", obj.Name, err)
			}
			it.Source = &sm
			if it.Status == compare.Different {
				dm, err := dst.tableMetaOf(obj, dstFKs)
				if err != nil {
					return "", fmt.Errorf("%s (destino): %w", obj.Name, err)
				}
				it.Target = &dm
			}
		default:
			if it.SourceDef, err = src.definitionOf(obj); err != nil {
				return "", fmt.Errorf("%s: %w", obj.Name, err)
			}
		}
		items = append(items, it)
	}
	header := fmt.Sprintf("-- Script de sincronización generado por SapiExtractor\n-- Origen:  %s @ %s\n-- Destino: %s @ %s  (este script modifica el DESTINO)\n-- Revísalo antes de ejecutarlo.\n\n",
		src.connInfo.DbName, src.connInfo.Host, dst.connInfo.DbName, dst.connInfo.Host)
	return header + compare.BuildSync(src.connInfo.DbType, items, req.Options), nil
}

// SaveReport asks for a file name and writes the comparison report (Markdown).
func (a *App) SaveReport(defaultName, text string) (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Guardar reporte",
		DefaultFilename: defaultName,
		Filters:         []runtime.FileFilter{{DisplayName: "Markdown (*.md)", Pattern: "*.md"}},
	})
	if err != nil || path == "" {
		return "", err
	}
	if !strings.HasSuffix(strings.ToLower(path), ".md") {
		path += ".md"
	}
	if err := os.WriteFile(path, []byte(text), 0644); err != nil {
		return "", fmt.Errorf("error writing %s: %w", path, err)
	}
	return path, nil
}
