import "./style.css";
import { YouTubeAdapter } from "./youtube/youtube";

function loadRobotoFont() {
    if (
        document.querySelector(
            'link[href*="fonts.googleapis.com"][href*="Roboto"]'
        )
    ) {
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
    fontLink.href =
        "https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,100..900;1,100..900&display=swap";
    fontLink.rel = "stylesheet";
    document.head.appendChild(fontLink);
}

loadRobotoFont();

let adapter: YouTubeAdapter | null = null;
let currentVideoId: string | null = null;
let initializationObserver: MutationObserver | null = null;

function isVideoPage(): boolean {
    return window.location.href.startsWith("https://www.youtube.com/watch?v=");
}

function getCurrentVideoId(): string | null {
    const params = new URLSearchParams(window.location.search);
    return params.get("v");
}

async function main() {
    if (!isVideoPage()) {
        console.log("Not on a video page, skipping initialization");
        return;
    }

    const videoId = getCurrentVideoId();
    if (!videoId) {
        console.log("No video ID found, skipping initialization");
        return;
    }

    // Check if we already have an adapter running for this video
    if (adapter && currentVideoId === videoId) {
        console.log("Adapter already running for this video");
        return;
    }

    // Clean up previous adapter if it exists
    if (adapter) {
        console.log("Cleaning up previous adapter");
        adapter.destroy();
        adapter = null;
    }

    console.log(`Initializing for video: ${videoId}`);
    currentVideoId = videoId;

    adapter = new YouTubeAdapter();

    const video_player = await adapter.getVideoPlayer();
    const title = await adapter.getTitle();

    if (import.meta.env.DEV) {
        console.log("YouTube page structure:", {
            video_player,
            title,
        });
    }

    if (!video_player || !title) {
        console.error(
            "YouTube page structure has changed, unable to find video player or metadata."
        );
        return;
    }

    // Check if danmaku input is already present
    const existingDanmakuInput = document.querySelector(".danmaku-input-container");
    if (existingDanmakuInput) {
        console.log("Danmaku input already exists, removing old one");
        existingDanmakuInput.remove();
    }

    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = adapter.getDanmakuHtml();
    const danmakuElement = tempDiv.firstElementChild;

    if (danmakuElement) {
        title.prepend(danmakuElement);
        await adapter.initializeDanmaku();
        await adapter.setupEventListeners();
        console.log("Successfully initialized danmaku for video:", videoId);
    }
}

function setupMutationObserver() {
    // Stop any existing observer
    if (initializationObserver) {
        initializationObserver.disconnect();
    }

    // Watch for changes in the page title and video elements to detect navigation
    initializationObserver = new MutationObserver((mutations) => {
        let shouldReinitialize = false;

        mutations.forEach((mutation) => {
            // Check if the page title changed (indicates navigation)
            if (mutation.type === 'childList' && mutation.target.nodeName === 'TITLE') {
                shouldReinitialize = true;
            }
            
            // Check if video player elements changed
            if (mutation.type === 'childList') {
                const videoPlayerAdded = Array.from(mutation.addedNodes).some(node => 
                    node.nodeType === Node.ELEMENT_NODE && 
                    (node as Element).matches('video, .html5-main-video, ytd-watch-metadata')
                );
                
                if (videoPlayerAdded) {
                    shouldReinitialize = true;
                }
            }
        });

        if (shouldReinitialize) {
            const newVideoId = getCurrentVideoId();
            if (newVideoId && newVideoId !== currentVideoId) {
                console.log("Video change detected, reinitializing...");
                setTimeout(main, 500); // Small delay to let YouTube finish loading
            }
        }
    });

    // Observe changes to the entire document
    initializationObserver.observe(document, {
        childList: true,
        subtree: true
    });

    // Also observe title changes specifically
    const titleElement = document.querySelector('title');
    if (titleElement) {
        initializationObserver.observe(titleElement, {
            childList: true
        });
    }
}

// Initialize on page load
main();

// Setup mutation observer for SPA navigation detection
setupMutationObserver();

// Backup: Listen for YouTube's navigation events
document.addEventListener("yt-navigate-finish", () => {
    console.log("YouTube navigation detected");
    setTimeout(() => {
        if (isVideoPage()) {
            const newVideoId = getCurrentVideoId();
            if (newVideoId !== currentVideoId) {
                console.log("Navigation to new video detected");
                main();
            }
        } else {
            // Not on a video page, clean up
            if (adapter) {
                console.log("Navigated away from video page, cleaning up");
                adapter.destroy();
                adapter = null;
                currentVideoId = null;
            }
        }
    }, 500);
});

// Listen for URL changes via History API
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        console.log("URL change detected:", url);
        setTimeout(() => {
            if (isVideoPage()) {
                const newVideoId = getCurrentVideoId();
                if (newVideoId !== currentVideoId) {
                    console.log("URL change to new video");
                    main();
                }
            }
        }, 500);
    }
}).observe(document, { subtree: true, childList: true });

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
    if (adapter) {
        adapter.destroy();
    }
    if (initializationObserver) {
        initializationObserver.disconnect();
    }
});
