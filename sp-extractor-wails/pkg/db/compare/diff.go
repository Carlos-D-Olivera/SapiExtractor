package compare

// Row kinds of a side-by-side diff.
const (
	RowEqual   = "eq"
	RowChanged = "chg" // a line replaced by another one
	RowRemoved = "del" // only in the source
	RowAdded   = "add" // only in the target
)

// Row is one line of the side-by-side view. A/B are empty on the side that has no line.
type Row struct {
	Kind  string `json:"kind"`
	ALine int    `json:"aLine"`
	BLine int    `json:"bLine"`
	A     string `json:"a"`
	B     string `json:"b"`
}

// Diff is the line diff between the source (A) and target (B) definitions.
type Diff struct {
	Rows    []Row `json:"rows"`
	Added   int   `json:"added"`   // lines only in the target
	Removed int   `json:"removed"` // lines only in the source
	Changed int   `json:"changed"` // lines replaced
	Same    bool  `json:"same"`
}

// maxCells bounds the LCS table; beyond it the differing middle is shown as a
// full replacement instead of exhausting memory.
const maxCells = 4_000_000

type op struct {
	kind byte // '=', '-', '+'
	a, b int  // indexes into the prepared lines (a for '=' and '-', b for '+')
}

// DiffText diffs two definitions honoring opts. The lines shown are the
// originals; only the equality test uses the normalized keys.
func DiffText(a, b string, opts Options) Diff {
	la, lb := prepare(a, opts), prepare(b, opts)
	ops := lcs(la, lb)

	d := Diff{Rows: []Row{}, Same: true}
	for i := 0; i < len(ops); {
		o := ops[i]
		if o.kind == '=' {
			d.Rows = append(d.Rows, Row{Kind: RowEqual, ALine: la[o.a].num, BLine: lb[o.b].num, A: la[o.a].text, B: lb[o.b].text})
			i++
			continue
		}
		d.Same = false
		// Gather the run of removals and additions and pair them up as changes.
		var dels, adds []op
		for ; i < len(ops) && ops[i].kind != '='; i++ {
			if ops[i].kind == '-' {
				dels = append(dels, ops[i])
			} else {
				adds = append(adds, ops[i])
			}
		}
		n := max(len(dels), len(adds))
		for k := 0; k < n; k++ {
			r := Row{}
			switch {
			case k < len(dels) && k < len(adds):
				r = Row{Kind: RowChanged, ALine: la[dels[k].a].num, BLine: lb[adds[k].b].num, A: la[dels[k].a].text, B: lb[adds[k].b].text}
				d.Changed++
			case k < len(dels):
				r = Row{Kind: RowRemoved, ALine: la[dels[k].a].num, A: la[dels[k].a].text}
				d.Removed++
			default:
				r = Row{Kind: RowAdded, BLine: lb[adds[k].b].num, B: lb[adds[k].b].text}
				d.Added++
			}
			d.Rows = append(d.Rows, r)
		}
	}
	return d
}

// lcs returns the edit script turning a into b (longest common subsequence on keys).
func lcs(a, b []line) []op {
	// Trim the common prefix and suffix: most edits touch a small region.
	pre := 0
	for pre < len(a) && pre < len(b) && a[pre].key == b[pre].key {
		pre++
	}
	suf := 0
	for suf < len(a)-pre && suf < len(b)-pre && a[len(a)-1-suf].key == b[len(b)-1-suf].key {
		suf++
	}
	ops := make([]op, 0, len(a)+len(b))
	for i := 0; i < pre; i++ {
		ops = append(ops, op{'=', i, i})
	}

	ma, mb := a[pre:len(a)-suf], b[pre:len(b)-suf]
	switch {
	case len(ma) == 0:
		for j := range mb {
			ops = append(ops, op{'+', 0, pre + j})
		}
	case len(mb) == 0:
		for i := range ma {
			ops = append(ops, op{'-', pre + i, 0})
		}
	case len(ma)*len(mb) > maxCells:
		for i := range ma {
			ops = append(ops, op{'-', pre + i, 0})
		}
		for j := range mb {
			ops = append(ops, op{'+', 0, pre + j})
		}
	default:
		// t[i][j] = LCS length of ma[i:] and mb[j:]
		w := len(mb) + 1
		t := make([]int32, (len(ma)+1)*w)
		for i := len(ma) - 1; i >= 0; i-- {
			for j := len(mb) - 1; j >= 0; j-- {
				if ma[i].key == mb[j].key {
					t[i*w+j] = t[(i+1)*w+j+1] + 1
				} else {
					t[i*w+j] = max(t[(i+1)*w+j], t[i*w+j+1])
				}
			}
		}
		i, j := 0, 0
		for i < len(ma) && j < len(mb) {
			switch {
			case ma[i].key == mb[j].key:
				ops = append(ops, op{'=', pre + i, pre + j})
				i++
				j++
			case t[(i+1)*w+j] >= t[i*w+j+1]:
				ops = append(ops, op{'-', pre + i, 0})
				i++
			default:
				ops = append(ops, op{'+', 0, pre + j})
				j++
			}
		}
		for ; i < len(ma); i++ {
			ops = append(ops, op{'-', pre + i, 0})
		}
		for ; j < len(mb); j++ {
			ops = append(ops, op{'+', 0, pre + j})
		}
	}

	for k := 0; k < suf; k++ {
		ops = append(ops, op{'=', len(a) - suf + k, len(b) - suf + k})
	}
	return ops
}
