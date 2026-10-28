package main

import (
	"context"
	"fmt"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"sp-extractor-wails/pkg/update"
)

// GetAppVersion returns the running version: wails.json's productVersion (or the
// value injected by the release build), and "dev" only under `wails dev`.
func (a *App) GetAppVersion() string { return appVersion() }

// CheckForUpdate asks GitHub whether a newer release exists.
func (a *App) CheckForUpdate() (update.Info, error) {
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	defer cancel()
	return update.NewClient().Check(ctx, appVersion())
}

var installing atomic.Bool

// InstallUpdate downloads the newest release, verifies it, replaces the running
// executable, starts the new one and quits. Progress is reported through the
// "update:progress" event ({phase, done, total}).
func (a *App) InstallUpdate() error {
	current := appVersion()
	if current == "dev" {
		return fmt.Errorf("las actualizaciones automáticas están desactivadas en las versiones de desarrollo")
	}
	if !installing.CompareAndSwap(false, true) {
		return fmt.Errorf("ya hay una actualización en curso")
	}
	defer installing.Store(false)

	client := update.NewClient()

	// Look the release up again instead of trusting data from the UI.
	checkCtx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	info, err := client.Check(checkCtx, current)
	cancel()
	if err != nil {
		return err
	}
	if !info.Available {
		return fmt.Errorf("ya tienes la última versión (%s)", current)
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
