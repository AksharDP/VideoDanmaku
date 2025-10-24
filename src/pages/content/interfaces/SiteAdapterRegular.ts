import {SiteAdapter} from "./SiteAdapter";

export interface SiteAdapterRegular extends SiteAdapter {
    // getVideoPlayer(): HTMLVideoElement;

    getVideoId(url: string): string | null;

    isVideoPage(url: string): boolean;

    setupEventListeners(videoPlayer: HTMLVideoElement): Promise<void>;

    initializeDanmaku(): Promise<void>;

    destroy(): void;
}