package update

import (
	"os"
	"os/exec"
	"path/filepath"
)

// Executable returns the path of the running program with symlinks resolved.
func Executable() (string, error) {
	p, err := os.Executable()
	if err != nil {
		return "", err
	}
	if real, err := filepath.EvalSymlinks(p); err == nil {
		p = real
	}
	return p, nil
}

// Relaunch starts exePath as a new, independent process. The caller should quit
// right afterwards.
func Relaunch(exePath string) error {
	cmd := exec.Command(exePath)
	cmd.Dir = filepath.Dir(exePath)
	return cmd.Start()
}
