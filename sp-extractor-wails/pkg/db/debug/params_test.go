package debug

import (
	"reflect"
	"strings"
	"testing"
)

func TestDeclaredDefaults(t *testing.T) {
	tests := []struct {
		name, source string
		want         map[string]bool
	}{
		{"null defaults", `CREATE PROCEDURE Enfermeria.p
			@sAccion VARCHAR(200), @iSesion BIGINT = NULL, @iIdCiclo BIGINT=null
			AS BEGIN SELECT 1 END`, map[string]bool{"@isesion": true, "@iidciclo": true}},
		{"literals and types", `CREATE OR ALTER PROC [dbo].[p]
			@a decimal(18, 2) = -1.25, @b nvarchar(200) = N'it''s, AS @fake = NULL',
			@c int, @d bit = 0 OUTPUT WITH RECOMPILE AS SELECT 1`,
			map[string]bool{"@a": true, "@b": true, "@d": true}},
		{"comments", `ALTER PROC dbo.p
			@a int /* = NULL, AS /* nested */ */, -- @fake = NULL
			@b int /* ignored */ = /* AS */ NULL AS SELECT 1`, map[string]bool{"@b": true}},
		{"body assignments ignored", `CREATE PROC dbo.p @a int AS
			DECLARE @b int = NULL; SET @a = 1`, map[string]bool{}},
		{"no parameters", `CREATE PROC dbo.p AS DECLARE @a int = NULL`, map[string]bool{}},
		{"quoted names", `CREATE PROC [dbo].[AS] @a [AS], @b [my,type] = NULL AS SELECT 1`,
			map[string]bool{"@b": true}},
		{"unavailable definition", "", map[string]bool{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := declaredDefaults(tt.source); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("defaults = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestBuildBatchOptionalParameters(t *testing.T) {
	defaults := declaredDefaults(`CREATE PROC dbo.p @action varchar(200),
		@session bigint = NULL, @count int = 10, @filter varchar(200) = NULL AS SELECT 1`)
	params := []Param{
		{Name: "@action", Type: "varchar(200)", baseType: "varchar"},
		{Name: "@session", Type: "bigint", baseType: "bigint"},
		{Name: "@count", Type: "int", baseType: "int"},
		{Name: "@filter", Type: "varchar(200)", baseType: "varchar"},
	}
	for i := range params {
		params[i].HasDefault = defaults[params[i].Name]
	}
	for _, explicitDefault := range []bool{false, true} {
		inputs := []ParamInput{{Name: "@action", Value: "BusquedaPacientesAgenda"}}
		if explicitDefault {
			for _, p := range params[1:] {
				inputs = append(inputs, ParamInput{Name: p.Name, UseDefault: true})
			}
		}
		batch, err := buildBatch("dbo", "p", params, inputs)
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range params[1:] {
			if strings.Contains(batch, p.Name) {
				t.Errorf("optional parameter %s must be omitted:\n%s", p.Name, batch)
			}
		}
	}
	// Explicit empty strings and NULL must not be replaced by defaults.
	batch, err := buildBatch("dbo", "p", params, []ParamInput{
		{Name: "@action", Value: "test"},
		{Name: "@session", IsNull: true},
		{Name: "@filter", Value: ""},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(batch, "DECLARE @__p2 bigint = NULL;") ||
		!strings.Contains(batch, "DECLARE @__p4 varchar(200) = N'';") {
		t.Errorf("explicit values not preserved:\n%s", batch)
	}
	if _, err := buildBatch("dbo", "p", params, []ParamInput{{Name: "@session", Value: ""}}); err == nil {
		t.Error("an explicitly empty number must still fail validation")
	}
}
