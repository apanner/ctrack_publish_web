package tray

import (
	"fmt"
	"log"
	"os/exec"
	"runtime"
	"strings"

	"github.com/getlantern/systray"
)

const defaultWebURL = "https://ctrackpublishweb.vercel.app"

// Options configures the native Windows systray host.
type Options struct {
	InstallRoot string
	WebURL      string
}

// Run blocks until the user quits from the tray menu.
func Run(opts Options) {
	webURL := strings.TrimRight(opts.WebURL, "/")
	if webURL == "" {
		webURL = defaultWebURL
	}
	linkURL := webURL + "/link-engine"

	systray.Run(func() {
		systray.SetTitle("CTrack Engine")
		systray.SetTooltip("CTrack Publish Engine")
		mSignIn := systray.AddMenuItem("Sign in to CTrack...", "Open browser pairing")
		mWeb := systray.AddMenuItem("Open web UI", "Open hosted app")
		systray.AddSeparator()
		mQuit := systray.AddMenuItem("Quit", "Stop engine and exit")

		go func() {
			for {
				select {
				case <-mSignIn.ClickedCh:
					openBrowser(linkURL)
				case <-mWeb.ClickedCh:
					openBrowser(webURL + "/")
				case <-mQuit.ClickedCh:
					systray.Quit()
					return
				}
			}
		}()
	}, func() {
		log.Println("[ctrack-engine] tray exiting")
	})
}

func openBrowser(url string) {
	if url == "" {
		return
	}
	switch runtime.GOOS {
	case "windows":
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	default:
		_ = exec.Command("xdg-open", url).Start()
	}
	fmt.Printf("Open: %s\n", url)
}
