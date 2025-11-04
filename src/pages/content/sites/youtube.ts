import { getComments } from "../api";
import danmakuInputCss from "../css/danmaku-input.css?raw";
import danmakuCss from "../css/danmaku.css?raw";
import youtubeCss from "../css/sites/youtube.css?raw";
import { DanmakuInput } from "../danmaku/danmakuInput";
import { SiteAdapter, BaseSiteAdapter, SiteConfig } from "../interfaces/SiteAdapter";
import { waitForElement } from "../utils/utils";

const SELECTORS = {
    VIDEO_CONTAINER: ".html5-video-player",
    VIDEO: "#movie_player video",
    YTD_WATCH_FLEXY: "ytd-watch-flexy",
    DANMAKU_INPUT_DEFAULT: "#player.style-scope.ytd-watch-flexy",
    DANMAKU_INPUT_THEATER: "#full-bleed-container",
    DANMAKU_INPUT_FULLSCREEN: ".ytp-left-controls",
} as const;

interface YouTubeElements {
    ytdWatchFlexy: HTMLElement | null;
    defaultParent: HTMLElement | null;
    theaterParent: HTMLElement | null;
    fullscreenParent: HTMLElement | null;
}

export class YouTubeAdapter extends BaseSiteAdapter implements SiteAdapter {
    public readonly domain: string = "youtube";
    
    protected readonly config: SiteConfig = {
        selectors: {
            videoContainer: SELECTORS.VIDEO_CONTAINER,
            video: SELECTORS.VIDEO,
        },
        commentLimits: {
            short: 400,
            medium: 1000,
            long: 16000,
            veryLong: 32000,
        },
    };

    // Cached YouTube-specific elements
    private elements: YouTubeElements = {
        ytdWatchFlexy: null,
        defaultParent: null,
        theaterParent: null,
        fullscreenParent: null,
    };
    
    private theaterModeObserver: MutationObserver | null = null;
    private isTheaterMode: boolean = false;

    constructor() {
        super(/[?&]v=([^&]+)/);
        this.injectCSS();
        this.setupNavigationListener();
        console.log(`[${this.domain}] Adapter constructed.`);
    }

    // ========================================
    // Initialization
    // ========================================

    protected injectCSS(): void {
        if (document.querySelector('[data-extension="videodanmaku-css"]')) return;
        
        const style = document.createElement("style");
        style.setAttribute("data-extension", "videodanmaku-css");
        style.textContent = danmakuCss + danmakuInputCss + youtubeCss;
        document.head.appendChild(style);
        console.log(`[${this.domain}] CSS injected.`);
    }

    protected setupNavigationListener(): void {
        this.addAbortableListener(
            document, 
            "yt-navigate-finish", 
            () => this.handleNavigation(),
            this.navigationAbortController,
            { passive: true }
        );
    }

    protected async initializeDanmakuInputs(): Promise<void> {
        // Fetch all required elements in parallel
        await this.cacheYouTubeElements();

        // Create or update inputs
        this.ensureDanmakuInputs();

        // Position inputs based on current view mode
        this.updateInputPositions();

        // Calculate initial width after positioning
        this.handleResize();

        // Setup listeners
        this.setupViewModeListeners();
    }

    // ========================================
    // Element Management
    // ========================================

    private async cacheYouTubeElements(): Promise<void> {
        const [ytdWatchFlexy, defaultParent, theaterParent, fullscreenParent] = await Promise.all([
            waitForElement(SELECTORS.YTD_WATCH_FLEXY),
            waitForElement(SELECTORS.DANMAKU_INPUT_DEFAULT),
            waitForElement(SELECTORS.DANMAKU_INPUT_THEATER),
            waitForElement(SELECTORS.DANMAKU_INPUT_FULLSCREEN),
        ]);

        this.elements = {
            ytdWatchFlexy: ytdWatchFlexy as HTMLElement | null,
            defaultParent: defaultParent as HTMLElement | null,
            theaterParent: theaterParent as HTMLElement | null,
            fullscreenParent: fullscreenParent as HTMLElement | null,
        };

        // Cache theater mode state
        this.isTheaterMode = this.elements.ytdWatchFlexy?.hasAttribute('theater') ?? false;
    }

    private ensureDanmakuInputs(): void {
        if (!this.danmaku || !this.videoId) return;

        // Regular input
        if (!this.danmakuInputRegular) {
            this.danmakuInputRegular = new DanmakuInput(
                this, 
                this.danmaku, 
                this.loginModal, 
                this.videoId
            );
            this.danmakuInputRegular.init();
        } else {
            this.danmakuInputRegular.updateVideoId(this.videoId);
        }

        // Fullscreen input
        if (!this.danmakuInputFullscreen) {
            this.danmakuInputFullscreen = new DanmakuInput(
                this, 
                this.danmaku, 
                this.loginModal, 
                this.videoId
            );
            const container = this.danmakuInputFullscreen.init();
            container.classList.add("danmaku-input-fullscreen");
        } else {
            this.danmakuInputFullscreen.updateVideoId(this.videoId);
        }
    }

    private updateInputPositions(): void {
        const regularContainer = this.danmakuInputRegular?.getContainer();
        const fullscreenContainer = this.danmakuInputFullscreen?.getContainer();

        if (!regularContainer || !fullscreenContainer) return;

        // Position fullscreen input
        const fullscreenParent = this.elements.fullscreenParent;
        if (fullscreenParent && !fullscreenContainer.parentElement) {
            fullscreenParent.insertAdjacentElement('afterend', fullscreenContainer);
        }

        // Position regular input based on theater mode
        this.positionRegularInput(regularContainer);
    }

    private positionRegularInput(container: HTMLElement): void {
        const parent = this.isTheaterMode 
            ? this.elements.theaterParent 
            : this.elements.defaultParent;

        if (!parent) {
            console.warn(`[${this.domain}] No valid parent found for input.`);
            return;
        }

        // Only move if needed
        const needsMove = !container.parentElement || 
                         container.previousElementSibling !== parent;

        if (needsMove) {
            container.remove();
            parent.insertAdjacentElement('afterend', container);
        }

        container.classList.add('visible');
    }

    // ========================================
    // View Mode Handling
    // ========================================

    private setupViewModeListeners(): void {
        this.viewModeAbortController?.abort();
        this.viewModeAbortController = new AbortController();

        // Fullscreen changes
        this.addAbortableListener(
            document, 
            "fullscreenchange", 
            this.handleFullscreenChange,
            this.viewModeAbortController,
            { passive: true }
        );

        // Theater mode events
        this.addAbortableListener(
            document,
            "yt-set-theater-mode-enabled",
            (event: Event) => {
                const isTheater = Boolean((event as CustomEvent).detail?.enabled);
                this.handleTheaterModeChange(isTheater);
            },
            this.viewModeAbortController,
            { passive: true }
        );

        // Watch for attribute changes on ytd-watch-flexy
        this.observeTheaterMode();
    }

    private observeTheaterMode(): void {
        this.theaterModeObserver?.disconnect();

        const target = this.elements.ytdWatchFlexy;
        if (!target) return;

        this.theaterModeObserver = new MutationObserver(() => {
            const isTheater = target.hasAttribute('theater');
            if (isTheater !== this.isTheaterMode) {
                this.handleTheaterModeChange(isTheater);
            }
        });

        this.theaterModeObserver.observe(target, {
            attributes: true,
            attributeFilter: ['theater']
        });
    }

    private handleTheaterModeChange(isTheater: boolean): void {
        if (this.isTheaterMode === isTheater) return;
        
        console.log(`[${this.domain}] Theater mode: ${isTheater}`);
        this.isTheaterMode = isTheater;

        const container = this.danmakuInputRegular?.getContainer();
        if (container) {
            this.positionRegularInput(container);
            this.handleResize();
        }
    }

    // ========================================
    // Navigation
    // ========================================

    private handleNavigation(): void {
        const newVideoId = this.getVideoId(window.location.href);
        const isVideo = this.isVideoPage(window.location.href);
        
        if (isVideo && newVideoId && this.videoId !== newVideoId) {
            console.log(`[${this.domain}] Navigation to video: ${newVideoId}`);
            this.videoId = newVideoId;
            this.initializeDanmaku();
        } else if (!isVideo && this.videoId) {
            console.log(`[${this.domain}] Navigated away from video`);
            this.destroy();
            this.videoId = null;
        }
    }

    // ========================================
    // Public Interface
    // ========================================

    public isVideoPage(url: string): boolean {
        return !!url && url.includes("watch");
    }

    public getVideoId(url: string): string | null {
        if (!url) return null;
        const match = url.match(this.videoIdRegex);
        return match?.[1] ?? null;
    }

    public destroy(): void {
        console.log(`[${this.domain}] Destroying adapter`);

        // Clear cached elements
        this.elements = {
            ytdWatchFlexy: null,
            defaultParent: null,
            theaterParent: null,
            fullscreenParent: null,
        };

        // Cleanup observers
        this.theaterModeObserver?.disconnect();
        this.theaterModeObserver = null;

        this.viewModeAbortController?.abort();
        this.viewModeAbortController = null;

        // Call parent destroy
        super.destroy();
    }

    // ========================================
    // Utilities
    // ========================================

    private addAbortableListener(
        target: EventTarget,
        type: string,
        listener: EventListenerOrEventListenerObject,
        controller: AbortController,
        options?: AddEventListenerOptions
    ): void {
        if (controller.signal.aborted) return;
        
        target.addEventListener(type, listener, {
            ...options,
            signal: controller.signal
        });
    }
}
