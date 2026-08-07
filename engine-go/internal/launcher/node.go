package launcher

import (
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// NodeChild wraps the Node.js engine HTTP server subprocess.
type NodeChild struct {
	cmd *exec.Cmd
}

func StartNodeEngine(installRoot string) *NodeChild {
	engineDir := filepath.Join(installRoot, "engine")
	nodeExe := filepath.Join(installRoot, "runtime", "node.exe")
	if _, err := os.Stat(nodeExe); err != nil {
		nodeExe = "node"
	}

	cmd := exec.Command(nodeExe, "dist/server.js")
	cmd.Dir = engineDir
	cmd.Env = appendNodeOptions(os.Environ(), "--use-system-ca")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	applyWindowsHideWindow(cmd)
	if err := cmd.Start(); err != nil {
		log.Printf("[ctrack-engine] failed to start node engine: %v", err)
		return &NodeChild{}
	}
	log.Printf("[ctrack-engine] node engine started (pid=%d)", cmd.Process.Pid)
	time.Sleep(500 * time.Millisecond)
	return &NodeChild{cmd: cmd}
}

func (n *NodeChild) Stop() {
	if n == nil || n.cmd == nil || n.cmd.Process == nil {
		return
	}
	_ = n.cmd.Process.Kill()
	_, _ = n.cmd.Process.Wait()
}

func appendNodeOptions(env []string, flag string) []string {
	for i, entry := range env {
		if !strings.HasPrefix(entry, "NODE_OPTIONS=") {
			continue
		}
		if strings.Contains(entry, flag) {
			return env
		}
		env[i] = entry + " " + flag
		return env
	}
	return append(env, "NODE_OPTIONS="+flag)
}

func applyWindowsHideWindow(cmd *exec.Cmd) {
	if runtime.GOOS != "windows" {
		return
	}
	hideWindow(cmd)
}
