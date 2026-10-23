package debug

import (
	"reflect"
	"testing"
)

func TestParseExec(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want ExecCall
		ok   bool
	}{
		{
			"named rpc with strings, numbers and null",
			`exec [JuntasMedicas].[usp_Obtener] @sId=N'AB-12',@n=5,@d=NULL`,
			ExecCall{Schema: "JuntasMedicas", Name: "usp_Obtener", Args: []Arg{
				{Name: "@sId", Value: "AB-12"}, {Name: "@n", Value: "5"}, {Name: "@d", IsNull: true},
			}}, true,
		},
		{
			"escaped quote and comma inside a string",
			`EXEC dbo.p @a=N'O''Brien, Pat',@b=1`,
			ExecCall{Schema: "dbo", Name: "p", Args: []Arg{{Name: "@a", Value: "O'Brien, Pat"}, {Name: "@b", Value: "1"}}}, true,
		},
		{
			"unqualified, positional",
			`EXECUTE usp_x 1, 'texto', NULL;`,
			ExecCall{Name: "usp_x", Args: []Arg{{Value: "1"}, {Value: "texto"}, {IsNull: true}}}, true,
		},
		{
			"return variable and database-qualified name",
			`EXEC @rc = [Ventas].[dbo].[p] @x = 2`,
			ExecCall{Schema: "dbo", Name: "p", Args: []Arg{{Name: "@x", Value: "2"}}}, true,
		},
		{
			"no arguments",
			`exec dbo.p`,
			ExecCall{Schema: "dbo", Name: "p"}, true,
		},
		{
			"default keyword and output flag",
			`exec p @a=default,@o=NULL output`,
			ExecCall{Name: "p", Args: []Arg{{Name: "@a", UseDefault: true}, {Name: "@o", IsNull: true, Output: true}}}, true,
		},
		{
			"leading comment",
			"-- llamada\nexec p @a=1",
			ExecCall{Name: "p", Args: []Arg{{Name: "@a", Value: "1"}}}, true,
		},
		{
			"profiler style preamble with output variable",
			"declare @p3 int\nset @p3=7\nexec dbo.p @a=1,@o=@p3 output",
			ExecCall{Schema: "dbo", Name: "p", Args: []Arg{{Name: "@a", Value: "1"}, {Name: "@o", Value: "7", Output: true}}}, true,
		},
		{"dynamic exec of a variable", `EXEC @sql`, ExecCall{}, false},
		{"a select is not a call", `SELECT * FROM t`, ExecCall{}, false},
		{"exec in the middle", `SELECT 1; EXEC p`, ExecCall{}, false},
		{"exec of a string", `EXEC('select 1')`, ExecCall{}, false},
	}
	for _, c := range cases {
		got, ok := ParseExec(c.in)
		if ok != c.ok {
			t.Errorf("%s: ok = %v, want %v (%+v)", c.name, ok, c.ok, got)
			continue
		}
		if ok && !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s:\n got  %+v\n want %+v", c.name, got, c.want)
		}
	}
}
