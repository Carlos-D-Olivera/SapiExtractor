package debug

import (
	"encoding/xml"
	"fmt"
	"strconv"
	"strings"
)

// rawEvent is one captured statement (or error) in the order it was recorded.
type rawEvent struct {
	Kind       string // "stmt" | "error"
	DBID       int64
	ObjectID   int64
	ObjectName string
	Level      int
	Line       int
	Offset     int64 // byte offset of the statement inside the module text (UTF-16)
	OffsetEnd  int64 // -1 = to the end
	Text       string
	Duration   int64
	CPU        int64
	Reads      int64
	Writes     int64
	Rows       int64
	ErrNo      int64
	Severity   int64
}

type bufferInfo struct {
	Truncated bool
	Dropped   int64
}

type xmlRoot struct {
	Truncated string     `xml:"truncated,attr"`
	Dropped   string     `xml:"droppedCount,attr"`
	Events    []xmlEvent `xml:"event"`
}

type xmlEvent struct {
	Name string     `xml:"name,attr"`
	Data []xmlField `xml:"data"`
}

type xmlField struct {
	Name  string `xml:"name,attr"`
	Value string `xml:"value"`
}

// parseEvents reads the ring buffer XML. Events keep document order, which is
// the order in which they were recorded.
func parseEvents(doc string) ([]rawEvent, bufferInfo, error) {
	var root xmlRoot
	if err := xml.Unmarshal([]byte(doc), &root); err != nil {
		return nil, bufferInfo{}, fmt.Errorf("no se pudo interpretar el buffer de la traza: %w", err)
	}
	info := bufferInfo{Truncated: root.Truncated == "1"}
	info.Dropped, _ = strconv.ParseInt(strings.TrimSpace(root.Dropped), 10, 64)

	out := make([]rawEvent, 0, len(root.Events))
	for _, x := range root.Events {
		f := map[string]string{}
		for _, d := range x.Data {
			f[d.Name] = d.Value
		}
		num := func(k string) int64 {
			n, _ := strconv.ParseInt(strings.TrimSpace(f[k]), 10, 64)
			return n
		}
		switch x.Name {
		case "sp_statement_completed":
			out = append(out, rawEvent{
				Kind: "stmt", DBID: num("source_database_id"), ObjectID: num("object_id"),
				ObjectName: f["object_name"], Level: int(num("nest_level")), Line: int(num("line_number")),
				Offset: num("offset"), OffsetEnd: num("offset_end"), Text: f["statement"],
				Duration: num("duration"), CPU: num("cpu_time"), Reads: num("logical_reads"),
				Writes: num("writes"), Rows: num("row_count"),
			})
		case "error_reported":
			out = append(out, rawEvent{
				Kind: "error", Text: f["message"], ErrNo: num("error_number"), Severity: num("severity"),
			})
		}
	}
	return out, info, nil
}
