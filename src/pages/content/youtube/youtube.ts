import { DanmakuInput } from "../danmaku/danmakuInput";
import { getDisplayPlan } from "../api"; // UPDATED
import { Danmaku } from "../danmaku/danmaku";
import { LoginModal } from "../modal-login/modal-login";
import { DisplayPlan, PlannedComment } from "../interfaces/danmaku";
import youtubeCss from "../css/sites/youtube.css?raw";
import danmakuCss from "../css/danmaku.css?raw";
import danmakuInputCss from "../css/danmaku-input.css?raw";
import { SiteAdapter } from "../interfaces/SiteAdapter";

export class YouTubeAdapter implements SiteAdapter {
    public isInitialized: boolean = false;
    private videoId: string | null = null;
    private danmaku: Danmaku | null = null;
    private videoContainer: HTMLElement | null = null;
    private videoPlayer: HTMLVideoElement | null = null;
    private controls: HTMLElement | null = null;
    private loginModal: LoginModal = new LoginModal();
    private danmakuContainer: HTMLDivElement | null = null;
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
        style.textContent = danmakuCss + danmakuInputCss + youtubeCss;
        document.head.appendChild(style);
        console.log("YouTube CSS injected.");
    }

    public async initializeDanmaku(): Promise<void> {
        const newVideoId = this.getVideoId(window.location.href);

        if (newVideoId && this.videoId !== newVideoId) {
            console.log(
                `New video detected: ${newVideoId}. Initializing or re-initializing.`
            );
            this.videoId = newVideoId;

            this.videoContainer = document.querySelector(".html5-video-player");

            if (!this.videoContainer) {
                console.error("Could not find video container.");
                return;
            }

            this.videoPlayer = await this.waitForPlayer();
            if (!this.videoPlayer) {
                console.error("Could not find video player after waiting.");
                return;
            }

            this.controls = document.querySelector(".ytp-chrome-bottom");
            if (!this.controls) {
                console.error("Could not find video controls.");
                return;
            }

            if (!this.isInitialized) {
                console.log("First-time initialization.");
                this.danmakuContainer = document.createElement("div");
                this.danmakuContainer.classList.add("danmaku-container");
                // The container should be a sibling of the video player, not a child
                this.videoContainer.appendChild(this.danmakuContainer);
                
                this.danmaku = new Danmaku(
                    this.videoPlayer,
                    this.danmakuContainer,
                    this.controls
                );
                this.danmakuInputInstance = new DanmakuInput(
                    this.danmaku,
                    this.loginModal,
                    this.videoId
                );

                const danmakuInputElement = this.danmakuInputInstance.init();
                await this.setupDanmakuInput(danmakuInputElement);

                await this.setupEventListeners(this.videoPlayer, this.danmaku);
                this.isInitialized = true;
                console.log("Danmaku system initialized for the first time.");
            } else {
                console.log("Re-initializing for new video.");
                // The danmaku instance now just needs a full clear
                this.danmaku!.destroy(); 
                this.danmaku = new Danmaku(this.videoPlayer, this.danmakuContainer!, this.controls);
                
                this.danmakuInputInstance!.updateVideoId(this.videoId);

                if (
                    this.danmakuInputContainer &&
                    !this.danmakuInputContainer.parentElement
                ) {
                    const belowPlayer = await this.waitForElement("#below");
                    if (belowPlayer) {
                        belowPlayer.prepend(this.danmakuInputContainer);
                    }
                }

                await this.setupEventListeners(this.videoPlayer, this.danmaku!);
                console.log("Danmaku system re-initialized for new video.");
            }
        } else if (newVideoId && !this.videoPlayer) {
            console.log("Player not found, attempting to re-initialize.");
            this.isInitialized = false;
            this.videoId = null;
            this.initializeDanmaku();
        }
    }

    private onLoadedMetadata = async () => {
        chrome.storage.local.get(["danmakuEnabled"], async (result) => {
            if (!this.danmaku || !this.videoId) return;
            const danmakuEnabled = result.danmakuEnabled ?? true;

            if (danmakuEnabled === false) {
                console.log("Danmaku is disabled, skipping display plan load");
                this.danmakuInputInstance!.updateCommentsStatus(false, 0);
                return;
            }
            if (this.danmaku.getCommentsCount > 0) {
                console.log("Comments already loaded, skipping API call");
                this.danmakuInputInstance!.updateCommentsStatus(true, this.danmaku.getCommentsCount);
                return;
            }

            console.log("Video metadata loaded. Loading display plan.");
            const displayPlan: DisplayPlan | null = await getDisplayPlan("youtube", this.videoId!);

            if (displayPlan && displayPlan.comments.length > 0) {
                 console.log("Received display plan with comments:", displayPlan.comments.length);
                this.danmaku!.setComments(displayPlan.comments);
                this.danmakuInputInstance!.updateCommentsCount(displayPlan.comments.length);
            } else {
                 console.log("No display plan received or plan was empty.");
                 this.danmaku!.setComments([]);
                 this.danmakuInputInstance!.updateCommentsCount(0);
            }

            if (!this.danmaku!.videoPlayer.paused) {
                this.danmaku!.play();
            }
        });
    };

    public async setupEventListeners(
        videoPlayer: HTMLVideoElement,
        danmaku: Danmaku
    ): Promise<void> {
        
        // Remove listener to prevent duplicates on re-initialization
        videoPlayer.removeEventListener("loadedmetadata", this.onLoadedMetadata);
        videoPlayer.addEventListener("loadedmetadata", this.onLoadedMetadata);

        if (videoPlayer.readyState >= 1) { // HAVE_METADATA
            console.log(
                "Video metadata was already loaded. Manually triggering comment load."
            );
            await this.onLoadedMetadata();
        }

        if (this.resizeObserver && this.videoElementForObserver) {
            this.resizeObserver.unobserve(this.videoElementForObserver);
        }
        
        // Danmaku class now handles its own resize logic based on its container
        // this.resizeObserver = new ResizeObserver(() => danmaku.resize());
        // this.resizeObserver.observe(videoPlayer);
        // this.videoElementForObserver = videoPlayer;
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
        if (this.videoPlayer) {
            this.videoPlayer.removeEventListener("loadedmetadata", this.onLoadedMetadata);
        }
        if (this.danmaku) {
            this.danmaku.destroy();
        }
        if (this.danmakuContainer) {
            this.danmakuContainer.remove();
        }
        if (this.danmakuInputContainer) {
            this.danmakuInputContainer.remove();
        }
        if (this.resizeObserver && this.videoElementForObserver) {
            this.resizeObserver.unobserve(this.videoElementForObserver);
            this.resizeObserver = null;
        }

        this.videoPlayer = null;
        this.videoElementForObserver = null;
        this.videoId = null;
        this.isInitialized = false; // Set to false so it fully re-initializes next time
        console.log("Danmaku instance destroyed.");
    }

    public getVideoPlayer(): HTMLVideoElement {
        return document.querySelector(".html5-main-video") as HTMLVideoElement;
    }

    private async waitForPlayer(): Promise<HTMLVideoElement | null> {
        return new Promise((resolve) => {
            let observer: MutationObserver | null = null;
            const checkForPlayer = () => {
                const player = this.getVideoPlayer();
                if (player) {
                    if (observer) {
                        observer.disconnect();
                    }
                    resolve(player);
                    return true;
                }
                return false;
            };

            if (checkForPlayer()) {
                return;
            }

            observer = new MutationObserver(() => {
                checkForPlayer();
            });

            observer.observe(document.body, { childList: true, subtree: true });
        });
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
