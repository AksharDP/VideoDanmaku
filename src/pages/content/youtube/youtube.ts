import { DanmakuInput } from "../danmaku/danmakuInput";
import { getComments, Comment } from "../api";
import { Danmaku } from "../danmaku/danmaku";
import { LoginModal } from "../modal-login/modal-login";
import youtubeCss from "../css/sites/youtube.css?raw";
import danmakuCss from "../css/danmaku.css?raw";
import danmakuInputCss from "../css/danmaku-input.css?raw";
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

            this.videoPlayer = await this.waitForPlayer();

            if (!this.videoPlayer) {
                console.error("Could not find video player after waiting.");
                return;
            }

            if (!this.isInitialized) {
                console.log("First-time initialization.");
                this.danmakuContainer = document.createElement("div");
                this.danmakuContainer.classList.add("danmaku-container");
                this.videoPlayer.parentElement?.insertBefore(
                    this.danmakuContainer,
                    this.videoPlayer.nextSibling
                );

                this.danmaku = new Danmaku(
                    this.videoPlayer,
                    this.danmakuContainer
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
                this.danmaku!.reinitialize(this.videoPlayer);
                this.danmakuInputInstance!.updateVideoId(this.videoId);

                if (
                    this.danmakuContainer &&
                    !this.danmakuContainer.parentElement
                ) {
                    this.videoPlayer.parentElement?.insertBefore(
                        this.danmakuContainer,
                        this.videoPlayer.nextSibling
                    );
                }
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

    public async setupEventListeners(
        videoPlayer: HTMLVideoElement,
        danmaku: Danmaku
    ): Promise<void> {
        const onPlay = () => danmaku.play();
        const onPause = () => danmaku.pause();
        const onSeek = () => danmaku.seek();

        const onLoadedMetadata = async () => {
            chrome.storage.local.get("danmakuEnabled", async ({ danmakuEnabled }) => {
                console.log("onLoadedMetadata called - danmakuEnabled:", danmakuEnabled, "commentsCount:", danmaku.getCommentsCount);
                if (danmakuEnabled === false) {
                    console.log("Danmaku is disabled, skipping comment load");
                    this.danmakuInputInstance!.updateCommentsStatus(false, 0);
                    return;
                }
                if (danmaku.getCommentsCount > 0) {
                    console.log("Comments already loaded, skipping API call");
                    this.danmakuInputInstance!.updateCommentsStatus(true, danmaku.getCommentsCount);
                    return;
                }

                console.log("Video metadata loaded. Loading comments.");
                const videoDuration = videoPlayer.duration / 60;
                const limit =
                    videoDuration < 5 ? 1000 : videoDuration < 30 ? 5000 : 10000;

                console.log("Calling getComments API with videoId:", this.videoId, "limit:", limit);
                const comments = await getComments("youtube", this.videoId!, limit);
                console.log("Received comments:", comments.length);
                danmaku.setComments(comments);
                this.danmakuInputInstance!.updateCommentsCount(comments.length);

                if (!videoPlayer.paused) {
                    danmaku.play();
                }
            });
        };

        videoPlayer.addEventListener("play", onPlay);
        videoPlayer.addEventListener("pause", onPause);
        videoPlayer.addEventListener("seeked", onSeek);
        videoPlayer.addEventListener("loadedmetadata", onLoadedMetadata);

        danmaku.setVideoEventListeners([
            { event: "play", listener: onPlay },
            { event: "pause", listener: onPause },
            { event: "seeked", listener: onSeek },
            { event: "loadedmetadata", listener: onLoadedMetadata },
        ]);

        if (videoPlayer.readyState >= 1) {
            console.log(
                "Video metadata was already loaded. Manually triggering comment load."
            );
            onLoadedMetadata();
        }

        if (this.resizeObserver && this.videoElementForObserver) {
            this.resizeObserver.unobserve(this.videoElementForObserver);
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
        console.log("Danmaku instance hidden, ready for re-use.");
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