import {Danmaku} from "../danmaku/danmaku";

export interface SiteAdapter {
    getVideoPlayer(): HTMLVideoElement;

    getVideoId(url: string): string | null;

    isVideoPage(url: string): boolean;

    setupEventListeners(videoPlayer: HTMLVideoElement, danmaku: Danmaku): Promise<void>;

    initializeDanmaku(): Promise<void>;

    destroy(): void;
}