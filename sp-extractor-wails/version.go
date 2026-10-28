package main

import (
	_ "embed"
	"encoding/json"

	"sp-extractor-wails/pkg/update"
)

// wailsConfig is the project's wails.json, embedded so a plain local build knows
// its own version (info.productVersion) without any build flag.
//
//go:embed wails.json
var wailsConfig []byte

// version can be forced at build time (the release workflow sets it from the tag):
//
//	wails build -ldflags "-X main.version=2.7.1"
//
// When empty, the version comes from the embedded wails.json.
var version = ""

// appVersion is the running version: "dev" while running under `wails dev`,
// otherwise the injected version, otherwise wails.json's productVersion.
func appVersion() string {
	if devBuild {
		return "dev"
	}
	if version != "" {
		return version
	}
	return versionFromConfig(wailsConfig)
}

// versionFromConfig reads info.productVersion from wails.json content. It
// returns "dev" when the file or the number is unusable, so the app never
// claims a version it cannot vouch for.
func versionFromConfig(data []byte) string {
	var cfg struct {
		Info struct {
			ProductVersion string `json:"productVersion"`
		} `json:"info"`
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return "dev"
	}
	v, ok := update.ParseVersion(cfg.Info.ProductVersion)
	if !ok {
		return "dev"
	}
	return v.String()
}
