package main

import (
	"context"
	"fmt"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"sp-extractor-wails/pkg/update"
)

// version is the running release. Release builds set it from the tag:
//
//	wails build -ldflags "-X main.version=2.7.0"
//
// A plain local build stays "dev" and is never offered updates.
var version = "dev"

// GetAppVersion returns the running version ("dev" for local builds).
func (a *App) GetAppVersion() string { return version }

// CheckForUpdate asks GitHub whether a newer release exists.
func (a *App) CheckForUpdate() (update.Info, error) {
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	defer cancel()
	return update.NewClient().Check(ctx, version)
}

var installing atomic.Bool

// InstallUpdate downloads the newest release, verifies it, replaces the running
// executable, starts the new one and quits. Progress is reported through the
// "update:progress" event ({phase, done, total}).
func (a *App) InstallUpdate() error {
	if version == "dev" {
		return fmt.Errorf("las actualizaciones automáticas están desactivadas en las versiones de desarrollo")
	}
	if !installing.CompareAndSwap(false, true) {
		return fmt.Errorf("ya hay una actualización en curso")
	}
	defer installing.Store(false)

	client := update.NewClient()

	// Look the release up again instead of trusting data from the UI.
	checkCtx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	info, err := client.Check(checkCtx, version)
	cancel()
	if err != nil {
		return err
	}
	if !info.Available {
		return fmt.Errorf("ya tienes la última versión (%s)", version)
	}

	exe, err := update.Executable()
	if err != nil {
		return err
	}

	ctx, stop := context.WithTimeout(a.ctx, 15*time.Minute)
	defer stop()
	err = client.Install(ctx, info, exe, func(phase string, done, total int64) {
		runtime.EventsEmit(a.ctx, "update:progress", map[string]any{"phase": phase, "done": done, "total": total})
	})
	if err != nil {
		return err
	}

	if err := update.Relaunch(exe); err != nil {
		return fmt.Errorf("la nueva versión quedó instalada, pero no se pudo reiniciar: %w. Ábrela de nuevo manualmente", err)
	}
	runtime.Quit(a.ctx)
	return nil
}
