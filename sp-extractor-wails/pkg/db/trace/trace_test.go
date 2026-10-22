package trace

import (
	"strings"
	"testing"
)

const sampleBuffer = `<RingBufferTarget truncated="0" eventCount="3" droppedCount="0" memoryUsed="1">
<event name="sql_batch_completed" package="sqlserver" timestamp="2026-10-22T15:04:05.1234567Z">
  <data name="duration"><type name="uint64" package="package0" /><value>2500000</value></data>
  <data name="cpu_time"><type name="uint64" package="package0" /><value>1200000</value></data>
  <data name="logical_reads"><type name="uint64" package="package0" /><value>42</value></data>
  <data name="writes"><type name="uint64" package="package0" /><value>3</value></data>
  <data name="row_count"><type name="uint64" package="package0" /><value>7</value></data>
  <data name="result"><type name="sql_batch_completed_result" package="sqlserver" /><value>0</value><text>OK</text></data>
  <data name="batch_text"><type name="unicode_string" package="package0" /><value>SELECT * FROM dbo.Pedidos WHERE Id &lt; 10</value></data>
  <action name="client_app_name" package="sqlserver"><type name="unicode_string" package="package0" /><value>MiApp</value></action>
  <action name="client_hostname" package="sqlserver"><type name="unicode_string" package="package0" /><value>PC-01</value></action>
  <action name="database_name" package="sqlserver"><type name="unicode_string" package="package0" /><value>Ventas</value></action>
  <action name="username" package="sqlserver"><type name="unicode_string" package="package0" /><value>DOM\ana</value></action>
  <action name="session_id" package="sqlserver"><type name="uint16" package="package0" /><value>57</value></action>
</event>
<event name="rpc_completed" package="sqlserver" timestamp="2026-10-22T15:04:06.0000000Z">
  <data name="duration"><type name="uint64" package="package0" /><value>900</value></data>
  <data name="object_name"><type name="unicode_string" package="package0" /><value>usp_Obtener</value></data>
  <data name="statement"><type name="unicode_string" package="package0" /><value>exec usp_Obtener @id=5</value></data>
  <data name="result"><type name="rpc_completed_result" package="sqlserver" /><value>0</value><text>OK</text></data>
  <action name="session_id" package="sqlserver"><type name="uint16" package="package0" /><value>58</value></action>
</event>
<event name="error_reported" package="sqlserver" timestamp="2026-10-22T15:04:07.5000000Z">
  <data name="error_number"><type name="int32" package="package0" /><value>208</value></data>
  <data name="severity"><type name="int32" package="package0" /><value>16</value></data>
  <data name="message"><type name="unicode_string" package="package0" /><value>Invalid object name 'X'.</value></data>
  <action name="sql_text" package="sqlserver"><type name="unicode_string" package="package0" /><value>SELECT * FROM X</value></action>
  <action name="session_id" package="sqlserver"><type name="uint16" package="package0" /><value>57</value></action>
</event>
</RingBufferTarget>`

func TestParseRingBuffer(t *testing.T) {
	ev, err := ParseRingBuffer(sampleBuffer)
	if err != nil {
		t.Fatal(err)
	}
	if len(ev) != 3 {
		t.Fatalf("got %d events, want 3", len(ev))
	}
	b := ev[0]
	if b.Kind != "batch" || b.DurationUs != 2500000 || b.CPUUs != 1200000 || b.Reads != 42 || b.Writes != 3 || b.Rows != 7 {
		t.Errorf("bad batch metrics: %+v", b)
	}
	if b.Text != "SELECT * FROM dbo.Pedidos WHERE Id < 10" || b.Result != "OK" {
		t.Errorf("bad batch text/result: %+v", b)
	}
	if b.Database != "Ventas" || b.Login != `DOM\ana` || b.Host != "PC-01" || b.App != "MiApp" || b.SessionID != 57 {
		t.Errorf("bad batch actions: %+v", b)
	}
	if b.Time != "2026-10-22T15:04:05.123Z" {
		t.Errorf("bad time %q", b.Time)
	}
	if r := ev[1]; r.Kind != "rpc" || r.Object != "usp_Obtener" || r.Text != "exec usp_Obtener @id=5" {
		t.Errorf("bad rpc: %+v", r)
	}
	if e := ev[2]; e.Kind != "error" || e.ErrorNo != 208 || e.Severity != 16 || e.Text != "SELECT * FROM X" || e.Object != "Invalid object name 'X'." {
		t.Errorf("bad error: %+v", e)
	}
}

func TestFreshReturnsOnlyNewEvents(t *testing.T) {
	tr := &Tracer{seen: map[string]bool{}}
	ev, _ := ParseRingBuffer(sampleBuffer)

	first := tr.fresh(ev)
	if len(first) != 3 || first[0].Seq != 1 || first[2].Seq != 3 {
		t.Fatalf("first poll: %+v", first)
	}
	if again := tr.fresh(ev); len(again) != 0 {
		t.Fatalf("second poll of same buffer returned %d events", len(again))
	}
	// A new event appears in the buffer; the old ones are still there.
	extra := ev[0]
	extra.Time = "2026-10-22T15:04:09.000Z"
	next := tr.fresh(append(ev, extra))
	if len(next) != 1 || next[0].Seq != 4 {
		t.Fatalf("third poll: %+v", next)
	}
}

func TestBuildCreateSQL(t *testing.T) {
	got := buildCreateSQL("spx_trace_ab12cd34", "Ven'tas", "SapiExtractor", Options{MinDurationMs: 50})
	for _, want := range []string{
		"CREATE EVENT SESSION [spx_trace_ab12cd34] ON SERVER",
		"sqlserver.database_name = N'Ven''tas'",
		"sqlserver.client_app_name <> N'SapiExtractor'",
		"duration >= 50000",
		"severity >= 11",
		"package0.ring_buffer",
		"STARTUP_STATE = OFF",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
	if own := buildCreateSQL("spx_trace_ab12cd34", "V", "SapiExtractor", Options{IncludeOwn: true}); strings.Contains(own, "client_app_name <>") || strings.Contains(own, "duration >=") {
		t.Errorf("IncludeOwn / zero duration should drop those predicates:\n%s", own)
	}
}

func TestValidName(t *testing.T) {
	for name, want := range map[string]bool{
		"spx_trace_ab12cd34":   true,
		"spx_trace_":           true,
		"other_session":        false,
		"spx_trace_x]; DROP--": false,
		"spx_trace_UPPER":      false,
	} {
		if got := validName(name); got != want {
			t.Errorf("validName(%q) = %v, want %v", name, got, want)
		}
	}
}
