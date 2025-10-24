
export interface SiteAdapter {
    domain: string;
    // getVideoPlayer(): HTMLVideoElement;

    getVideoId(url: string): string | null;

    isVideoPage(url: string): boolean;

    initializeDanmaku(): Promise<void>;

    /**
     * Get the current video time in milliseconds.
     * For iframe-based sites, this may query the iframe asynchronously.
     * For direct video access, this returns immediately.
     */
    getCurrentTime(): Promise<number>;

    destroy(): void;
}