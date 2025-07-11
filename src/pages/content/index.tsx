import "./css/danmaku.css";
import "./css/danmaku-input.css";
import "./css/modal-login.css";

import { YouTubeAdapter } from "./youtube/youtube";
import { SiteAdapter } from "./interfaces/SiteAdapter";

function loadRobotoFont() {
    if (document.querySelector('link[href*="fonts.googleapis.com"][href*="Roboto"]')) {
        return;
    }
    // ... (font loading code remains the same)
    const preconnect1 = document.createElement("link");
    preconnect1.rel = "preconnect";
    preconnect1.href = "https://fonts.googleapis.com";
    document.head.appendChild(preconnect1);

    const preconnect2 = document.createElement("link");
    preconnect2.rel = "preconnect";
    preconnect2.href = "https://fonts.gstatic.com";
    preconnect2.crossOrigin = "anonymous";
    document.head.appendChild(preconnect2);

    const fontLink = document.createElement("link");
    fontLink.href = "https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,100..900;1,100..900&display=swap";
    fontLink.rel = "stylesheet";
    document.head.appendChild(fontLink);
}

function initializeSite() {
    const hostname = window.location.hostname;

    if (hostname.includes("youtube.com")) {
        console.log("YouTube site detected. Setting up adapter and listeners.");

        // FIX: The type is now correctly assignable.
        const siteAdapter: SiteAdapter = new YouTubeAdapter();
        let currentVideoId: string | null = null;

        const handleNavigation = () => {
            const newVideoId = siteAdapter.getVideoId(window.location.href);

            if (siteAdapter.isVideoPage(window.location.href)) {
                if (currentVideoId !== newVideoId) {
                    console.log(`New video detected: ${newVideoId}. Initializing.`);
                    currentVideoId = newVideoId;
                    siteAdapter.initializeDanmaku();
                }
            } else {
                if (currentVideoId) {
                    console.log("Navigated away from a video page. Destroying instance.");
                    siteAdapter.destroy();
                    currentVideoId = null;
                }
            }
        };

        document.addEventListener("yt-navigate-finish", handleNavigation);
        handleNavigation();
    }
}

// --- Main Execution ---
loadRobotoFont();
initializeSite();