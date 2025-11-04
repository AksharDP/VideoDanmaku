import { getComments } from "../api";
import { Danmaku } from "../danmaku/danmaku";
import { DanmakuInput } from "../danmaku/danmakuInput";
import { RawComment } from "../interfaces/danmaku";
import { LoginModal } from "../modal-login/modal-login";
import { waitForElement } from "../utils/utils";

// ============================================================================
// Constants
// ============================================================================

const RESIZE_DEBOUNCE_MS = 50;
const PLAYER_WAIT_ATTEMPTS = 50;
const PLAYER_WAIT_DELAY_MS = 100;
const COMMENT_BUCKET_SIZE = 5;
const MAX_COMMENTS_PER_BUCKET = 50;

const VIDEO_DURATION_THRESHOLDS = {
    SHORT: 60,
    MEDIUM: 300,
    LONG: 1800,
} as const;

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface SiteConfig {
    selectors: {
        videoContainer: string;
        video: string;
    };
    commentLimits: {
        short: number;      // < 60s
        medium: number;     // < 300s
        long: number;       // < 1800s
        veryLong: number;   // >= 1800s
    };
}

type InputMode = "regular" | "fullscreen";

export interface SiteAdapter {
    domain: string;
    getVideoId(url: string): string | null;
    isVideoPage(url: string): boolean;
    initializeDanmaku(): Promise<void>;
    getCurrentTime(): Promise<number>;
    setVideoId(videoId: string | null): void;
    getVideoIdFromAdapter(): string | null;
    destroy(): void;
}

export abstract class BaseSiteAdapter implements SiteAdapter {
    public abstract readonly domain: string;
    protected abstract readonly config: SiteConfig;

    public isInitialized: boolean = false;
    protected videoId: string | null = null;
    protected danmaku: Danmaku | null = null;
    protected videoContainer: HTMLElement | null = null;
    protected videoPlayer: HTMLVideoElement | null = null;
    protected loginModal: LoginModal = new LoginModal();
    protected danmakuContainer: HTMLDivElement | null = null;
    protected danmakuInputRegular: DanmakuInput | null = null;
    protected danmakuInputFullscreen: DanmakuInput | null = null;

    // AbortControllers for proper cleanup
    protected videoEventsAbortController: AbortController | null = null;
    protected viewModeAbortController: AbortController | null = null;
    protected navigationAbortController: AbortController = new AbortController();

    // Cache
    protected readonly videoIdRegex: RegExp;
    private isLoadingComments: boolean = false;

    // Resize handling
    private videoWidthObserver: ResizeObserver | null = null;
    private resizeDebounceTimeout: number | null = null;

    constructor(videoIdPattern: RegExp) {
        this.videoIdRegex = videoIdPattern;
        // Initialize abort controllers in constructor
        this.videoEventsAbortController = new AbortController();
        this.viewModeAbortController = new AbortController();
    }

    protected abstract injectCSS(): void;
    protected abstract setupNavigationListener(): void;
    public abstract isVideoPage(url: string): boolean;
    public abstract getVideoId(url: string): string | null;

    /**
     * Main initialization method that sets up danmaku system for current video
     */
    public async initializeDanmaku(): Promise<void> {
        if (!this.videoId) {
            console.warn(`[${this.domain}] Cannot initialize: videoId is null`);
            return;
        }

        console.log(`[${this.domain}] Initializing for video: ${this.videoId}`);

        try {
            // Find video elements in parallel
            const [videoContainer, video] = await Promise.all([
                waitForElement(this.config.selectors.videoContainer),
                waitForElement(this.config.selectors.video)
            ]);

            if (!videoContainer || !video) {
                console.error(`[${this.domain}] Could not find required video elements`);
                return;
            }

            this.videoContainer = videoContainer as HTMLElement;
            this.videoPlayer = video as HTMLVideoElement;

            const wasInitialized = this.isInitialized;
            await this.initializeDanmakuCore();
            this.isInitialized = true;
            console.log(
                `[${this.domain}] Danmaku system ${wasInitialized ? "re-" : ""}initialized.`
            );
        } catch (error) {
            console.error(`[${this.domain}] Error during initialization:`, error);
        }
    }

    protected async initializeDanmakuCore(): Promise<void> {
        if (!this.videoId || !this.videoContainer || !this.videoPlayer) {
            console.error(`[${this.domain}] Missing required elements for initialization`);
            return;
        }

        const isReinitializing = this.isInitialized;
        console.log(
            `[${this.domain}] Core ${isReinitializing ? "re-" : ""}initialization for video: ${this.videoId}`
        );

        this.setupDanmakuContainer();
        this.resetDanmakuInstance();
        this.danmaku = new Danmaku(this.videoPlayer, this.danmakuContainer!);

        await this.setupEventListeners(this.videoPlayer);
        await this.initializeDanmakuInputs();

        if (this.videoPlayer.readyState < 1) {
            await this.onLoadedMetadata();
        }

        // Setup width observer after inputs are positioned
        this.setupVideoWidthObserver();
    }

    private setupDanmakuContainer(): void {
        if (!this.danmakuContainer || !this.danmakuContainer.isConnected) {
            this.danmakuContainer = document.createElement("div");
            this.danmakuContainer.classList.add("danmaku-container");
            this.videoContainer!.appendChild(this.danmakuContainer);
        } else if (this.danmakuContainer.parentElement !== this.videoContainer) {
            this.videoContainer!.appendChild(this.danmakuContainer);
        }
    }

    private resetDanmakuInstance(): void {
        if (this.danmaku) {
            this.danmaku.destroy();
            this.danmaku = null;
        }
    }

    protected abstract initializeDanmakuInputs(): Promise<void>;

    protected async waitForPlayer(): Promise<HTMLVideoElement | null> {
        for (let i = 0; i < PLAYER_WAIT_ATTEMPTS; i++) {
            const player = document.querySelector<HTMLVideoElement>(this.config.selectors.video);
            if (player) return player;
            await new Promise(resolve => setTimeout(resolve, PLAYER_WAIT_DELAY_MS));
        }
        return null;
    }

    public async setupEventListeners(videoPlayer: HTMLVideoElement): Promise<void> {
        this.resetAbortController(this.videoEventsAbortController);
        this.videoEventsAbortController = new AbortController();

        videoPlayer.addEventListener("loadedmetadata", this.onLoadedMetadata, {
            signal: this.videoEventsAbortController.signal
        });

        if (videoPlayer.readyState >= 1) {
            console.log(`[${this.domain}] Video metadata already loaded. Triggering comment load.`);
            await this.onLoadedMetadata();
        }
    }

    private resetAbortController(controller: AbortController | null): void {
        if (controller) {
            controller.abort();
        }
    }

    protected onLoadedMetadata = async (): Promise<void> => {
        if (this.isLoadingComments || !this.danmaku || !this.videoId) return;

        this.isLoadingComments = true;

        try {
            const { danmakuEnabled = true } = await chrome.storage.local.get(["danmakuEnabled"]);

            if (!danmakuEnabled) {
                console.log(`[${this.domain}] Danmaku disabled, skipping load.`);
                this.updateAllInputsStatus(false, 0);
                return;
            }

            if (this.danmaku.getCommentsCount > 0) {
                console.log(`[${this.domain}] Comments already loaded.`);
                this.updateAllInputsStatus(true, this.danmaku.getCommentsCount);
                return;
            }

            console.log(`[${this.domain}] Loading comments...`);
            const limit = this.calculateCommentLimit();

            const rawComments: RawComment[] | null = await getComments(
                this.domain,
                this.videoId!,
                limit,
                COMMENT_BUCKET_SIZE,
                MAX_COMMENTS_PER_BUCKET
            );

            this.processLoadedComments(rawComments);
        } catch (error) {
            console.error(`[${this.domain}] Error loading comments:`, error);
            this.updateAllInputsStatus(false, 0);
        } finally {
            this.isLoadingComments = false;
        }
    };

    private processLoadedComments(rawComments: RawComment[] | null): void {
        if (rawComments?.length) {
            console.log(`[${this.domain}] Loaded ${rawComments.length} comments.`);
            this.danmaku!.setComments(rawComments);
            this.updateAllInputsCount(rawComments.length);
        } else {
            console.log(`[${this.domain}] No comments received.`);
            this.danmaku!.setComments([]);
            this.updateAllInputsCount(0);
        }

        if (!this.danmaku!.videoPlayer.paused) {
            this.danmaku!.play();
        }
    }

    protected calculateCommentLimit(): number {
        if (!this.videoPlayer) return this.config.commentLimits.medium;

        const duration = this.videoPlayer.duration;
        if (duration < VIDEO_DURATION_THRESHOLDS.SHORT) return this.config.commentLimits.short;
        if (duration < VIDEO_DURATION_THRESHOLDS.MEDIUM) return this.config.commentLimits.medium;
        if (duration < VIDEO_DURATION_THRESHOLDS.LONG) return this.config.commentLimits.long;
        return this.config.commentLimits.veryLong;
    }

    protected updateAllInputsStatus(hasComments: boolean, count: number): void {
        this.danmakuInputRegular?.updateCommentsStatus(hasComments, count);
        this.danmakuInputFullscreen?.updateCommentsStatus(hasComments, count);
    }

    protected updateAllInputsCount(count: number): void {
        this.danmakuInputRegular?.updateCommentsCount(count);
        this.danmakuInputFullscreen?.updateCommentsCount(count);
    }

    /**
     * Synchronizes input text from source input to target input
     */
    protected syncInputText(sourceKey: "regular" | "fullscreen", targetKey: "regular" | "fullscreen"): void {
        const sourceInput = this.getInputInstance(sourceKey);
        const targetInput = this.getInputInstance(targetKey);

        if (!sourceInput || !targetInput) return;

        const sourceText = sourceInput.getInputText();
        const targetText = targetInput.getInputText();

        if (sourceText === targetText) return;

        targetInput.setInputText(sourceText);
        console.log(`[${this.domain}] Synced input text from ${sourceKey} to ${targetKey}: "${sourceText}"`);
    }

    protected handleFullscreenChange = (): void => {
        console.log(`[${this.domain}] Fullscreen change detected.`);
        const isFullscreen = !!document.fullscreenElement;
        const fullscreenContainer = this.danmakuInputFullscreen?.getContainer();

        fullscreenContainer?.classList.toggle("visible", isFullscreen);

        if (isFullscreen) {
            this.syncInputText("regular", "fullscreen");
            this.videoWidthObserver?.disconnect();
            console.log(`[${this.domain}] Video width observer disconnected for fullscreen.`);
        } else {
            this.syncInputText("fullscreen", "regular");
            this.setupVideoWidthObserver();
            console.log(`[${this.domain}] Video width observer reconnected after exiting fullscreen.`);
        }
    };

    /**
     * Clears input text from specified input instance
     */
    protected clearInputText(key: "regular" | "fullscreen"): void {
        this.getInputInstance(key)?.setInputText("");
    }

    private getInputInstance(key: "regular" | "fullscreen"): DanmakuInput | null {
        return key === "regular" ? this.danmakuInputRegular : this.danmakuInputFullscreen;
    }

    protected handleResize = (): void => {
        if (this.resizeDebounceTimeout !== null) {
            clearTimeout(this.resizeDebounceTimeout);
        }

        this.resizeDebounceTimeout = window.setTimeout(() => {
            this.performResize();
            this.resizeDebounceTimeout = null;
        }, RESIZE_DEBOUNCE_MS);
    };

    private performResize(): void {
        if (!this.videoPlayer) return;

        const width = this.videoPlayer.clientWidth;
        console.log(`[${this.domain}] Handling resize, video width: ${width}`);

        const danmakuInputRegularContainer = this.danmakuInputRegular?.getContainer();
        if (danmakuInputRegularContainer) {
            danmakuInputRegularContainer.style.maxWidth = `${width}px`;
        }
    }

    protected setupVideoWidthObserver(): void {
        if (!this.videoPlayer) return;

        this.videoWidthObserver?.disconnect();
        this.videoWidthObserver = new ResizeObserver(this.handleResize);
        this.videoWidthObserver.observe(this.videoPlayer);
        console.log(`[${this.domain}] Video width observer set up.`);

        // Trigger initial resize immediately
        this.handleResize();
    }

    public destroy(): void {
        console.log(`[${this.domain}] Destroying`);

        // Abort all controllers
        this.videoEventsAbortController?.abort();
        this.viewModeAbortController?.abort();
        this.navigationAbortController.abort();

        // Clean up timers
        this.clearTimer(this.resizeDebounceTimeout);

        // Disconnect observers
        this.videoWidthObserver?.disconnect();

        // Destroy danmaku
        this.danmaku?.destroy();

        // Remove DOM elements
        this.danmakuContainer?.remove();
        this.danmakuInputRegular?.destroy();
        this.danmakuInputFullscreen?.destroy();

        // Clear references
        this.clearReferences();

        console.log(`[${this.domain}] Destroyed.`);
    }

    private clearTimer(timerId: number | null): void {
        if (timerId !== null) {
            clearTimeout(timerId);
        }
    }

    private clearReferences(): void {
        this.videoPlayer = null;
        this.videoContainer = null;
        this.videoId = null;
        this.danmaku = null;
        this.danmakuContainer = null;
        this.danmakuInputRegular = null;
        this.danmakuInputFullscreen = null;
        this.videoEventsAbortController = null;
        this.viewModeAbortController = null;
        this.videoWidthObserver = null;
        this.isInitialized = false;
    }

    public async getCurrentTime(): Promise<number> {
        return this.videoPlayer ? this.videoPlayer.currentTime * 1000 : 0;
    }

    /**
     * Sets the video ID for the adapter
     * @param videoId The video ID to set
     */
    public setVideoId(videoId: string | null): void {
        this.videoId = videoId;
    }

    /**
     * Gets the current video ID
     */
    public getVideoIdFromAdapter(): string | null {
        return this.videoId;
    }
}