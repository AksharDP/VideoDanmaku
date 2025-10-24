import "./css/danmaku.css";
import "./css/danmaku-input.css";
import "./css/modal-login.css";
import { YouTubeAdapter } from "./sites/youtube";
import { CrunchyrollAdapter } from "./sites/crunchyroll";
import { SiteAdapter } from "./interfaces/SiteAdapter";

function loadRobotoFont() {
  if (document.querySelector('link[href*="fonts.googleapis.com"][href*="Roboto"]')) {
    return;
  }

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

  } else if (hostname.includes("crunchyroll.com")) {
    console.log("Crunchyroll domain detected.");

    if (window !== window.top) {
      // This code runs INSIDE the iframe (static.crunchyroll.com)
      console.log("Inside Crunchyroll iframe - initializing CrunchyrollIframeAdapter");
      import("./sites/crunchyroll").then((module) => {
        const siteAdapter: SiteAdapter = new module.CrunchyrollIframeAdapter();
        // Don't call initializeDanmaku() here - wait for PAGE_STATUS message from parent
        console.log("[index] CrunchyrollIframeAdapter loaded in iframe, waiting for page status");
      }).catch((error) => {
        console.error("[index] Failed to load CrunchyrollIframeAdapter in iframe:", error);
      });
    } else {
      // This code runs on the MAIN page (www.crunchyroll.com)
      console.log("Main page - initializing CrunchyrollMainAdapter");
      
      import("./sites/crunchyroll").then((module) => {
        const siteAdapter: SiteAdapter = new module.CrunchyrollMainAdapter();
        let currentVideoId: string | null = null;

        const handleNavigation = () => {
          const newVideoId = siteAdapter.getVideoId(window.location.href);
          const isVideo = siteAdapter.isVideoPage(window.location.href);

          if (isVideo && newVideoId !== currentVideoId) {
            console.log(`[index] New video detected: ${newVideoId}`);
            currentVideoId = newVideoId;
            (siteAdapter as any).videoId = newVideoId;
            siteAdapter.initializeDanmaku();
          } else if (!isVideo && currentVideoId) {
            console.log("[index] Navigated away from video page");
            siteAdapter.destroy();
            currentVideoId = null;
          }
        };

        // Initial check
        handleNavigation();

        // Watch for navigation changes (Crunchyroll is a SPA)
        const observer = new MutationObserver(() => {
          handleNavigation();
        });

        observer.observe(document.body, { childList: true, subtree: true });
      }).catch((error) => {
        console.error("[index] Failed to load CrunchyrollMainAdapter on main page:", error);
      });
    }
  }
}

loadRobotoFont();
initializeSite();
