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

async function main() {
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
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = adapter.getDanmakuHtml();
    const danmakuElement = tempDiv.firstElementChild;

    if (danmakuElement) {
        title.prepend(danmakuElement);
        await adapter.initializeDanmaku();
        await adapter.setupEventListeners();
    }
}

main();

// For SPA support
document.addEventListener("yt-navigate-finish", () => {
    setTimeout(() => {
        if (window.location.href.startsWith("https://www.youtube.com/watch?v=")) {
            if (adapter) {
                adapter.destroy();
                adapter = null;
            }
            main();
        }
    }, 1000);
});
