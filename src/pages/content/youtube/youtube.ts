import { DanmakuInput } from "../danmaku/danmakuInput";
import { getComments, Comment } from "../api";
import { Danmaku } from "../danmaku/danmaku";
import { LoginModal } from "../login-modal";
import youtubeCss from "../css/sites/youtube.css?raw";
import danmakuBaseCss from "../css/danmaku-base.css?raw";
import { SiteAdapter } from "../interfaces/SiteAdapter";

export class YouTubeAdapter implements SiteAdapter {
    public isInitialized: boolean = false;
    private videoId: string | null = null;
    private danmaku: Danmaku | null = null;
    private videoPlayer: HTMLVideoElement | null = null;
    private loginModal: LoginModal = new LoginModal();
    private danmakuContainer: HTMLElement | null = null;
    private danmakuInputContainer: HTMLElement | null = null;
    private danmakuInputInstance: DanmakuInput | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private videoElementForObserver: HTMLVideoElement | null = null;

    constructor() {
        this.injectCSS();
        console.log("YouTubeAdapter constructed.");
    }

    private injectCSS(): void {
        if (document.querySelector('[data-extension="videodanmaku-css"]')) {
            return;
        }
        const style = document.createElement("style");
        style.setAttribute("data-extension", "videodanmaku-css");
        style.textContent = danmakuBaseCss + youtubeCss;
        document.head.appendChild(style);
        console.log("YouTube CSS injected.");
    }

    public async initializeDanmaku(): Promise<void> {
        const newVideoId = this.getVideoId(window.location.href);

        if (this.isInitialized && this.videoId === newVideoId) {
            return;
        }

        if (this.isInitialized) {
            this.destroy();
        }

        console.log(`Initializing Danmaku for YouTube video: ${newVideoId}`);
        this.videoId = newVideoId;

        if (!this.videoId) {
            return;
        }

        this.videoPlayer = this.getVideoPlayer();
        if (!this.videoPlayer) {
            return;
        }

        this.danmakuContainer = document.createElement("div");
        this.danmakuContainer.classList.add("danmaku-container");
        this.videoPlayer.parentElement?.insertBefore(this.danmakuContainer, this.videoPlayer.nextSibling);

        this.danmaku = new Danmaku(this.videoPlayer, this.danmakuContainer);
        this.danmakuInputInstance = new DanmakuInput(this.danmaku, this.loginModal, this.videoId);

        const danmakuInputElement = this.danmakuInputInstance.init();
        await this.setupDanmakuInput(danmakuInputElement);
        
        await this.setupEventListeners(this.videoPlayer, this.danmaku);

        this.isInitialized = true;
        console.log("Danmaku system initialized and listeners attached.");
    }

    public async setupEventListeners(videoPlayer: HTMLVideoElement, danmaku: Danmaku): Promise<void> {
        const onPlay = () => danmaku.play();
        const onPause = () => danmaku.pause();
        const onSeek = () => danmaku.seek();

        // This handler will now be called either by the event or manually.
        const onLoadedMetadata = async () => {
            // Prevent this from running more than once
            if (danmaku.getCommentsCount > 0) return; 

            console.log("Video metadata loaded. Loading comments.");
            const videoDuration = videoPlayer.duration / 60;
            const limit = videoDuration < 5 ? 1000 : videoDuration < 30 ? 5000 : 10000;
            
            const comments = await getComments("youtube", this.videoId!, limit);
            danmaku.setComments(comments);
            this.danmakuInputInstance!.updateCommentsCount(comments.length);

            if (!videoPlayer.paused) {
                danmaku.play();
            }
        };

        videoPlayer.addEventListener("play", onPlay);
        videoPlayer.addEventListener("pause", onPause);
        videoPlayer.addEventListener("seeked", onSeek);
        videoPlayer.addEventListener("loadedmetadata", onLoadedMetadata);

        danmaku.setVideoEventListeners([
            { event: "play", listener: onPlay },
            { event: "pause", listener: onPause },
            { event: "seeked", listener: onSeek },
            { event: "loadedmetadata", listener: onLoadedMetadata }
        ]);
        
        // **BUG FIX:** If metadata is already loaded, the 'loadedmetadata' event may have already fired.
        // We check the video's readyState and manually call the handler if needed.
        // readyState >= 1 means metadata is available.
        if (videoPlayer.readyState >= 1) {
            console.log("Video metadata was already loaded. Manually triggering comment load.");
            onLoadedMetadata();
        }

        this.resizeObserver = new ResizeObserver(() => danmaku.resize());
        this.resizeObserver.observe(videoPlayer);
        this.videoElementForObserver = videoPlayer;
    }

    private async setupDanmakuInput(element: HTMLElement): Promise<void> {
        const belowPlayer = await this.waitForElement("#below");
        if (belowPlayer) {
            belowPlayer.prepend(element);
            this.danmakuInputContainer = element;
        }
    }

    public isVideoPage(url: string): boolean {
        try {
            return new URL(url).pathname === "/watch";
        } catch {
            return false;
        }
    }

    public getVideoId(url: string): string | null {
        try {
            return new URL(url).searchParams.get("v");
        } catch {
            return null;
        }
    }

    public destroy(): void {
        console.log("Destroying existing Danmaku instance...");
        if (this.danmaku) {
            this.danmaku.destroy();
            this.danmaku = null;
        }
        if (this.danmakuContainer) {
            this.danmakuContainer.remove();
            this.danmakuContainer = null;
        }
        if (this.danmakuInputContainer) {
            this.danmakuInputContainer.remove();
            this.danmakuInputContainer = null;
        }
        this.danmakuInputInstance = null;

        if (this.resizeObserver && this.videoElementForObserver) {
            this.resizeObserver.unobserve(this.videoElementForObserver);
            this.resizeObserver = null;
        }
        
        this.isInitialized = false;
        this.videoId = null;
        console.log("Danmaku instance destroyed.");
    }
    
    public getVideoPlayer(): HTMLVideoElement {
        return document.querySelector(".html5-main-video") as HTMLVideoElement;
    }
    
    private async waitForElement(selector: string): Promise<Element | null> {
        return new Promise((resolve) => {
            const el = document.querySelector(selector);
            if (el) return resolve(el);
            const observer = new MutationObserver(() => {
                const el = document.querySelector(selector);
                if (el) {
                    observer.disconnect();
                    resolve(el);
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }
}