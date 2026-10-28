package main

import (
	"testing"

	"sp-extractor-wails/pkg/update"
)

func TestVersionFromConfig(t *testing.T) {
	cases := map[string]string{
		`{"info":{"productVersion":"2.7.0"}}`:   "2.7.0",
		`{"info":{"productVersion":"V.2.7.1"}}`: "2.7.1",
		`{"info":{"productVersion":""}}`:        "dev",
		`{"info":{}}`:                           "dev",
		`not json`:                              "dev",
	}
	for in, want := range cases {
		if got := versionFromConfig([]byte(in)); got != want {
			t.Errorf("versionFromConfig(%s) = %q, want %q", in, got, want)
		}
	}
}

// The release pipeline reads this same field, so it must always be a usable
// version number; otherwise a local build would claim to be "dev".
func TestEmbeddedWailsJSONHasAValidVersion(t *testing.T) {
	v := versionFromConfig(wailsConfig)
	if v == "dev" {
		t.Fatal("wails.json info.productVersion is missing or not a version number")
	}
	if _, ok := update.ParseVersion(v); !ok {
		t.Errorf("%q does not parse", v)
	}
}

func TestInjectedVersionWins(t *testing.T) {
	prev := version
	t.Cleanup(func() { version = prev })
	version = "9.9.9"
	if devBuild {
		t.Skip("dev builds always report dev")
	}
	if got := appVersion(); got != "9.9.9" {
		t.Errorf("appVersion() = %q, want the injected 9.9.9", got)
	}
	version = ""
	if got := appVersion(); got != versionFromConfig(wailsConfig) {
		t.Errorf("without injection appVersion() = %q, want the wails.json version", got)
	}
}
