// crunchyroll.ts - Optimized architecture for main window and iframe

import { getComments, Comment } from "../api";
import danmakuInputCss from "../css/danmaku-input.css?raw";
import danmakuCss from "../css/danmaku.css?raw";
import crunchyrollCss from "../css/sites/crunchyroll.css?raw";
import { Danmaku } from "../danmaku/danmaku";
import { DanmakuInput } from "../danmaku/danmakuInput";
import { PageStatusMessage, RawComment, GetCurrentTimeMessage } from "../interfaces/danmaku";
import { SiteAdapter, BaseSiteAdapter, SiteConfig } from "../interfaces/SiteAdapter";
import { waitForElement } from "../utils/utils";
import { LoginModal } from "../modal-login/modal-login";
import { DensityMode } from "../interfaces/enum";

const SELECTORS = {
    VIDEO_CONTAINER: "#vilos",
    VIDEO: "video",
    DANMAKU_INPUT_DEFAULT: ".video-player-wrapper",
    DANMAKU_INPUT_FULLSCREEN: "[data-testid=\"vilos-volume_container\"]",
    PREMIUM_FREE_TRIAL_BANNER: ".banner-wrapper",
    IFRAME: 'iframe[src*="crunchyroll.com"]',
    BELOW_PLAYER: ".body-wrapper",
} as const;

const COMMENT_LIMITS = {
    short: 400,      // < 60s
    medium: 1000,    // < 300s
    long: 16000,     // < 1800s
    veryLong: 32000, // >= 1800s
} as const;

export class CrunchyrollAdapter extends BaseSiteAdapter implements SiteAdapter {
    public readonly domain: string = "crunchyroll";
    public readonly isIframe: boolean = window !== window.top;

    protected readonly config: SiteConfig = {
        selectors: {
            videoContainer: SELECTORS.VIDEO_CONTAINER,
            video: SELECTORS.VIDEO,
        },
        commentLimits: COMMENT_LIMITS,
    };

    // Main window specific
    private iframe: HTMLIFrameElement | null = null;
    private iframeReady: boolean = false;
    private currentTimeResolvers: Map<number, (time: number) => void> = new Map();
    private currentTimeRequestId: number = 0;
    private danmakuInputInstance: DanmakuInput | null = null;

    // Shared elements
    private danmakuInputDefaultParent: HTMLElement | null = null;
    private danmakuInputFullscreenParent: HTMLElement | null = null;
    private premiumFreeTrialBanner: HTMLElement | null = null;
    private iframeWaitAbortController: AbortController | null = null;

    constructor() {
        super(/watch\/([^\/]+)/);
        this.injectCSS();
        this.setupMessageListener();
        
        if (!this.isIframe) {
            this.setupNavigationListener();
        }
        
        console.log(`[${this.domain}] Adapter constructed in ${this.isIframe ? "iframe" : "main"}`);
    }

    // ========================================
    // Initialization
    // ========================================

    public async initializeDanmaku(): Promise<void> {
        if (!this.videoId) return;

        console.log(`[${this.domain}] Initializing for video: ${this.videoId} (${this.isIframe ? "iframe" : "main"})`);

        if (this.isIframe) {
            await this.initializeIframe();
        } else {
            await this.initializeMain();
        }
    }

    private async initializeIframe(): Promise<void> {
        // Find video elements
        const [videoPlayer, videoContainer] = await Promise.all([
            waitForElement(this.config.selectors.video),
            waitForElement(this.config.selectors.videoContainer),
        ]);

        if (!videoPlayer || !videoContainer) {
            console.error(`[${this.domain}] Could not find required video elements`);
            return;
        }

        this.videoPlayer = videoPlayer as HTMLVideoElement;
        this.videoContainer = videoContainer as HTMLElement;

        // Setup danmaku container
        if (!this.danmakuContainer?.isConnected) {
            this.danmakuContainer = document.createElement("div");
            this.danmakuContainer.classList.add("danmaku-container");
            this.videoContainer.appendChild(this.danmakuContainer);
        }

        // Cleanup old instance
        this.danmaku?.destroy();

        // Create new danmaku instance
        this.danmaku = new Danmaku(this.videoPlayer, this.danmakuContainer);
        this.videoPlayer.addEventListener('loadedmetadata', this.onLoadedMetadata);

        // Setup inputs
        await this.initializeDanmakuInputs();
    }

    private async initializeMain(): Promise<void> {
        this.startIframeDiscoveryTask();
        await this.initializeDanmakuInputs();
    }

    private startIframeDiscoveryTask(): void {
        this.iframeWaitAbortController?.abort();
        const controller = new AbortController();
        this.iframeWaitAbortController = controller;

        if (this.iframe?.isConnected && this.videoId) {
            this.notifyIframe(this.videoId, true);
            return;
        }

        const expectedVideoId = this.videoId;

        void (async () => {
            const iframe = await this.waitForIframe(controller.signal);
            if (controller.signal.aborted) return;

            if (!iframe) {
                console.error(`[${this.domain}] Could not find iframe`);
                return;
            }

            this.iframe = iframe;

            if (expectedVideoId && expectedVideoId === this.videoId) {
                this.notifyIframe(expectedVideoId, true);
            }
        })();
    }

    protected async initializeDanmakuInputs(): Promise<void> {
        console.log(`[${this.domain}] Initializing danmaku inputs (${this.isIframe ? "iframe" : "main"})`);

        // Fetch parent elements
        await this.getDanmakuInputElements();

        if (this.isIframe) {
            await this.setupIframeInput();
        } else {
            await this.setupMainInput();
        }

        this.setupViewModeListeners();
    }

    // ========================================
    // Input Setup
    // ========================================

    private async setupIframeInput(): Promise<void> {
        if (!this.videoPlayer || !this.danmaku || !this.videoId) return;

        // Create or update fullscreen input
        if (!this.danmakuInputFullscreen) {
            this.danmakuInputFullscreen = new DanmakuInput(
                this, 
                this.danmaku, 
                this.loginModal, 
                this.videoId
            );
            const container = this.danmakuInputFullscreen.init();
            container.classList.add("danmaku-input-fullscreen");
            this.attachInputToDOM(container, "fullscreen");
        } else {
            this.danmakuInputFullscreen.updateVideoId(this.videoId);
            const container = this.danmakuInputFullscreen.getContainer();
            if (container && !container.parentElement) {
                this.attachInputToDOM(container, "fullscreen");
            }
        }
    }

    private async setupMainInput(): Promise<void> {
        if (!this.videoId) return;

        const danmakuProxy = this.createDanmakuProxy();

        // Create or update regular input
        if (!this.danmakuInputInstance) {
            this.danmakuInputInstance = new DanmakuInput(
                this, 
                danmakuProxy as any, 
                this.loginModal, 
                this.videoId
            );
            this.danmakuInputRegular = this.danmakuInputInstance;

            const container = this.danmakuInputInstance.init();
            await this.attachInputToDOM(container, "regular");
            this.isInitialized = true;
        } else {
            this.danmakuInputInstance.updateVideoId(this.videoId);
            this.danmakuInputRegular = this.danmakuInputInstance;

            const container = this.danmakuInputInstance.getContainer();
            if (container && !container.parentElement) {
                await this.attachInputToDOM(container, "regular");
            }
        }
    }

    private async attachInputToDOM(container: HTMLElement, type: "regular" | "fullscreen"): Promise<void> {
        if (type === "fullscreen") {
            const parent = this.danmakuInputFullscreenParent || this.videoContainer;
            if (parent && !container.parentElement) {
                if (this.danmakuInputFullscreenParent) {
                    this.danmakuInputFullscreenParent.insertAdjacentElement('afterend', container);
                } else {
                    parent.appendChild(container);
                }
                container.classList.add('visible');
            }
        } else {
            // For main window, attach to page
            if (this.isIframe) return;

            if (this.premiumFreeTrialBanner) {
                this.premiumFreeTrialBanner.insertAdjacentElement('beforebegin', container);
                container.classList.add('visible');
                return;
            }
            const belowPlayer = await waitForElement(SELECTORS.BELOW_PLAYER);
            if (belowPlayer && !container.parentElement) {
                belowPlayer.prepend(container);
                container.classList.add('visible');
            }
        }
    }

    // ========================================
    // Element Queries
    // ========================================

    private async getDanmakuInputElements(): Promise<void> {
        if (this.isIframe) {
            this.danmakuInputFullscreenParent = await waitForElement(SELECTORS.DANMAKU_INPUT_FULLSCREEN) as HTMLElement;
            return;
        }

        // Parallel fetch for better performance
        const [defaultParent, fullscreenParent, premiumBanner] = await Promise.all([
            waitForElement(SELECTORS.DANMAKU_INPUT_DEFAULT),
            waitForElement(SELECTORS.DANMAKU_INPUT_FULLSCREEN),
            waitForElement(SELECTORS.PREMIUM_FREE_TRIAL_BANNER),
        ]);

        this.danmakuInputDefaultParent = defaultParent as HTMLElement | null;
        this.danmakuInputFullscreenParent = fullscreenParent as HTMLElement | null;
        this.premiumFreeTrialBanner = premiumBanner as HTMLElement | null;
    }

    private async waitForIframe(signal?: AbortSignal): Promise<HTMLIFrameElement | null> {
        const maxAttempts = 100;
        const delayMs = 100;

        for (let i = 0; i < maxAttempts; i++) {
            if (signal?.aborted) return null;
            const iframe = document.querySelector<HTMLIFrameElement>(SELECTORS.IFRAME);
            if (iframe) return iframe;
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        return document.querySelector<HTMLIFrameElement>(SELECTORS.IFRAME);
    }

    // ========================================
    // Message Handling
    // ========================================

    private setupMessageListener(): void {
        window.addEventListener('message', this.handleMessage);
        
        if (this.isIframe) {
            window.parent.postMessage({ 
                type: 'IFRAME_READY', 
                timestamp: Date.now() 
            }, '*');
        }
    }

    private handleMessage = (event: MessageEvent): void => {
        const { type, ...data } = event.data;

        if (this.isIframe) {
            if (event.source !== window.parent) return;
            this.handleIframeMessage(type, data);
        } else {
            this.handleMainMessage(type, data);
        }
    };

    private handleIframeMessage(type: string, data: any): void {
        const handlers: Record<string, () => void> = {
            'PAGE_STATUS': () => this.handlePageStatusMessage(data as PageStatusMessage),
            'ADD_COMMENT': () => this.handleAddComment(data.comment),
            'TOGGLE_VISIBILITY': () => this.handleToggleVisibility(data.force),
            'GET_CURRENT_TIME': () => this.handleGetCurrentTime(data.requestId),
            'SET_SPEED': () => this.handleSetSpeed(data.speed),
            'SET_DENSITY': () => this.handleSetDensity(data.density),
            'SET_OPACITY': () => this.handleSetOpacity(data.opacity),
            'SET_FONT_SIZE': () => this.handleSetFontSize(data.fontSize),
        };

        handlers[type]?.();
    }

    private handleMainMessage(type: string, data: any): void {
        const handlers: Record<string, () => void> = {
            'IFRAME_READY': () => {
                console.log(`[${this.domain}] Iframe ready`);
                this.iframeReady = true;
                if (this.videoId) this.notifyIframe(this.videoId, true);
            },
            'DANMAKU_STATUS': () => {
                this.danmakuInputInstance?.updateCommentsStatus(
                    data.commentsEnabled,
                    data.commentsCount
                );
            },
            'CURRENT_TIME_RESPONSE': () => {
                const resolver = this.currentTimeResolvers.get(data.requestId);
                if (resolver) {
                    resolver(data.currentTime);
                    this.currentTimeResolvers.delete(data.requestId);
                }
            },
        };

        handlers[type]?.();
    }

    private handlePageStatusMessage(message: PageStatusMessage): void {
        console.log(`[${this.domain}] Received page status:`, message);

        if (message.isVideoPage && message.videoId) {
            if (this.videoId !== message.videoId) {
                console.log(`[${this.domain}] New video: ${message.videoId}`);
                this.videoId = message.videoId;
                this.initializeDanmaku();
            }
        } else if (this.isInitialized) {
            console.log(`[${this.domain}] Not a video page, destroying`);
            this.destroy();
        }
    }

    private handleAddComment(comment: Comment): void {
        if (!this.danmaku) {
            console.warn(`[${this.domain}] Cannot add comment - danmaku not initialized`);
            return;
        }

        this.danmaku.addComment(comment);
        this.sendDanmakuStatus(true, this.danmaku.getCommentsCount);
    }

    private handleToggleVisibility(force?: boolean): void {
        if (!this.danmaku) {
            console.warn(`[${this.domain}] Cannot toggle visibility - danmaku not initialized`);
            return;
        }

        const isVisible = this.danmaku.toggleVisibility(force);
        this.sendDanmakuStatus(isVisible, this.danmaku.getCommentsCount);
    }

    private handleSetSpeed(speed: number): void {
        if (!this.danmaku) {
            console.warn(`[${this.domain}] Cannot set speed - danmaku not initialized`);
            return;
        }
        this.danmaku.setSpeed(speed);
    }

    private handleSetDensity(density: DensityMode): void {
        if (!this.danmaku) {
            console.warn(`[${this.domain}] Cannot set density - danmaku not initialized`);
            return;
        }
        this.danmaku.setDensity(density);
    }

    private handleSetOpacity(opacity: number): void {
        if (!this.danmaku) {
            console.warn(`[${this.domain}] Cannot set opacity - danmaku not initialized`);
            return;
        }
        this.danmaku.setOpacity(opacity);
    }

    private handleSetFontSize(fontSize: number): void {
        if (!this.danmaku) {
            console.warn(`[${this.domain}] Cannot set font size - danmaku not initialized`);
            return;
        }
        this.danmaku.setFontSize(fontSize);
    }

    private handleGetCurrentTime(requestId: number): void {
        const currentTime = this.videoPlayer?.currentTime || 0;
        const duration = this.videoPlayer?.duration || 0;

        window.parent.postMessage({
            type: 'CURRENT_TIME_RESPONSE',
            requestId,
            currentTime,
            duration,
            timestamp: Date.now()
        }, '*');
    }

    private sendDanmakuStatus(enabled: boolean, count: number): void {
        window.parent.postMessage({
            type: 'DANMAKU_STATUS',
            commentsEnabled: enabled,
            commentsCount: count,
            timestamp: Date.now()
        }, '*');
    }

    // ========================================
    // Iframe Communication
    // ========================================

    private notifyIframe(videoId: string | null, isVideo: boolean): void {
        if (!this.iframe?.contentWindow) {
            console.warn(`[${this.domain}] Iframe not ready for message`);
            return;
        }

        const message: PageStatusMessage = {
            type: 'PAGE_STATUS',
            videoId,
            isVideoPage: isVideo,
            timestamp: Date.now()
        };

        this.iframe.contentWindow.postMessage(message, '*');
        console.log(`[${this.domain}] Sent page status to iframe:`, message);
    }

    private createDanmakuProxy(): any {
        let commentsCount = 0;

        return {
            get getCommentsCount() {
                return commentsCount;
            },
            setComments: (comments: RawComment[]) => {
                commentsCount = comments.length;
            },
            addComment: (comment: Comment) => {
                commentsCount++;
                this.iframe?.contentWindow?.postMessage({
                    type: 'ADD_COMMENT',
                    comment,
                    timestamp: Date.now()
                }, '*');
            },
            toggleVisibility: (force?: boolean) => {
                this.iframe?.contentWindow?.postMessage({
                    type: 'TOGGLE_VISIBILITY',
                    force,
                    timestamp: Date.now()
                }, '*');
                return force ?? true;
            },
            setSpeed: (speed: number) => {
                this.iframe?.contentWindow?.postMessage({
                    type: 'SET_SPEED',
                    speed,
                    timestamp: Date.now()
                }, '*');
            },
            setDensity: (density: DensityMode) => {
                this.iframe?.contentWindow?.postMessage({
                    type: 'SET_DENSITY',
                    density,
                    timestamp: Date.now()
                }, '*');
            },
            setOpacity: (opacity: number) => {
                this.iframe?.contentWindow?.postMessage({
                    type: 'SET_OPACITY',
                    opacity,
                    timestamp: Date.now()
                }, '*');
            },
            setFontSize: (fontSize: number) => {
                this.iframe?.contentWindow?.postMessage({
                    type: 'SET_FONT_SIZE',
                    fontSize,
                    timestamp: Date.now()
                }, '*');
            },
            destroy: () => {
                commentsCount = 0;
            }
        };
    }

    public async getCurrentTime(): Promise<number> {
        if (this.isIframe) {
            return this.videoPlayer?.currentTime || 0;
        }

        if (!this.iframe?.contentWindow) {
            console.warn(`[${this.domain}] Cannot get current time - iframe not available`);
            return 0;
        }

        return new Promise((resolve) => {
            const requestId = ++this.currentTimeRequestId;
            this.currentTimeResolvers.set(requestId, resolve);

            this.iframe!.contentWindow!.postMessage({
                type: 'GET_CURRENT_TIME',
                requestId,
                timestamp: Date.now()
            } as GetCurrentTimeMessage, '*');

            setTimeout(() => {
                if (this.currentTimeResolvers.delete(requestId)) {
                    resolve(0);
                }
            }, 1000);
        });
    }

    // ========================================
    // Comment Loading
    // ========================================

    protected onLoadedMetadata = async (): Promise<void> => {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) {
            console.warn(`[${this.domain}] Chrome storage API not available`);
            return;
        }

        try {
            chrome.storage.local.get(["danmakuEnabled"], async (result) => {
                if (!this.danmaku || !this.videoId || !this.videoPlayer) return;

                const danmakuEnabled = result.danmakuEnabled ?? true;

                if (!danmakuEnabled) {
                    console.log(`[${this.domain}] Danmaku disabled`);
                    this.sendDanmakuStatus(false, 0);
                    return;
                }

                if (this.danmaku.getCommentsCount > 0) {
                    console.log(`[${this.domain}] Comments already loaded`);
                    this.sendDanmakuStatus(true, this.danmaku.getCommentsCount);
                    return;
                }

                console.log(`[${this.domain}] Loading comments from API`);
                await this.loadComments();

                if (!this.videoPlayer.paused) {
                    this.danmaku.play();
                }
            });
        } catch (error) {
            console.error(`[${this.domain}] Error in onLoadedMetadata:`, error);
        }
    };

    protected async loadComments(): Promise<void> {
        const duration = this.videoPlayer?.duration || 0;
        const limit = this.calculateCommentLimit();
        const bucketSize = 5;
        const maxCommentsPerBucket = 50;

        const rawComments = await getComments(
            this.domain,
            this.videoId!,
            limit,
            bucketSize,
            maxCommentsPerBucket
        );

        const count = rawComments?.length || 0;
        console.log(`[${this.domain}] Loaded ${count} comments`);

        this.danmaku?.setComments(rawComments || []);
        this.sendDanmakuStatus(true, count);
    }

    // ========================================
    // Navigation & View Modes
    // ========================================

    protected setupNavigationListener(): void {
        const observer = new MutationObserver(() => this.handleNavigation());
        observer.observe(document.body, { childList: true, subtree: true });
    }

    private setupViewModeListeners(): void {
        if (this.isIframe) return;

        this.viewModeAbortController?.abort();
        this.viewModeAbortController = new AbortController();

        document.addEventListener(
            "fullscreenchange", 
            this.handleFullscreenChange, 
            { signal: this.viewModeAbortController.signal, passive: true }
        );
    }

    private handleNavigation(): void {
        const newVideoId = this.getVideoId(window.location.href);
        const isVideo = this.isVideoPage(window.location.href);

        if (isVideo && newVideoId && this.videoId !== newVideoId) {
            console.log(`[${this.domain}] Navigation detected: ${newVideoId}`);
            this.videoId = newVideoId;
            this.initializeDanmaku();
        } else if (!isVideo && this.videoId) {
            console.log(`[${this.domain}] Navigated away from video page`);
            this.destroy();
            this.videoId = null;
        }
    }

    // ========================================
    // Utilities
    // ========================================

    protected injectCSS(): void {
        if (document.querySelector('[data-extension="videodanmaku-css"]')) return;

        const style = document.createElement("style");
        style.setAttribute("data-extension", "videodanmaku-css");
        style.textContent = this.isIframe 
            ? danmakuCss + crunchyrollCss 
            : danmakuCss + danmakuInputCss + crunchyrollCss;
        document.head.appendChild(style);
        
        console.log(`[${this.domain}] CSS injected in ${this.isIframe ? "iframe" : "main"}`);
    }

    public isVideoPage(url: string): boolean {
        return !!url && url.includes("watch");
    }

    public getVideoId(url: string): string | null {
        if (!url) return null;
        const match = url.match(this.videoIdRegex);
        return match?.[1] ?? null;
    }

    public setVideoId(videoId: string | null): void {
        this.videoId = videoId;
    }

    public getVideoIdFromAdapter(): string | null {
        return this.videoId;
    }

    // ========================================
    // Cleanup
    // ========================================

    public destroy(): void {
        console.log(`[${this.domain}] Destroying`);
        this.iframeWaitAbortController?.abort();
        this.iframeWaitAbortController = null;

        // Clear references
        this.danmakuInputDefaultParent = null;
        this.danmakuInputFullscreenParent = null;
        this.premiumFreeTrialBanner = null;

        this.viewModeAbortController?.abort();
        this.viewModeAbortController = null;

        if (this.isIframe) {
            this.videoPlayer?.removeEventListener('loadedmetadata', this.onLoadedMetadata);
            this.danmakuContainer?.remove();
            this.danmakuInputFullscreen?.destroy();
            this.danmakuInputFullscreen = null;
        } else {
            this.notifyIframe(null, false);
            this.danmakuInputInstance?.destroy();
            this.danmakuInputInstance = null;
            this.danmakuInputRegular = null;
            this.isInitialized = false;
        }

        // Call parent destroy
        super.destroy();
    }
}