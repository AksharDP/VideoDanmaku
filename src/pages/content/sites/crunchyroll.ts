// crunchyroll.ts - Split architecture for main window and iframe

import { getComments } from "../api";
import danmakuInputCss from "../css/danmaku-input.css?raw";
import danmakuCss from "../css/danmaku.css?raw";
import crunchyrollCss from "../css/sites/crunchyroll.css?raw";
import { Danmaku } from "../danmaku/danmaku";
import { DanmakuInput } from "../danmaku/danmakuInput";
import { PageStatusMessage, RawComment } from "../interfaces/danmaku";
import { SiteAdapter } from "../interfaces/SiteAdapter";
import { LoginModal } from "../modal-login/modal-login";
import { waitForElement } from "../utils/utils";

// ============= IFRAME ADAPTER (runs inside the iframe) =============
// Handles ONLY danmaku display - no input UI

export class CrunchyrollIframeAdapter implements SiteAdapter {
  public readonly domain: string = "crunchyroll";
  private videoPlayerSelector: string = "video";
  private videoContainerSelector: string = "#vilos";

  public isInitialized: boolean = false;
  private videoId: string | null = null;
  private danmaku: Danmaku | null = null;
  private videoContainer: HTMLElement | null = null;
  private videoPlayer: HTMLVideoElement | null = null;
  private danmakuContainer: HTMLDivElement | null = null;
  private messageListenerBound: boolean = false;

  constructor() {
    this.injectCSS();
    console.log("[CrunchyrollIframeAdapter] Constructed in iframe");

    if (!this.messageListenerBound) {
      this.setupMessageListener();
      this.messageListenerBound = true;
    }
  }

  private injectCSS(): void {
    if (document.querySelector('[data-extension="videodanmaku-css-iframe"]')) {
      return;
    }

    const style = document.createElement("style");
    style.setAttribute("data-extension", "videodanmaku-css-iframe");
    style.textContent = danmakuCss + crunchyrollCss;
    document.head.appendChild(style);
    console.log("[CrunchyrollIframeAdapter] CSS injected in iframe");
  }

  private setupMessageListener(): void {
    window.addEventListener('message', (event: MessageEvent) => {
      // Only accept messages from parent window
      if (event.source !== window.parent) return;

      const message = event.data;

      if (message.type === 'PAGE_STATUS') {
        this.handlePageStatusMessage(message as PageStatusMessage);
      } else if (message.type === 'ADD_COMMENT') {
        this.handleAddComment(message.comment);
      } else if (message.type === 'TOGGLE_VISIBILITY') {
        this.handleToggleVisibility(message.force);
      } else if (message.type === 'GET_CURRENT_TIME') {
        this.handleGetCurrentTime(message.requestId);
      }
    });
    console.log("[CrunchyrollIframeAdapter] Message listener set up in iframe");

    // Notify parent that iframe is ready to receive messages
    window.parent.postMessage({ type: 'IFRAME_READY', timestamp: Date.now() }, '*');
    console.log("[CrunchyrollIframeAdapter] Sent IFRAME_READY to parent");
  }

  private handleGetCurrentTime(requestId: number): void {
    const currentTime = this.videoPlayer ? this.videoPlayer.currentTime : 0;
    window.parent.postMessage({
      type: 'CURRENT_TIME_RESPONSE',
      requestId,
      currentTime,
      timestamp: Date.now()
    }, '*');
  }

  private handleAddComment(comment: RawComment): void {
    if (!this.danmaku) {
      console.warn("[CrunchyrollIframeAdapter] Cannot add comment - danmaku not initialized");
      return;
    }
    console.log("[CrunchyrollIframeAdapter] Adding comment from main window:", comment);
    this.danmaku.addComment(comment);
    
    // Send updated count back to main window
    window.parent.postMessage({
      type: 'DANMAKU_STATUS',
      commentsEnabled: true,
      commentsCount: this.danmaku.getCommentsCount,
      timestamp: Date.now()
    }, '*');
  }

  private handleToggleVisibility(force?: boolean): void {
    if (!this.danmaku) {
      console.warn("[CrunchyrollIframeAdapter] Cannot toggle visibility - danmaku not initialized");
      return;
    }
    console.log("[CrunchyrollIframeAdapter] Toggling visibility:", force);
    const isVisible = this.danmaku.toggleVisibility(force);
    
    // Send status back to main window
    window.parent.postMessage({
      type: 'DANMAKU_STATUS',
      commentsEnabled: isVisible,
      commentsCount: this.danmaku.getCommentsCount,
      timestamp: Date.now()
    }, '*');
  }

  private async handlePageStatusMessage(message: PageStatusMessage): Promise<void> {
    console.log("[CrunchyrollIframeAdapter] Received page status:", message);

    if (message.isVideoPage && message.videoId) {
      // New video page or video changed
      if (this.videoId !== message.videoId) {
        console.log(`[CrunchyrollIframeAdapter] New video: ${message.videoId}`);
        this.videoId = message.videoId;
        await this.initializeDanmaku();
      }
    } else {
      // Not a video page or no video ID
      if (this.isInitialized) {
        console.log("[CrunchyrollIframeAdapter] Not a video page, destroying");
        this.destroy();
      }
    }
  }

  public async initializeDanmaku(): Promise<void> {
    console.log("[CrunchyrollIframeAdapter] Initializing for video:", this.videoId);
    if (!this.videoId) return;

    // Find video player
    this.videoPlayer = await waitForElement(this.videoPlayerSelector) as HTMLVideoElement;
    if (!this.videoPlayer) {
      console.error("[CrunchyrollIframeAdapter] Could not find video player");
      return;
    }

    // Find video container
    this.videoContainer = await waitForElement(this.videoContainerSelector) as HTMLElement;
    if (!this.videoContainer) {
      console.error("[CrunchyrollIframeAdapter] Could not find video container");
      return;
    }

    if (!this.isInitialized) {
      console.log("[CrunchyrollIframeAdapter] First-time initialization");

      // Create danmaku container
      this.danmakuContainer = document.createElement("div");
      this.danmakuContainer.classList.add("danmaku-container");
      this.videoContainer.appendChild(this.danmakuContainer);

      // Initialize Danmaku with real video player (NO INPUT)
      this.danmaku = new Danmaku(
        this.videoPlayer,
        this.danmakuContainer
      );

      // Set up video event listeners
      this.setupVideoEventListeners();

      this.isInitialized = true;
      console.log("[CrunchyrollIframeAdapter] Danmaku system initialized (no input)");
    } else {
      console.log("[CrunchyrollIframeAdapter] Re-initializing for new video");
      this.danmaku!.destroy();

      // Re-initialize Danmaku with existing elements
      this.danmaku = new Danmaku(
        this.videoPlayer,
        this.danmakuContainer!
      );

      console.log("[CrunchyrollIframeAdapter] Re-initialized for new video");
    }
  }

  private setupVideoEventListeners(): void {
    if (!this.videoPlayer) {
      console.log("[CrunchyrollIframeAdapter] Video player not available for event listeners");
      return;
    }

    // Listen to loadedmetadata to load comments
    this.videoPlayer.addEventListener('loadedmetadata', this.onLoadedMetadata);

    console.log("[CrunchyrollIframeAdapter] Video event listeners set up");
  }

  public async getCurrentTime(): Promise<number> {
    if (!this.videoPlayer) return 0;
    return this.videoPlayer.currentTime;
  }

  private onLoadedMetadata = async (): Promise<void> => {
    // FIX: Check if chrome and chrome.storage are available
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      console.warn("[CrunchyrollIframeAdapter] Chrome storage API not available");
      return;
    }

    try {
      chrome.storage.local.get(["danmakuEnabled"], async (result) => {
        if (!this.danmaku || !this.videoId || !this.videoPlayer) return;

        const danmakuEnabled = result.danmakuEnabled ?? true;

        if (danmakuEnabled === false) {
          console.log("[CrunchyrollIframeAdapter] Danmaku disabled");
          // Send message to parent to update comments status
          window.parent.postMessage({
            type: 'DANMAKU_STATUS',
            commentsEnabled: false,
            commentsCount: 0,
            timestamp: Date.now()
          }, '*');
          return;
        }

        if (this.danmaku.getCommentsCount > 0) {
          console.log("[CrunchyrollIframeAdapter] Comments already loaded");
          window.parent.postMessage({
            type: 'DANMAKU_STATUS',
            commentsEnabled: true,
            commentsCount: this.danmaku.getCommentsCount,
            timestamp: Date.now()
          }, '*');
          return;
        }

        console.log("[CrunchyrollIframeAdapter] Loading comments from API");
        const duration = this.videoPlayer!.duration || 0;
        const limit = duration < 60 ? 400 : duration < 300 ? 1000 : duration < 1800 ? 16000 : 32000;
        const bucketSize = 5;
        const maxCommentsPerBucket = 50;

        const rawComments: RawComment[] | null = await getComments(
          "crunchyroll",
          this.videoId!,
          limit,
          bucketSize,
          maxCommentsPerBucket
        );

        if (rawComments && rawComments.length > 0) {
          console.log(`[CrunchyrollIframeAdapter] Loaded ${rawComments.length} comments`);
          this.danmaku!.setComments(rawComments);
          window.parent.postMessage({
            type: 'DANMAKU_STATUS',
            commentsEnabled: true,
            commentsCount: rawComments.length,
            timestamp: Date.now()
          }, '*');
        } else {
          console.log("[CrunchyrollIframeAdapter] No comments received");
          this.danmaku!.setComments([]);
          window.parent.postMessage({
            type: 'DANMAKU_STATUS',
            commentsEnabled: true,
            commentsCount: 0,
            timestamp: Date.now()
          }, '*');
        }

        if (!this.videoPlayer!.paused) {
          this.danmaku!.play();
        }
      });
    } catch (error) {
      console.error("[CrunchyrollIframeAdapter] Error in onLoadedMetadata:", error);
    }
  };

  // These methods are used by the main page to detect video pages
  public isVideoPage(url: string): boolean {
    if (!url) return false;
    return url.indexOf("watch") !== -1;
  }

  public getVideoId(url: string): string | null {
    if (!url) return null;
    const parts = url.split("/");
    const watchIndex = parts.indexOf("watch");
    return watchIndex !== -1 && parts[watchIndex + 1] ? parts[watchIndex + 1] : null;
  }

  public destroy(): void {
    console.log("[CrunchyrollIframeAdapter] Destroying");

    if (this.videoPlayer) {
      this.videoPlayer.removeEventListener('loadedmetadata', this.onLoadedMetadata);
    }

    if (this.danmaku) {
      this.danmaku.destroy();
    }

    if (this.danmakuContainer) {
      this.danmakuContainer.remove();
    }

    this.videoPlayer = null;
    this.videoId = null;
    this.isInitialized = false;
    console.log("[CrunchyrollIframeAdapter] Destroyed");
  }
}

// ============= MAIN WINDOW ADAPTER (runs on main page) =============
// Handles ONLY danmaku input UI - no danmaku display

export class CrunchyrollMainAdapter implements SiteAdapter {
  public readonly domain: string = "crunchyroll";
  private belowSelector: string = ".body-wrapper";

  public isInitialized: boolean = false;
  private videoId: string | null = null;
  private loginModal: LoginModal = new LoginModal();
  private danmakuInputContainer: HTMLElement | null = null;
  private danmakuInputInstance: DanmakuInput | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private messageListenerBound: boolean = false;
  private iframeReady: boolean = false;

  constructor() {
    this.injectCSS();
    console.log("[CrunchyrollMainAdapter] Constructed on main page");

    if (!this.messageListenerBound) {
      this.setupMessageListener();
      this.messageListenerBound = true;
    }
  }

  private injectCSS(): void {
    if (document.querySelector('[data-extension="videodanmaku-css-main"]')) {
      return;
    }

    const style = document.createElement("style");
    style.setAttribute("data-extension", "videodanmaku-css-main");
    style.textContent = danmakuInputCss + crunchyrollCss;
    document.head.appendChild(style);
    console.log("[CrunchyrollMainAdapter] CSS injected on main page");
  }

  private currentTimeResolvers: Map<number, (time: number) => void> = new Map();
  private currentTimeRequestId: number = 0;

  private setupMessageListener(): void {
    window.addEventListener('message', (event: MessageEvent) => {
      const message = event.data;

      if (message.type === 'IFRAME_READY') {
        console.log("[CrunchyrollMainAdapter] Iframe is ready");
        this.iframeReady = true;
        // Resend current video ID if we have one
        if (this.videoId) {
          this.notifyIframe(this.videoId, true);
        }
      } else if (message.type === 'DANMAKU_STATUS') {
        // Update input UI with status from iframe
        if (this.danmakuInputInstance) {
          this.danmakuInputInstance.updateCommentsStatus(
            message.commentsEnabled,
            message.commentsCount
          );
        }
      } else if (message.type === 'CURRENT_TIME_RESPONSE') {
        // Resolve the promise for getCurrentTime()
        const resolver = this.currentTimeResolvers.get(message.requestId);
        if (resolver) {
          resolver(message.currentTime);
          this.currentTimeResolvers.delete(message.requestId);
        }
      }
    });
    console.log("[CrunchyrollMainAdapter] Message listener set up on main page");
  }

  private notifyIframe(videoId: string | null, isVideo: boolean): void {
    if (!this.iframe) {
      this.iframe = document.querySelector('iframe[src*="crunchyroll.com"]') as HTMLIFrameElement;
    }

    if (!this.iframe || !this.iframe.contentWindow) {
      console.warn("[CrunchyrollMainAdapter] Iframe not ready for message");
      return;
    }

    const message: PageStatusMessage = {
      type: 'PAGE_STATUS',
      videoId,
      isVideoPage: isVideo,
      timestamp: Date.now()
    };

    this.iframe.contentWindow.postMessage(message, '*');
    console.log("[CrunchyrollMainAdapter] Sent page status to iframe:", message);
  }

  public async initializeDanmaku(): Promise<void> {
    console.log("[CrunchyrollMainAdapter] Initializing input for video:", this.videoId);
    if (!this.videoId) return;

    // Wait for iframe to be available
    if (!this.iframe) {
      this.iframe = await this.waitForIframe();
      if (!this.iframe) {
        console.error("[CrunchyrollMainAdapter] Could not find iframe");
        return;
      }
    }

    if (!this.isInitialized) {
      console.log("[CrunchyrollMainAdapter] First-time initialization");

      // Create a proxy Danmaku-like object for the input
      // This won't actually display danmaku, just provides the interface
      const danmakuProxy = this.createDanmakuProxy();

      // Initialize input
      this.danmakuInputInstance = new DanmakuInput(
        this,
        danmakuProxy as any, // Cast to any since it's a proxy
        this.loginModal,
        this.videoId
      );

      const danmakuInputElement = this.danmakuInputInstance.init();
      await this.setupDanmakuInput(danmakuInputElement);

      this.isInitialized = true;
      console.log("[CrunchyrollMainAdapter] Input system initialized");
    } else {
      console.log("[CrunchyrollMainAdapter] Re-initializing for new video");
      this.danmakuInputInstance!.updateVideoId(this.videoId);

      if (this.danmakuInputContainer && !this.danmakuInputContainer.parentElement) {
        await this.setupDanmakuInput(this.danmakuInputContainer);
      }

      console.log("[CrunchyrollMainAdapter] Re-initialized for new video");
    }

    // Notify iframe of the new video
    this.notifyIframe(this.videoId, true);
  }

  private async waitForIframe(): Promise<HTMLIFrameElement | null> {
    return new Promise((resolve) => {
      const checkIframe = setInterval(() => {
        const iframe = document.querySelector('iframe[src*="crunchyroll.com"]') as HTMLIFrameElement;
        if (iframe) {
          clearInterval(checkIframe);
          resolve(iframe);
        }
      }, 100);

      // Stop checking after 10 seconds
      setTimeout(() => {
        clearInterval(checkIframe);
        resolve(null);
      }, 10000);
    });
  }

  private createDanmakuProxy(): any {
    // Create a proxy object that mimics Danmaku's interface
    // but doesn't actually display anything
    let commentsCount = 0;

    return {
      get getCommentsCount() {
        return commentsCount;
      },
      setComments: (comments: RawComment[]) => {
        commentsCount = comments.length;
        // Comments are actually set in the iframe
      },
      addComment: (comment: any) => {
        commentsCount++;
        // Comment is sent to iframe via message
        if (this.iframe && this.iframe.contentWindow) {
          this.iframe.contentWindow.postMessage({
            type: 'ADD_COMMENT',
            comment,
            timestamp: Date.now()
          }, '*');
        }
      },
      toggleVisibility: (force?: boolean) => {
        // Send message to iframe to toggle visibility
        if (this.iframe && this.iframe.contentWindow) {
          this.iframe.contentWindow.postMessage({
            type: 'TOGGLE_VISIBILITY',
            force,
            timestamp: Date.now()
          }, '*');
        }
        return force ?? true;
      },
      destroy: () => {
        commentsCount = 0;
      }
    };
  }

  public async getCurrentTime(): Promise<number> {
    // Request current time from iframe
    if (!this.iframe || !this.iframe.contentWindow) {
      console.warn("[CrunchyrollMainAdapter] Cannot get current time - iframe not available");
      return 0;
    }

    return new Promise((resolve) => {
      const requestId = ++this.currentTimeRequestId;
      this.currentTimeResolvers.set(requestId, resolve);

      this.iframe!.contentWindow!.postMessage({
        type: 'GET_CURRENT_TIME',
        requestId,
        timestamp: Date.now()
      }, '*');

      // Timeout after 1 second
      setTimeout(() => {
        if (this.currentTimeResolvers.has(requestId)) {
          this.currentTimeResolvers.delete(requestId);
          resolve(0);
        }
      }, 1000);
    });
  }

  private async setupDanmakuInput(element: HTMLElement): Promise<void> {
    const belowPlayer = await waitForElement(this.belowSelector);
    if (belowPlayer) {
      belowPlayer.prepend(element);
    }

    if (!this.danmakuInputContainer) {
      this.danmakuInputContainer = element;
    }
  }

  public isVideoPage(url: string): boolean {
    if (!url) return false;
    return url.indexOf("watch") !== -1;
  }

  public getVideoId(url: string): string | null {
    if (!url) return null;
    const parts = url.split("/");
    const watchIndex = parts.indexOf("watch");
    return watchIndex !== -1 && parts[watchIndex + 1] ? parts[watchIndex + 1] : null;
  }

  public destroy(): void {
    console.log("[CrunchyrollMainAdapter] Destroying");

    if (this.danmakuInputContainer) {
      this.danmakuInputContainer.remove();
    }

    // Notify iframe to destroy
    this.notifyIframe(null, false);

    this.videoId = null;
    this.isInitialized = false;
    console.log("[CrunchyrollMainAdapter] Destroyed");
  }
}

// For backwards compatibility, export the iframe adapter as the default
export const CrunchyrollAdapter = CrunchyrollIframeAdapter;
