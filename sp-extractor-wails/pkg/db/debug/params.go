// Package debug runs a SQL Server stored procedure and reports what it did:
// every statement executed (with line, duration and rows), nested procedures,
// triggers and dynamic SQL, the branch taken by IF/WHILE conditions, result
// sets, PRINT messages and output parameters.
//
// Statement-level visibility comes from an Extended Events session filtered to
// the session that runs the procedure. It is tracing, not step-by-step
// debugging: variable values are not available.
package debug

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"sp-extractor-wails/pkg/db/extractors"
)

// Param describes one parameter of a stored procedure.
type Param struct {
	Name        string `json:"name"` // including the leading @
	Type        string `json:"type"` // e.g. nvarchar(50)
	IsOutput    bool   `json:"isOutput"`
	HasDefault  bool   `json:"hasDefault"`
	Unsupported bool   `json:"unsupported"` // table-valued / cursor parameters cannot be supplied here

	baseType string
}

// ParamInput is the value the user typed for one parameter.
type ParamInput struct {
	Name       string `json:"name"`
	Value      string `json:"value"`
	IsNull     bool   `json:"isNull"`
	UseDefault bool   `json:"useDefault"` // omit the parameter so the procedure's default applies
}

// ListParams reads the parameters of schema.name in declaration order.
func ListParams(ctx context.Context, conn *sql.DB, schema, name string) ([]Param, error) {
	rows, err := conn.QueryContext(ctx, `SELECT p.name, tp.name, p.max_length, p.precision, p.scale,
	        p.is_output, p.has_default_value, tp.is_table_type, p.is_cursor_ref
	 FROM sys.parameters p
	 INNER JOIN sys.types tp ON p.user_type_id = tp.user_type_id
	 WHERE p.object_id = OBJECT_ID(QUOTENAME(@p1) + N'.' + QUOTENAME(@p2)) AND p.parameter_id > 0
	 ORDER BY p.parameter_id`, schema, name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Param
	for rows.Next() {
		var p Param
		var maxLen, prec, scale int
		var tableType, cursorRef bool
		if err := rows.Scan(&p.Name, &p.baseType, &maxLen, &prec, &scale, &p.IsOutput, &p.HasDefault, &tableType, &cursorRef); err != nil {
			return nil, fmt.Errorf("scan parameter: %w", err)
		}
		p.Type = extractors.FormatSQLType(p.baseType, maxLen, prec, scale)
		p.Unsupported = tableType || cursorRef
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	// SQL Server only maintains has_default_value for CLR procedures.
	// T-SQL defaults must be read from the module's declaration.
	var definition sql.NullString
	if err := conn.QueryRowContext(ctx, `SELECT OBJECT_DEFINITION(OBJECT_ID(QUOTENAME(@p1) + N'.' + QUOTENAME(@p2)))`, schema, name).Scan(&definition); err != nil {
		return nil, fmt.Errorf("read procedure defaults: %w", err)
	}
	defaults := declaredDefaults(definition.String)
	for i := range out {
		out[i].HasDefault = out[i].HasDefault || defaults[strings.ToLower(out[i].Name)]
	}
	return out, nil
}

// declaredDefaults inspects only the parameter header, never assignments in the
// body. Comments, quoted identifiers and literals cannot introduce delimiters.
func declaredDefaults(definition string) map[string]bool {
	tokens := declarationTokens(definition)
	defaults := map[string]bool{}
	inProc := false
	param := ""
	depth := 0
	for _, token := range tokens {
		lower := strings.ToLower(token)
		if !inProc {
			inProc = lower == "proc" || lower == "procedure"
			continue
		}
		if depth == 0 {
			switch lower {
			case "as", "with", "for":
				return defaults
			case ",":
				param = ""
			case "=":
				if param != "" {
					defaults[param] = true
				}
			}
			if strings.HasPrefix(token, "@") && param == "" {
				param = lower
			}
		}
		switch token {
		case "(":
			depth++
		case ")":
			depth--
		}
	}
	return defaults
}

func declarationTokens(text string) []string {
	r := []rune(text)
	var tokens []string
	for i := 0; i < len(r); {
		switch {
		case unicode.IsSpace(r[i]):
			i++
		case r[i] == '-' && i+1 < len(r) && r[i+1] == '-':
			for i < len(r) && r[i] != '\n' {
				i++
			}
		case r[i] == '/' && i+1 < len(r) && r[i+1] == '*':
			i += 2
			for depth := 1; i < len(r) && depth > 0; {
				if i+1 < len(r) && r[i] == '/' && r[i+1] == '*' {
					depth++
					i += 2
				} else if i+1 < len(r) && r[i] == '*' && r[i+1] == '/' {
					depth--
					i += 2
				} else {
					i++
				}
			}
		case r[i] == '\'' || r[i] == '"' || r[i] == '[':
			start, end := i, r[i]
			if end == '[' {
				end = ']'
			}
			i++
			for i < len(r) {
				if r[i] != end {
					i++
				} else if i+1 < len(r) && r[i+1] == end {
					i += 2
				} else {
					i++
					break
				}
			}
			tokens = append(tokens, string(r[start:i]))
		case unicode.IsLetter(r[i]) || unicode.IsDigit(r[i]) || strings.ContainsRune("@_#$", r[i]):
			start := i
			for i < len(r) && (unicode.IsLetter(r[i]) || unicode.IsDigit(r[i]) || strings.ContainsRune("@_#$", r[i])) {
				i++
			}
			tokens = append(tokens, string(r[start:i]))
		default:
			tokens = append(tokens, string(r[i]))
			i++
		}
	}
	return tokens
}

func quoteIdent(s string) string { return "[" + strings.ReplaceAll(s, "]", "]]") + "]" }

var (
	numberRe = regexp.MustCompile(`^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$`)
	hexRe    = regexp.MustCompile(`^0[xX][0-9a-fA-F]*$`)
)

// literal renders the value typed by the user as a T-SQL literal for p.
func literal(p Param, in ParamInput) (string, error) {
	if in.IsNull {
		return "NULL", nil
	}
	v := strings.TrimSpace(in.Value)
	switch strings.ToLower(p.baseType) {
	case "int", "bigint", "smallint", "tinyint", "decimal", "numeric", "float", "real", "money", "smallmoney":
		if !numberRe.MatchString(v) {
			return "", fmt.Errorf("el valor de %s no es un número válido (%s): %q", p.Name, p.Type, in.Value)
		}
		return v, nil
	case "bit":
		b := strings.ToLower(strings.TrimRight(strings.TrimSpace(v), ";"))
		b = strings.TrimSpace(strings.Trim(strings.TrimPrefix(b, "n"), "'\""))
		switch b {
		case "true", "t", "verdadero", "si", "sí", "yes", "y":
			return "1", nil
		case "false", "f", "falso", "no", "n":
			return "0", nil
		}
		if numberRe.MatchString(b) {
			if f, err := strconv.ParseFloat(b, 64); err == nil {
				if f != 0 {
					return "1", nil
				}
				return "0", nil
			}
		}
		return "", fmt.Errorf("el valor de %s debe ser 0/1 o true/false: %q", p.Name, in.Value)
	case "binary", "varbinary", "image":
		if !hexRe.MatchString(v) {
			return "", fmt.Errorf("el valor de %s debe ser hexadecimal (0x…): %q", p.Name, in.Value)
		}
		return v, nil
	}
	return "N'" + strings.ReplaceAll(in.Value, "'", "''") + "'", nil
}

// buildBatch creates the T-SQL that declares the parameters, calls the
// procedure and selects its return value and output parameters.
func buildBatch(schema, name string, params []Param, inputs []ParamInput) (string, error) {
	byName := map[string]ParamInput{}
	for _, in := range inputs {
		byName[strings.ToLower(in.Name)] = in
	}

	var decl, args, outs []string
	for i, p := range params {
		in, given := byName[strings.ToLower(p.Name)]
		if p.Unsupported {
			continue
		}
		if !given {
			if p.HasDefault {
				in = ParamInput{Name: p.Name, UseDefault: true}
			} else {
				in = ParamInput{Name: p.Name, IsNull: true}
			}
		}
		if in.UseDefault && p.HasDefault {
			continue
		}
		lit, err := literal(p, in)
		if err != nil {
			return "", err
		}
		v := fmt.Sprintf("@__p%d", i+1)
		decl = append(decl, fmt.Sprintf("DECLARE %s %s = %s;", v, p.Type, lit))
		arg := fmt.Sprintf("%s = %s", p.Name, v)
		if p.IsOutput {
			arg += " OUTPUT"
			outs = append(outs, fmt.Sprintf("%s AS %s", v, quoteIdent(p.Name)))
		}
		args = append(args, arg)
	}

	var b strings.Builder
	for _, d := range decl {
		b.WriteString(d + "\n")
	}
	b.WriteString("DECLARE @__rc INT;\n")
	b.WriteString(fmt.Sprintf("EXEC @__rc = %s.%s", quoteIdent(schema), quoteIdent(name)))
	if len(args) > 0 {
		b.WriteString(" " + strings.Join(args, ", "))
	}
	b.WriteString(";\n")
	b.WriteString("SELECT @__rc AS " + quoteIdent(returnValueColumn))
	for _, o := range outs {
		b.WriteString(", " + o)
	}
	b.WriteString(";")
	return b.String(), nil
}

// returnValueColumn marks the final result set that carries the return value
// and output parameters, so it can be told apart from the procedure's own results.
const returnValueColumn = "@RETURN_VALUE"
