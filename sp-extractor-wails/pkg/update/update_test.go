package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseVersion(t *testing.T) {
	cases := map[string]struct {
		want Version
		ok   bool
	}{
		"2.6.0":      {Version{2, 6, 0}, true},
		"V.2.6.0":    {Version{2, 6, 0}, true},
		"v2.7.1":     {Version{2, 7, 1}, true},
		"V2.10.3":    {Version{2, 10, 3}, true},
		"2.6":        {Version{2, 6, 0}, true},
		"3.0.0-beta": {Version{3, 0, 0}, true},
		"dev":        {Version{}, false},
		"":           {Version{}, false},
		"release":    {Version{}, false},
	}
	for in, c := range cases {
		got, ok := ParseVersion(in)
		if ok != c.ok || (ok && got != c.want) {
			t.Errorf("ParseVersion(%q) = %v, %v; want %v, %v", in, got, ok, c.want, c.ok)
		}
	}
	a, _ := ParseVersion("2.9.0")
	b, _ := ParseVersion("2.10.0")
	if !a.Less(b) || b.Less(a) || a.Less(a) {
		t.Error("2.9.0 must be older than 2.10.0 (numeric, not text, comparison)")
	}
}

func TestParseSums(t *testing.T) {
	h := strings.Repeat("a", 64)
	got := ParseSums(h + "  SapiExtractor.exe\n" + strings.ToUpper(h) + " *other.zip\nnot a hash line\nshort  x\n")
	if got["SapiExtractor.exe"] != h || got["other.zip"] != h || len(got) != 2 {
		t.Errorf("ParseSums = %v", got)
	}
}

// release serves the GitHub API and the assets from one test server.
type release struct {
	tag        string
	exe        []byte
	withSums   bool
	badSum     bool
	prerelease bool
}

func serve(t *testing.T, r release) (*Client, *httptest.Server) {
	t.Helper()
	sum := sha256.Sum256(r.exe)
	hash := hex.EncodeToString(sum[:])
	if r.badSum {
		hash = strings.Repeat("0", 64)
	}
	mux := http.NewServeMux()
	var srv *httptest.Server
	mux.HandleFunc("/repos/o/r/releases/latest", func(w http.ResponseWriter, req *http.Request) {
		if req.Header.Get("User-Agent") == "" {
			http.Error(w, "User-Agent required", 403)
			return
		}
		assets := fmt.Sprintf(`{"name":"SapiExtractor.exe","size":%d,"browser_download_url":"%s/dl/exe"}`, len(r.exe), srv.URL)
		if r.withSums {
			assets += fmt.Sprintf(`,{"name":"SHA256SUMS","size":100,"browser_download_url":"%s/dl/sums"}`, srv.URL)
		}
		fmt.Fprintf(w, `{"tag_name":%q,"name":"Versión","body":"- mejora uno\n- mejora dos","html_url":"https://github.com/o/r/releases/tag/%s","prerelease":%v,"assets":[%s]}`,
			r.tag, r.tag, r.prerelease, assets)
	})
	mux.HandleFunc("/dl/exe", func(w http.ResponseWriter, _ *http.Request) { w.Write(r.exe) })
	mux.HandleFunc("/dl/sums", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintf(w, "%s  SapiExtractor.exe\n", hash)
	})
	srv = httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	c := &Client{HTTP: srv.Client(), APIBase: srv.URL, Repo: "o/r", AssetName: "SapiExtractor.exe", MinAssetSize: 10, allowAnyURL: true}
	return c, srv
}

func TestCheck(t *testing.T) {
	exe := []byte("MZ" + strings.Repeat("x", 100))
	c, _ := serve(t, release{tag: "V.2.7.0", exe: exe, withSums: true})
	ctx := context.Background()

	info, err := c.Check(ctx, "2.6.0")
	if err != nil {
		t.Fatal(err)
	}
	if !info.Available || info.Latest != "2.7.0" || info.Tag != "V.2.7.0" || !info.CanAutoInstall || info.AssetSize != int64(len(exe)) {
		t.Errorf("newer release: %+v", info)
	}
	if !strings.Contains(info.Notes, "mejora dos") {
		t.Errorf("notes missing: %q", info.Notes)
	}

	if info, _ := c.Check(ctx, "2.7.0"); info.Available {
		t.Error("the same version is not an update")
	}
	if info, _ := c.Check(ctx, "2.8.0"); info.Available {
		t.Error("an older release is not an update")
	}
	if info, _ := c.Check(ctx, "dev"); info.Available {
		t.Error("a development build must not be offered updates")
	}
}

func TestCheckWithoutAssetsOrSums(t *testing.T) {
	c, _ := serve(t, release{tag: "v3.0.0", exe: []byte("x"), withSums: false})
	info, err := c.Check(context.Background(), "2.6.0")
	if err != nil {
		t.Fatal(err)
	}
	if !info.Available || info.CanAutoInstall || !strings.Contains(info.Reason, "SHA256SUMS") {
		t.Errorf("without checksums the update must not be auto-installable: %+v", info)
	}
	c.AssetName = "Otro.exe"
	info, _ = c.Check(context.Background(), "2.6.0")
	if info.CanAutoInstall || !strings.Contains(info.Reason, "Otro.exe") {
		t.Errorf("missing asset: %+v", info)
	}
}

func TestCheckPrereleaseIsNotOffered(t *testing.T) {
	c, _ := serve(t, release{tag: "v3.0.0", exe: []byte("x"), withSums: true, prerelease: true})
	if info, _ := c.Check(context.Background(), "2.6.0"); info.Available {
		t.Error("a pre-release must not be offered")
	}
}

func TestCheckErrors(t *testing.T) {
	notFound := httptest.NewServer(http.NotFoundHandler())
	defer notFound.Close()
	c := &Client{HTTP: notFound.Client(), APIBase: notFound.URL, Repo: "o/r", allowAnyURL: true}
	if _, err := c.Check(context.Background(), "1.0.0"); err == nil || !strings.Contains(err.Error(), "publicadas") {
		t.Errorf("404: %v", err)
	}
	limited := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(403) }))
	defer limited.Close()
	c = &Client{HTTP: limited.Client(), APIBase: limited.URL, Repo: "o/r", allowAnyURL: true}
	if _, err := c.Check(context.Background(), "1.0.0"); err == nil || !strings.Contains(err.Error(), "limitó") {
		t.Errorf("403: %v", err)
	}
}

func TestURLCheck(t *testing.T) {
	c := NewClient()
	for raw, ok := range map[string]bool{
		"https://github.com/o/r/releases/download/v1/x.exe":         true,
		"https://api.github.com/repos/o/r/releases/latest":          true,
		"https://objects.githubusercontent.com/github-production/x": true,
		"http://github.com/o/r/x.exe":                               false,
		"https://evil.example.com/x.exe":                            false,
		"https://github.com.evil.example.com/x.exe":                 false,
		"https://notgithub.com/x.exe":                               false,
		"file:///c:/windows/system32/cmd.exe":                       false,
	} {
		if err := c.checkURL(raw); (err == nil) != ok {
			t.Errorf("checkURL(%q) = %v, want ok=%v", raw, err, ok)
		}
	}
}

func TestInstallEndToEnd(t *testing.T) {
	newExe := []byte("MZ" + strings.Repeat("N", 200))
	c, _ := serve(t, release{tag: "V.2.7.0", exe: newExe, withSums: true})
	dir := t.TempDir()
	exe := filepath.Join(dir, "SapiExtractor.exe")
	if err := os.WriteFile(exe, []byte("OLD-VERSION"), 0o755); err != nil {
		t.Fatal(err)
	}

	info, err := c.Check(context.Background(), "2.6.0")
	if err != nil {
		t.Fatal(err)
	}
	var phases []string
	var lastDone int64
	err = c.Install(context.Background(), info, exe, func(phase string, done, total int64) {
		if len(phases) == 0 || phases[len(phases)-1] != phase {
			phases = append(phases, phase)
		}
		if phase == "download" {
			lastDone = done
		}
	})
	if err != nil {
		t.Fatal(err)
	}

	got, _ := os.ReadFile(exe)
	if string(got) != string(newExe) {
		t.Error("the executable was not replaced")
	}
	if old, _ := os.ReadFile(exe + ".old"); string(old) != "OLD-VERSION" {
		t.Error("the previous executable must be kept as .old")
	}
	if _, err := os.Stat(exe + ".new"); !os.IsNotExist(err) {
		t.Error("the downloaded .new file must be gone after the swap")
	}
	if strings.Join(phases, ",") != "verify,download,verify,install" || lastDone != int64(len(newExe)) {
		t.Errorf("phases = %v, downloaded %d bytes", phases, lastDone)
	}

	CleanupLeftovers(exe)
	if _, err := os.Stat(exe + ".old"); !os.IsNotExist(err) {
		t.Error("CleanupLeftovers must delete .old")
	}
}

func TestInstallRejectsChecksumMismatch(t *testing.T) {
	c, _ := serve(t, release{tag: "V.2.7.0", exe: []byte("MZ" + strings.Repeat("N", 200)), withSums: true, badSum: true})
	dir := t.TempDir()
	exe := filepath.Join(dir, "SapiExtractor.exe")
	os.WriteFile(exe, []byte("OLD-VERSION"), 0o755)

	info, _ := c.Check(context.Background(), "2.6.0")
	err := c.Install(context.Background(), info, exe, nil)
	if err == nil || !strings.Contains(err.Error(), "SHA-256") {
		t.Fatalf("a tampered download must be rejected: %v", err)
	}
	if got, _ := os.ReadFile(exe); string(got) != "OLD-VERSION" {
		t.Error("the current executable must be untouched")
	}
	if _, err := os.Stat(exe + ".new"); !os.IsNotExist(err) {
		t.Error("the rejected download must be deleted")
	}
}

func TestInstallRejectsTooSmallFile(t *testing.T) {
	c, _ := serve(t, release{tag: "V.2.7.0", exe: []byte("tiny"), withSums: true})
	c.MinAssetSize = 1000
	dir := t.TempDir()
	exe := filepath.Join(dir, "SapiExtractor.exe")
	os.WriteFile(exe, []byte("OLD"), 0o755)
	info, _ := c.Check(context.Background(), "2.6.0")
	if err := c.Install(context.Background(), info, exe, nil); err == nil {
		t.Error("an implausibly small executable must be rejected")
	}
	if got, _ := os.ReadFile(exe); string(got) != "OLD" {
		t.Error("the current executable must be untouched")
	}
}

func TestInstallWithoutSumsIsRefused(t *testing.T) {
	c, _ := serve(t, release{tag: "V.2.7.0", exe: []byte("MZ" + strings.Repeat("N", 200)), withSums: false})
	info, _ := c.Check(context.Background(), "2.6.0")
	if err := c.Install(context.Background(), info, filepath.Join(t.TempDir(), "x.exe"), nil); err == nil {
		t.Error("without a checksums file nothing may be installed")
	}
}

func TestReplaceExecutableRollsBack(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "app.exe")
	os.WriteFile(exe, []byte("OLD"), 0o755)
	// The new file does not exist: the second rename fails and the original must come back.
	if err := ReplaceExecutable(exe, filepath.Join(dir, "missing.new")); err == nil {
		t.Fatal("expected an error")
	}
	if got, _ := os.ReadFile(exe); string(got) != "OLD" {
		t.Error("the original executable must be restored")
	}
}

func TestCanWriteDir(t *testing.T) {
	if err := CanWriteDir(t.TempDir()); err != nil {
		t.Errorf("a temp dir is writable: %v", err)
	}
	if err := CanWriteDir(filepath.Join(t.TempDir(), "does", "not", "exist")); err == nil {
		t.Error("a missing dir is not writable")
	}
}
