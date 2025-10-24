import { getComments } from "../api";
import danmakuInputCss from "../css/danmaku-input.css?raw";
import danmakuCss from "../css/danmaku.css?raw";
import youtubeCss from "../css/sites/youtube.css?raw";
import { Danmaku } from "../danmaku/danmaku";
import { DanmakuInput } from "../danmaku/danmakuInput";
import { RawComment } from "../interfaces/danmaku";
import { SiteAdapterRegular } from "../interfaces/SiteAdapterRegular";
import { LoginModal } from "../modal-login/modal-login";
import { waitForElement, waitForPlayer } from "../utils/utils";

export class YouTubeAdapter implements SiteAdapterRegular {
    public readonly domain: string = "youtube";
    private videoContainerSelector: string = ".html5-video-player";
    private videoSelector: string = ".html5-main-video";
    private ytdWatchFlexySelector: string = "ytd-watch-flexy";
    private danmakuInputMinimizedSelector: string = "#player.style-scope.ytd-watch-flexy";
    private danmakuInputTheaterSelector: string = "#full-bleed-container";
    private danmakuInputFullscreenSelector: string = ".ytp-left-controls";

    public isInitialized: boolean = false;
    private videoId: string | null = null;
    private danmaku: Danmaku | null = null;
    private videoContainer: HTMLElement | null = null;
    private videoPlayer: HTMLVideoElement | null = null;
    private loginModal: LoginModal = new LoginModal();
    private danmakuContainer: HTMLDivElement | null = null;
    private danmakuInputContainer: HTMLElement | null = null;
    private danmakuInputInstance: DanmakuInput | null = null;
    private danmakuInputFullscreen: DanmakuInput | null = null;
    private danmakuInputFullscreenContainer: HTMLElement | null = null;
    private danmakuInputMinimizedParent: HTMLElement | null = null;
    private danmakuInputTheaterParent: HTMLElement | null = null;
    private danmakuInputFullscreenParent: HTMLElement | null = null;
    private ytdWatchFlexyElement: HTMLElement | null = null;

    constructor() {
        this.injectCSS();
        console.log(this.domain + " Adapter constructed.");
        document.addEventListener("yt-navigate-finish", () => this.handleNavigation());
    }

    private injectCSS(): void {
        if (document.querySelector('[data-extension="videodanmaku-css"]')) {
            return;
        }
        const style = document.createElement("style");
        style.setAttribute("data-extension", "videodanmaku-css");
        style.textContent = danmakuCss + danmakuInputCss + youtubeCss;
        document.head.appendChild(style);
        console.log(this.domain + " CSS injected.");
    }

    public async initializeDanmaku(): Promise<void> {
        const newVideoId = this.getVideoId(window.location.href);

        if (newVideoId && this.videoId !== newVideoId) {
            console.log(
                `New video detected: ${newVideoId}. Initializing or re-initializing.`
            );
            this.videoId = newVideoId;
            this.videoContainer = document.querySelector(this.videoContainerSelector);
            if (!this.videoContainer) {
                console.error("Could not find video container.");
                return;
            }

            this.videoPlayer = await waitForPlayer(this.videoSelector);
            if (!this.videoPlayer) {
                console.error("Could not find video player after waiting.");
                return;
            }

            if (!this.danmakuContainer || !this.danmaku || !this.danmakuInputInstance || !this.danmakuInputFullscreen) {
                console.log("First-time initialization.");
                this.danmakuContainer = document.createElement("div");
                this.danmakuContainer.classList.add("danmaku-container");
                this.videoContainer?.appendChild(this.danmakuContainer);

                console.debug("Danmaku container appended to video container:", this.videoContainer, this.danmakuContainer);
                this.danmaku = new Danmaku(
                    this.videoPlayer,
                    this.danmakuContainer,
                );

                await this.getDanmakuInputElements();

                this.danmakuInputInstance = new DanmakuInput(
                    this,
                    this.danmaku,
                    this.loginModal,
                    this.videoId
                );
                this.danmakuInputContainer = this.danmakuInputInstance.init();

                this.danmakuInputFullscreen = new DanmakuInput(
                    this,
                    this.danmaku,
                    this.loginModal,
                    this.videoId
                );
                this.danmakuInputFullscreenContainer = this.danmakuInputFullscreen.init();
                this.danmakuInputFullscreenContainer.classList.add('danmaku-input-fullscreen');

                await this.positionDanmakuInputs();

                await this.setupEventListeners(this.videoPlayer);
                console.log("Danmaku system initialized for the first time.");
            } else {
                console.log("Re-initializing for new video.");
                this.danmaku.destroy();
                this.danmaku = new Danmaku(this.videoPlayer, this.danmakuContainer);

                this.danmakuInputInstance.updateVideoId(this.videoId);
                this.danmakuInputFullscreen.updateVideoId(this.videoId);

                await this.getDanmakuInputElements();
                await this.positionDanmakuInputs();

                await this.setupEventListeners(this.videoPlayer);
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
                this.danmakuInputFullscreen!.updateCommentsStatus(false, 0);
                return;
            }
            if (this.danmaku.getCommentsCount > 0) {
                console.log("Comments already loaded, skipping API call");
                this.danmakuInputInstance!.updateCommentsStatus(true, this.danmaku.getCommentsCount);
                this.danmakuInputFullscreen!.updateCommentsStatus(true, this.danmaku.getCommentsCount);
                return;
            }

            console.log("Video metadata loaded. Loading display plan.");
            const limit = !this.videoPlayer
                ? 1000
                : this.videoPlayer.duration < 60
                    ? 400
                    : this.videoPlayer.duration < 300
                        ? 1000
                        : this.videoPlayer.duration < 1800
                            ? 16000
                            : 32000;
            const bucketSize = 5;
            const maxCommentsPerBucket = 50;
            const rawComments: RawComment[] | null = await getComments("youtube", this.videoId!, limit, bucketSize, maxCommentsPerBucket);

            if (rawComments && rawComments.length > 0) {
                console.log("Received display plan with comments:", rawComments.length);
                this.danmaku!.setComments(rawComments);
                this.danmakuInputInstance!.updateCommentsCount(rawComments.length);
                this.danmakuInputFullscreen!.updateCommentsCount(rawComments.length);
            } else {
                console.log("No display plan received or plan was empty.");
                this.danmaku!.setComments([]);
                this.danmakuInputInstance!.updateCommentsCount(0);
                this.danmakuInputFullscreen!.updateCommentsCount(0);
            }

            if (!this.danmaku!.videoPlayer.paused) {
                this.danmaku!.play();
            }
        });
    };

    public async setupEventListeners(
        videoPlayer: HTMLVideoElement,
    ): Promise<void> {

        videoPlayer.removeEventListener("loadedmetadata", this.onLoadedMetadata);
        videoPlayer.addEventListener("loadedmetadata", this.onLoadedMetadata);

        if (videoPlayer.readyState >= 1) {
            console.log(
                "Video metadata was already loaded. Manually triggering comment load."
            );
            await this.onLoadedMetadata();
        }

        this.setupVideoListeners();
    }

    private setupVideoListeners(): void {
        document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
        document.removeEventListener("yt-set-theater-mode-enabled", this.handleTheaterModeChange);

        document.addEventListener("fullscreenchange", this.handleFullscreenChange);
        document.addEventListener("yt-set-theater-mode-enabled", (event) => this.handleTheaterModeChange(event));
    }

    private handleFullscreenChange = (): void => {
        this.updateDanmakuInputVisibility();
    };

    private handleTheaterModeChange = (event: Event): void => {
        const eventDetail: boolean = (event as CustomEvent).detail.enabled;
        if (eventDetail) {
            this.moveDanmakuInput(true);
        } else {
            this.moveDanmakuInput(false);
        }
    };

    private isFullscreen(): boolean {
        return !!document.fullscreenElement;
    }

    private updateDanmakuInputVisibility(): void {
        if (this.isFullscreen()) {
            this.danmakuInputFullscreenContainer?.classList.add('visible');
            this.danmakuInputContainer?.classList.remove('visible');
        } else {
            this.danmakuInputFullscreenContainer?.classList.remove('visible');
            this.danmakuInputContainer?.classList.add('visible');
        }
    }

    private async positionDanmakuInputs(): Promise<void> {
        if (!this.danmakuInputFullscreenContainer || !this.danmakuInputContainer) {
            console.warn("Danmaku input containers not found");
            return;
        }
        
        const isTheaterMode = this.isTheater();
        console.log(`Positioning danmaku inputs. Theater mode: ${isTheaterMode}`);
        
        if (this.danmakuInputFullscreenParent && this.danmakuInputFullscreenContainer) {
            this.danmakuInputFullscreenContainer.remove();
            this.danmakuInputFullscreenParent.insertAdjacentElement('afterend', this.danmakuInputFullscreenContainer);
        }

        if (this.danmakuInputContainer) {
            this.danmakuInputContainer.remove();
            
            if (isTheaterMode && this.danmakuInputTheaterParent) {
                console.log("Positioning in theater mode", this.danmakuInputTheaterParent);
                this.danmakuInputTheaterParent.insertAdjacentElement('afterend', this.danmakuInputContainer);
            } else if (this.danmakuInputMinimizedParent) {
                console.log("Positioning in minimized mode", this.danmakuInputMinimizedParent);
                this.danmakuInputMinimizedParent.insertAdjacentElement('afterend', this.danmakuInputContainer);
            } else {
                console.warn("No valid parent found for danmaku input");
            }

            this.danmakuInputContainer.classList.add('visible');
        }
    }

    private moveDanmakuInput(isTheater: boolean): void {
        console.log(this.danmakuInputContainer);
        if (this.danmakuInputContainer) {
            console.log(isTheater)
            this.danmakuInputContainer.remove();
            
            if (isTheater && this.danmakuInputTheaterParent) {
                console.log("Moving to theater mode", this.danmakuInputTheaterParent);
                this.danmakuInputTheaterParent.insertAdjacentElement('afterend', this.danmakuInputContainer);
            } else if (this.danmakuInputMinimizedParent) {
                console.log("Moving to minimized mode", this.danmakuInputMinimizedParent);
                this.danmakuInputMinimizedParent.insertAdjacentElement('afterend', this.danmakuInputContainer);
            }
        }
    }

    private async getDanmakuInputElements(): Promise<void> {
        const ytdWatchFlexyElement = await waitForElement(this.ytdWatchFlexySelector);
        if (ytdWatchFlexyElement) {
            this.ytdWatchFlexyElement = ytdWatchFlexyElement as HTMLElement;
        }

        const danmakuInputDefaultElement = await waitForElement(this.danmakuInputMinimizedSelector);
        if (danmakuInputDefaultElement) {
            this.danmakuInputMinimizedParent = danmakuInputDefaultElement as HTMLElement;
        }

        const theaterContainer = await waitForElement(this.danmakuInputTheaterSelector);
        if (theaterContainer) {
            this.danmakuInputTheaterParent = theaterContainer as HTMLElement;
        }

        const leftControls = await waitForElement(this.danmakuInputFullscreenSelector);
        if (leftControls) {
            this.danmakuInputFullscreenParent = leftControls as HTMLElement;
        }

    }

    private isTheater(): boolean {
        return this.ytdWatchFlexyElement?.hasAttribute('theater') ?? false;
    }

    public isVideoPage(url: string): boolean {
        if (!url) return false;
        return url.indexOf("watch") !== -1;
    }

    public getVideoId(url: string): string | null {
        if (!url) return null;
        const match = url.match(/[?&]v=([^&]+)/);
        return match ? match[1] : null;
    }

    private handleNavigation(): void {
        const newVideoId = this.getVideoId(window.location.href);
        if (newVideoId && this.videoId !== newVideoId && this.isVideoPage(window.location.href)) {
            console.log(`New video detected: ${newVideoId}. Initializing.`);
            this.videoId = newVideoId;
            this.initializeDanmaku();
        }
    }

    public destroy(): void {
        console.log("Destroying existing Danmaku instance...");
        if (this.videoPlayer) {
            this.videoPlayer.removeEventListener("loadedmetadata", this.onLoadedMetadata);
        }

        document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
        document.removeEventListener("yt-set-theater-mode-enabled", this.handleTheaterModeChange);

        if (this.danmaku) {
            this.danmaku.destroy();
        }
        if (this.danmakuContainer) {
            this.danmakuContainer.remove();
        }
        if (this.danmakuInputContainer) {
            this.danmakuInputContainer.remove();
        }
        if (this.danmakuInputFullscreenContainer) {
            this.danmakuInputFullscreenContainer.remove();
        }

        this.videoPlayer = null;
        this.videoId = null;
        this.danmakuInputMinimizedParent = null;
        this.danmakuInputTheaterParent = null;
        this.danmakuInputFullscreenParent = null;
        this.danmakuInputInstance = null;
        this.danmakuInputFullscreen = null;
        this.ytdWatchFlexyElement = null;
        this.isInitialized = false;
        console.log("Danmaku instance destroyed.");
    }

    /**
     * Get current video time in milliseconds.
     * For YouTube, we have direct access to the video element.
     */
    public async getCurrentTime(): Promise<number> {
        if (this.videoPlayer) {
            return this.videoPlayer.currentTime * 1000;
        }
        return 0;
    }
}
