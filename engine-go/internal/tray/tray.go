package tray

import (
	"fmt"
	"log"
	"os/exec"
	"runtime"
	"strings"

	"github.com/getlantern/systray"
)

const defaultLocalUI = "http://127.0.0.1:7777"
const defaultHostedWeb = "https://ctrackpublishweb.vercel.app"

// Options configures the native Windows systray host.
type Options struct {
	InstallRoot string
	WebURL      string
}

// Run blocks until the user quits from the tray menu.
func Run(opts Options) {
	localUI := defaultLocalUI
	hosted := strings.TrimRight(opts.WebURL, "/")
	if hosted == "" {
		hosted = defaultHostedWeb
	}
	linkURL := hosted + "/link-engine"

	systray.Run(func() {
		systray.SetTitle("CTrack Engine")
		systray.SetTooltip("CTrack Publish Engine")
		mOpen := systray.AddMenuItem("Open CTrack", "Open local publish UI")
		mSignIn := systray.AddMenuItem("Sign in to CTrack...", "Open browser pairing")
		systray.AddSeparator()
		mQuit := systray.AddMenuItem("Quit", "Stop engine and exit")

		go func() {
			for {
				select {
				case <-mOpen.ClickedCh:
					openBrowser(localUI + "/")
				case <-mSignIn.ClickedCh:
					openBrowser(linkURL)
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
