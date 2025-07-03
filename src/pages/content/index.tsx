import "./style.css";
import { YouTubeAdapter } from "./youtube/youtube";

async function main() {
    // Detect the current site and use appropriate adapter
    const adapter = new YouTubeAdapter();
    
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
