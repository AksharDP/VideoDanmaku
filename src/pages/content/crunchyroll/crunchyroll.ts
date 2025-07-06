import { Danmaku } from "../danmaku/danmaku";
import { DanmakuInput } from "../danmaku/danmakuInput";
import { getComments } from "../api";
import { LoginModal } from "../login-modal";
import { SiteAdapter } from "../interfaces/SiteAdapter";
import danmakuHtml from "../danmaku/danmakuInput.html?raw";
import crunchyrollCss from "../css/sites/crunchyroll.css?raw";
import danmakuBaseCss from "../css/danmaku-base.css?raw";

export class CrunchyrollAdapter implements SiteAdapter {
    private danmaku: Danmaku | null = null;
    private loginModal: LoginModal = new LoginModal();
    private observer: MutationObserver | null = null;
    private danmakuContainer: HTMLElement | null = null;
    private danmakuInputContainer: HTMLElement | null = null;
    private danmakuInputInstance: DanmakuInput | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private videoElementForObserver: HTMLVideoElement | null = null;
    private videoPlayer: HTMLVideoElement | null = null;

    constructor() {
        this.injectCSS();
        this.setupObserver();
        this.initializeDanmaku();
    }

    private injectCSS(): void {
        if (document.querySelector('[data-extension="videodanmaku-css"]')) {
            return;
        }
        const style = document.createElement("style");
        style.setAttribute("data-extension", "videodanmaku-css");
        style.textContent = danmakuBaseCss + crunchyrollCss;
        document.head.appendChild(style);
    }

    private setupObserver() {
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === "childList") {
                    const videoPlayer = this.getVideoPlayerFromNode(
                        document.body
                    );
                    if (videoPlayer && !this.videoElementForObserver) {
                        this.initializeDanmaku();
                        break;
                    }
                    if (
                        this.videoElementForObserver &&
                        !document.contains(this.videoElementForObserver)
                    ) {
                        this.destroy();
                    }
                }
            }
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    getDanmakuHtml(): string {
        return danmakuHtml;
    }

    getVideoPlayer(): HTMLVideoElement {
        // const video = this.waitForElement('video[data-testid="vilos-player"], #vilos-player video, .vilos-player video, video.vilos-player, video[src*="crunchyroll"], video[src*="vrv"], video');
        // return video;
        return document.querySelector(".html5-main-video") as HTMLVideoElement;
        // return (await this.waitForElement(
        //     ".html5-main-video"
        // )) as HTMLVideoElement | null;
    }

    private getVideoPlayerFromNode(node: Node): HTMLVideoElement | null {
        const selectors = [
            'video[data-testid="vilos-player"]',
            "#vilos-player video",
            ".vilos-player video",
            "video.vilos-player",
            'video[src*="crunchyroll"]',
            'video[src*="vrv"]',
            "video",
        ];
        for (const selector of selectors) {
            const video = (node as Element).querySelector(
                selector
            ) as HTMLVideoElement;
            if (video) return video;
        }
        return null;
    }

    public getVideoId(): string | null {
        const match = window.location.pathname.match(/\/watch\/([^\/]+)/);
        return match ? match[1] : null;
    }

    // async getTitle(): Promise<Element | null> {
    //     return await this.waitForElement('.title, [data-t="title"]');
    // }

    async setupEventListeners(
        videoPlayer: HTMLVideoElement,
        danmaku: Danmaku
    ): Promise<void> {
        const playListener = () => danmaku.play();
        const pauseListener = () => danmaku.pause();
        const seekedListener = () => danmaku.seek();

        videoPlayer.addEventListener("play", playListener);
        videoPlayer.addEventListener("pause", pauseListener);
        videoPlayer.addEventListener("seeked", seekedListener);

        this.danmaku?.setVideoEventListeners([
            { event: "play", listener: playListener },
            { event: "pause", listener: pauseListener },
            { event: "seeked", listener: seekedListener },
        ]);

        this.resizeObserver = new ResizeObserver(() => {
            danmaku.resize();
        });
        this.resizeObserver.observe(videoPlayer);
        this.videoElementForObserver = videoPlayer;
    }

    async initializeDanmaku(): Promise<void> {
        if (this.danmaku) {
            return;
        }

        const videoId = this.getVideoId();
        if (!videoId) {
            return;
        }

        this.videoPlayer = await this.getVideoPlayer();
        // const titleElement = await this.getTitle();
        // const [videoPlayer, titleElement] = await Promise.all([
        //     this.getVideoPlayer(),
        //     this.getTitle(),
        // ]);

        // if (!this.videoPlayer || !titleElement) {
        //     return;
        // }

        // this.danmakuContainer = document.createElement("div");
        // this.danmakuContainer.classList.add("danmaku-container");
        // this.videoPlayer.parentElement?.insertBefore(
        //     this.danmakuContainer,
        //     this.videoPlayer.nextSibling
        // );

        // this.danmaku = new Danmaku(this.videoPlayer, this.danmakuContainer);
        // this.danmaku.show();

        // await this.setupDanmakuInput(
        //     videoId,
        //     titleElement.textContent || ""
        // );

        // this.setupEventListeners(this.videoPlayer, this.danmaku);

        const videoDuration = this.videoPlayer.duration / 60 || 0;
        const limit =
            videoDuration < 1
                ? 200
                : videoDuration < 5
                ? 1000
                : videoDuration < 10
                ? 2000
                : videoDuration < 30
                ? 12000
                : 32000;

        // this.danmaku.loadDanmakuComments("youtube", videoId, limit);
    }

    private async setupDanmakuInput(
        videoId: string,
        videoTitle: string
    ): Promise<void> {
        if (
            !this.danmakuInputContainer ||
            !document.body.contains(this.danmakuInputContainer)
        ) {
            if (!this.danmakuInputInstance) {
                this.danmakuInputInstance = new DanmakuInput(
                    this.danmaku!,
                    this.loginModal,
                    videoId,
                    // videoTitle
                );
            }

            const insertionPoint = await this.waitForElement(
                '[data-testid="erc-watch-panel"], .erc-watch-panel, #showmedia_video_player_container'
            );
            if (insertionPoint) {
                insertionPoint.appendChild(
                    this.danmakuInputInstance.containerDiv
                );
                this.danmakuInputContainer =
                    this.danmakuInputInstance.containerDiv;
            } else {
                this.videoPlayer?.parentElement?.parentElement?.appendChild(
                    this.danmakuInputInstance.containerDiv
                );
                this.danmakuInputContainer =
                    this.danmakuInputInstance.containerDiv;
            }
        }
    }

    public isVideoPage(url: string): boolean {
        const videoId = this.getVideoId();
        return videoId !== null && url.includes("/watch/");
    }

    destroy(): void {
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
        if (this.danmakuInputInstance) {
            // this.danmakuInputInstance.destroy?.();
            this.danmakuInputInstance = null;
        }
        if (this.resizeObserver && this.videoElementForObserver) {
            this.resizeObserver.unobserve(this.videoElementForObserver);
            this.resizeObserver = null;
            this.videoElementForObserver = null;
        }
    }

    private async waitForElement(selector: string): Promise<Element | null> {
        return new Promise((resolve) => {
            const element = document.querySelector(selector);
            if (element) {
                return resolve(element);
            }
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    observer.disconnect();
                    resolve(element);
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
        });
    }
}
