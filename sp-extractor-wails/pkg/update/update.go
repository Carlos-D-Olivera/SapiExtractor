// Package update checks GitHub Releases for a newer version of the app,
// downloads it, verifies its SHA-256 and swaps the running executable.
//
// Windows cannot overwrite a running .exe but can rename it, so the swap is:
// current -> current.old, downloaded -> current. The caller then starts the new
// executable and quits; the leftover .old is removed on the next start.
package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Defaults for this project's releases.
const (
	DefaultRepo      = "Carlos-D-Olivera/SapiExtractor"
	DefaultAPIBase   = "https://api.github.com"
	DefaultAsset     = "SapiExtractor.exe"
	maxAssetBytes    = 500 << 20
	maxMetadataBytes = 1 << 20
)

// ------------------------------------------------------------------- versions

// Version is a MAJOR.MINOR.PATCH number.
type Version struct{ Major, Minor, Patch int }

var versionRe = regexp.MustCompile(`^\s*[vV]?\.?\s*(\d+)\.(\d+)(?:\.(\d+))?`)

// ParseVersion accepts "2.6.0", "v2.6.0", "V2.6.0" and this project's "V.2.6.0".
// Anything after the numbers (e.g. "-beta.1") is ignored.
func ParseVersion(s string) (Version, bool) {
	m := versionRe.FindStringSubmatch(s)
	if m == nil {
		return Version{}, false
	}
	n := func(x string) int { v, _ := strconv.Atoi(x); return v }
	return Version{n(m[1]), n(m[2]), n(m[3])}, true
}

// Less reports whether v is older than o.
func (v Version) Less(o Version) bool {
	if v.Major != o.Major {
		return v.Major < o.Major
	}
	if v.Minor != o.Minor {
		return v.Minor < o.Minor
	}
	return v.Patch < o.Patch
}

func (v Version) String() string { return fmt.Sprintf("%d.%d.%d", v.Major, v.Minor, v.Patch) }

// --------------------------------------------------------------------- client

// Client talks to the GitHub API. The zero value is not usable; use NewClient.
type Client struct {
	HTTP         *http.Client
	APIBase      string
	Repo         string
	AssetName    string // executable asset to install
	MinAssetSize int64  // sanity floor; a download smaller than this is rejected

	allowAnyURL bool // tests only: skip the GitHub host check
}

// NewClient returns a client for this project's GitHub releases.
func NewClient() *Client {
	c := &Client{
		APIBase:      DefaultAPIBase,
		Repo:         DefaultRepo,
		AssetName:    DefaultAsset,
		MinAssetSize: 1 << 20,
	}
	// No overall timeout (downloads can be long; callers pass a context), but every
	// redirect hop must still be HTTPS on a GitHub host.
	c.HTTP = &http.Client{CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return errors.New("demasiadas redirecciones")
		}
		return c.checkURL(req.URL.String())
	}}
	return c
}

// Info describes the newest published release relative to the running version.
type Info struct {
	Available      bool   `json:"available"`
	Current        string `json:"current"`
	Latest         string `json:"latest"` // 2.7.0
	Tag            string `json:"tag"`
	Name           string `json:"name"`
	Notes          string `json:"notes"`
	PageURL        string `json:"pageUrl"`
	PublishedAt    string `json:"publishedAt"`
	AssetName      string `json:"assetName"`
	AssetURL       string `json:"assetUrl"`
	AssetSize      int64  `json:"assetSize"`
	SumsURL        string `json:"sumsUrl"`
	CanAutoInstall bool   `json:"canAutoInstall"`
	Reason         string `json:"reason"` // why it cannot be installed automatically
}

type ghRelease struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	Body        string `json:"body"`
	HTMLURL     string `json:"html_url"`
	PublishedAt string `json:"published_at"`
	Draft       bool   `json:"draft"`
	Prerelease  bool   `json:"prerelease"`
	Assets      []struct {
		Name string `json:"name"`
		Size int64  `json:"size"`
		URL  string `json:"browser_download_url"`
	} `json:"assets"`
}

func (c *Client) get(ctx context.Context, rawURL string) (*http.Response, error) {
	if err := c.checkURL(rawURL); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "SapiExtractor-updater")
	req.Header.Set("Accept", "application/vnd.github+json, application/octet-stream")
	return c.HTTP.Do(req)
}

// checkURL only lets the updater talk HTTPS to GitHub.
func (c *Client) checkURL(raw string) error {
	if c.allowAnyURL {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" {
		return fmt.Errorf("dirección de descarga no permitida: %q", raw)
	}
	host := strings.ToLower(u.Hostname())
	if host == "github.com" || strings.HasSuffix(host, ".github.com") || strings.HasSuffix(host, ".githubusercontent.com") {
		return nil
	}
	return fmt.Errorf("servidor de descarga no permitido: %q", host)
}

// Check asks GitHub for the latest published (non-draft, non-prerelease)
// release and compares it with current. current "dev" is never "outdated".
func (c *Client) Check(ctx context.Context, current string) (Info, error) {
	info := Info{Current: current}
	resp, err := c.get(ctx, fmt.Sprintf("%s/repos/%s/releases/latest", strings.TrimRight(c.APIBase, "/"), c.Repo))
	if err != nil {
		return info, fmt.Errorf("no se pudo consultar GitHub: %w", err)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return info, errors.New("todavía no hay versiones publicadas en GitHub")
	case resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests:
		return info, errors.New("GitHub limitó las consultas; inténtalo de nuevo en unos minutos")
	case resp.StatusCode != http.StatusOK:
		return info, fmt.Errorf("GitHub respondió %s", resp.Status)
	}
	var rel ghRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxMetadataBytes)).Decode(&rel); err != nil {
		return info, fmt.Errorf("respuesta de GitHub no válida: %w", err)
	}

	latest, ok := ParseVersion(rel.TagName)
	if !ok {
		return info, fmt.Errorf("la etiqueta %q no es un número de versión", rel.TagName)
	}
	info.Latest, info.Tag, info.Name, info.Notes = latest.String(), rel.TagName, rel.Name, rel.Body
	info.PageURL, info.PublishedAt = rel.HTMLURL, rel.PublishedAt

	cur, curOK := ParseVersion(current)
	info.Available = curOK && cur.Less(latest) && !rel.Draft && !rel.Prerelease

	for _, a := range rel.Assets {
		switch {
		case strings.EqualFold(a.Name, c.AssetName):
			info.AssetName, info.AssetURL, info.AssetSize = a.Name, a.URL, a.Size
		case isSumsAsset(a.Name):
			info.SumsURL = a.URL
		}
	}
	switch {
	case info.AssetURL == "":
		info.Reason = fmt.Sprintf("la versión no incluye el archivo %s", c.AssetName)
	case info.SumsURL == "":
		info.Reason = "la versión no incluye el archivo SHA256SUMS para verificar la descarga"
	default:
		info.CanAutoInstall = true
	}
	return info, nil
}

func isSumsAsset(name string) bool {
	switch strings.ToLower(name) {
	case "sha256sums", "sha256sums.txt", "checksums.txt", "checksums.sha256":
		return true
	}
	return false
}

// ------------------------------------------------------------------- download

// ParseSums reads "<hash>  <file>" lines (the sha256sum format; a leading "*"
// before the file name marks binary mode).
func ParseSums(text string) map[string]string {
	out := map[string]string{}
	for _, line := range strings.Split(text, "\n") {
		f := strings.Fields(strings.TrimSpace(line))
		if len(f) < 2 || len(f[0]) != 64 {
			continue
		}
		out[strings.TrimPrefix(f[1], "*")] = strings.ToLower(f[0])
	}
	return out
}

// FetchSums downloads and parses a checksums file.
func (c *Client) FetchSums(ctx context.Context, sumsURL string) (map[string]string, error) {
	resp, err := c.get(ctx, sumsURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("no se pudo descargar SHA256SUMS: %s", resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxMetadataBytes))
	if err != nil {
		return nil, err
	}
	return ParseSums(string(data)), nil
}

// Download saves url to dest, reporting progress. A partial file is removed on failure.
func (c *Client) Download(ctx context.Context, rawURL, dest string, progress func(done, total int64)) (err error) {
	resp, err := c.get(ctx, rawURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("la descarga falló: %s", resp.Status)
	}
	total := resp.ContentLength
	if total > maxAssetBytes {
		return fmt.Errorf("el archivo es demasiado grande (%d MB)", total>>20)
	}

	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer func() {
		if cerr := f.Close(); err == nil {
			err = cerr
		}
		if err != nil {
			_ = os.Remove(dest)
		}
	}()

	buf := make([]byte, 128<<10)
	var done int64
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				return werr
			}
			done += int64(n)
			if done > maxAssetBytes {
				return errors.New("el archivo descargado excede el tamaño máximo permitido")
			}
			if progress != nil {
				progress(done, total)
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return rerr
		}
	}
	if total > 0 && done != total {
		return fmt.Errorf("descarga incompleta (%d de %d bytes)", done, total)
	}
	return nil
}

// VerifyFile checks the SHA-256 of path against want (hex).
func VerifyFile(path, want string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	if got := hex.EncodeToString(h.Sum(nil)); !strings.EqualFold(got, want) {
		return fmt.Errorf("la suma SHA-256 no coincide (esperada %s…, obtenida %s…)", short(want), short(got))
	}
	return nil
}

func short(s string) string {
	if len(s) > 12 {
		return s[:12]
	}
	return s
}

// ---------------------------------------------------------------------- apply

// ErrNotWritable means the executable's folder cannot be written (e.g. Program Files).
var ErrNotWritable = errors.New("no hay permiso para escribir en la carpeta donde está instalado el programa")

// CanWriteDir reports whether files can be created in dir.
func CanWriteDir(dir string) error {
	f, err := os.CreateTemp(dir, ".spx-write-test-*")
	if err != nil {
		return fmt.Errorf("%w (%s)", ErrNotWritable, dir)
	}
	name := f.Name()
	f.Close()
	return os.Remove(name)
}

// ReplaceExecutable swaps newPath in for exePath, keeping the old file as
// exePath+".old". If the second rename fails the original is put back.
func ReplaceExecutable(exePath, newPath string) error {
	old := exePath + ".old"
	_ = os.Remove(old)
	if err := os.Rename(exePath, old); err != nil {
		return fmt.Errorf("no se pudo apartar el ejecutable actual: %w", err)
	}
	if err := os.Rename(newPath, exePath); err != nil {
		if rerr := os.Rename(old, exePath); rerr != nil {
			return fmt.Errorf("no se pudo instalar la nueva versión (%v) ni restaurar la anterior (%v)", err, rerr)
		}
		return fmt.Errorf("no se pudo instalar la nueva versión: %w", err)
	}
	return nil
}

// CleanupLeftovers removes the files a previous update left next to exePath.
// The old executable may still be locked for a moment after a restart, so it retries.
func CleanupLeftovers(exePath string) {
	for _, p := range []string{exePath + ".new", exePath + ".old"} {
		for i := 0; i < 10; i++ {
			err := os.Remove(p)
			if err == nil || errors.Is(err, os.ErrNotExist) {
				break
			}
			time.Sleep(500 * time.Millisecond)
		}
	}
}

// Progress reports the phases of Install.
type Progress func(phase string, done, total int64)

// Install downloads info's asset next to exePath, verifies it against the
// release's SHA256SUMS and swaps it in. The caller restarts the app afterwards.
func (c *Client) Install(ctx context.Context, info Info, exePath string, progress Progress) error {
	if !info.CanAutoInstall {
		if info.Reason != "" {
			return fmt.Errorf("no se puede instalar automáticamente: %s", info.Reason)
		}
		return errors.New("no se puede instalar automáticamente")
	}
	emit := func(phase string, done, total int64) {
		if progress != nil {
			progress(phase, done, total)
		}
	}

	dir := filepath.Dir(exePath)
	if err := CanWriteDir(dir); err != nil {
		return err
	}

	emit("verify", 0, 0)
	sums, err := c.FetchSums(ctx, info.SumsURL)
	if err != nil {
		return err
	}
	want, ok := sums[info.AssetName]
	if !ok {
		return fmt.Errorf("SHA256SUMS no incluye %s: no se puede verificar la descarga", info.AssetName)
	}

	newPath := exePath + ".new"
	if err := c.Download(ctx, info.AssetURL, newPath, func(done, total int64) { emit("download", done, total) }); err != nil {
		return err
	}

	emit("verify", 0, 0)
	if err := VerifyFile(newPath, want); err != nil {
		_ = os.Remove(newPath)
		return err
	}
	if st, err := os.Stat(newPath); err != nil || st.Size() < c.MinAssetSize {
		_ = os.Remove(newPath)
		return errors.New("el archivo descargado es demasiado pequeño para ser el programa")
	}

	emit("install", 0, 0)
	return ReplaceExecutable(exePath, newPath)
}
