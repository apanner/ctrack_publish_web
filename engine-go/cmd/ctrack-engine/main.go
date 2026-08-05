package main

import (
	"flag"
	"log"
	"os"
	"path/filepath"

	"github.com/ctrack/engine-go/internal/instance"
	"github.com/ctrack/engine-go/internal/launcher"
	"github.com/ctrack/engine-go/internal/tray"
)

func main() {
	installRoot := flag.String("install-root", "", "CTrack install root (defaults to parent of engine-go)")
	flag.Parse()

	root := *installRoot
	if root == "" {
		exe, err := os.Executable()
		if err != nil {
			log.Fatal(err)
		}
		root = filepath.Dir(exe)
	}

	lock := instance.New("ctrack-engine")
	if !lock.Acquire() {
		log.Println("ctrack-engine already running")
		return
	}
	defer lock.Release()

	nodeChild := launcher.StartNodeEngine(root)
	defer nodeChild.Stop()

	tray.Run(tray.Options{
		InstallRoot: root,
		WebURL:      os.Getenv("CTRACK_WEB_URL"),
	})
}
