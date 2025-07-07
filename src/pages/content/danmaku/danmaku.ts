import { Comment } from "../api";

interface DanmakuComment extends Comment {
    y: number;
    x: number;
    speed: number;
    width: number;
    lane: number;
    expiry: number;
    element: HTMLElement;
}

type VideoEventListener = {
    event: string;
    listener: () => void;
};

export class Danmaku {
    private container: HTMLElement;
    private allComments: Comment[] = [];
    private comments: Comment[] = [];
    private activeComments: DanmakuComment[] = [];
    private videoPlayer: HTMLVideoElement;
    private isRunning = false;
    private lastTimestamp = 0;
    private animationFrameId: number | null = null;
    private videoEventListeners: VideoEventListener[] = [];

    private commentsCount: number = 0;

    private slidingLanes: number[] = [];
    private topLanes: number[] = [];
    private bottomLanes: number[] = [];
    private static readonly DURATION = 7; // seconds
    private static readonly LANE_HEIGHT = 30;
    private static readonly FONT_SIZE = 24;

    constructor(videoPlayer: HTMLVideoElement, container: HTMLElement) {
        this.videoPlayer = videoPlayer;
        this.container = container;
        this.resize();
    }

    public getVideoPlayerInfo(): void {
        console.log("Video Player Info:");
        console.log(`Current Time: ${this.videoPlayer.currentTime}`);
        console.log(`Duration: ${this.videoPlayer.duration}`);
    }

    public get getCurrentTime(): number {
        return this.videoPlayer.currentTime;
    }

    public get getVideoPlayer(): HTMLVideoElement {
        return this.videoPlayer;
    }

    public get getCommentsCount(): number {
        return this.commentsCount;
    }
    
    public set setCommentsCount(val: number) {
        this.commentsCount = val;
    }

    public setComments(comments: Comment[]): void {
        this.allComments = comments.sort((a, b) => a.time - b.time);
        this.seek(); 
        this.setCommentsCount = this.allComments.length;
    }

    /**
     * **BUG FIX:** This now calls a non-destructive sync method, which
     * preserves on-screen comments while still preventing a "comment flood"
     * after being paused for a long time.
     */
    public play(): void {
        if (this.isRunning) return;
        console.log("Danmaku playing");

        // Sync the upcoming comments queue without clearing active ones.
        this.resyncCommentQueue();

        this.isRunning = true;
        this.animationFrameId = requestAnimationFrame((t) => this.animationLoop(t));
    }

    public pause(): void {
        if (!this.isRunning) return;
        console.log("Danmaku paused");
        this.isRunning = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    /**
     * Performs a "hard" seek, clearing all on-screen comments and rebuilding
     * the upcoming queue. This is for timeline jumps.
     */
    public seek(): void {
        console.log("Danmaku seeking");
        this.activeComments.forEach((comment) => comment.element.remove());
        this.activeComments = [];
        
        this.resyncCommentQueue();

        this.slidingLanes.fill(0);
        this.topLanes.fill(0);
        this.bottomLanes.fill(0);
    }
    
    /**
     * **NEW METHOD:** Synchronizes the upcoming comment queue (`this.comments`)
     * to the video's current time without touching active on-screen comments.
     */
    private resyncCommentQueue(): void {
        const currentTime = this.videoPlayer.currentTime;
        const startIndex = this.allComments.findIndex(comment => comment.time >= currentTime);

        this.comments = (startIndex === -1) ? [] : this.allComments.slice(startIndex);
        
        // Reset the animation timestamp to ensure smooth delta calculation on resume.
        this.lastTimestamp = 0;
    }

    public resize(): void {
        const videoRect = this.videoPlayer.getBoundingClientRect();
        const numLanes = Math.floor(videoRect.height / Danmaku.LANE_HEIGHT);
        this.slidingLanes = new Array(numLanes).fill(0);
        this.topLanes = new Array(numLanes).fill(0);
        this.bottomLanes = new Array(numLanes).fill(0);
    }

    public show(): void {
        this.container.style.display = "";
    }

    public hide(): void {
        this.container.style.display = "none";
    }

    public addComment(comment: Comment): void {
        this.emitComment(comment);
        const insertIndex = this.allComments.findIndex((c) => c.time > comment.time);
        if (insertIndex === -1) {
            this.allComments.push(comment);
        } else {
            this.allComments.splice(insertIndex, 0, comment);
        }
        this.setCommentsCount++;
    }

    public setVideoEventListeners(listeners: VideoEventListener[]): void {
        this.videoEventListeners = listeners;
    }

    public reinitialize(videoPlayer: HTMLVideoElement): void {
        console.log("Reinitializing Danmaku for new video player.");
        this.pause();
        this.clear();

        // Remove old listeners
        this.videoEventListeners.forEach(({ event, listener }) => {
            this.videoPlayer.removeEventListener(event, listener);
        });
        this.videoEventListeners = [];

        // Set new video player
        this.videoPlayer = videoPlayer;
        this.resize();
    }

    public destroy(): void {
        console.log("Destroying Danmaku instance.");
        this.pause();
        this.clear();
        this.videoEventListeners.forEach(({ event, listener }) => {
            this.videoPlayer.removeEventListener(event, listener);
        });
        this.videoEventListeners = [];
    }

    public clear(): void {
        this.activeComments.forEach((c) => c.element.remove());
        this.activeComments = [];
        this.comments = [];
        this.allComments = [];
        this.setCommentsCount = 0;
    }

    private animationLoop(timestamp: number): void {
        if (!this.isRunning) return;

        if (!this.lastTimestamp) {
            this.lastTimestamp = timestamp;
            this.animationFrameId = requestAnimationFrame((t) => this.animationLoop(t));
            return;
        }

        const delta = (timestamp - this.lastTimestamp) / 1000;
        this.lastTimestamp = timestamp;

        this.updateActiveComments(delta);
        this.emitNewComments();

        this.animationFrameId = requestAnimationFrame((t) => this.animationLoop(t));
    }

    private updateActiveComments(delta: number): void {
        const now = performance.now();
        this.activeComments = this.activeComments.filter((comment) => {
            if (now > comment.expiry) {
                comment.element.remove();
                return false;
            }
            if (comment.scrollMode === "slide") {
                comment.x -= comment.speed * delta;
                comment.element.style.transform = `translateX(${comment.x}px)`;
            }
            return true;
        });
    }

    private emitNewComments(): void {
        const currentTime = this.videoPlayer.currentTime;
        while (this.comments.length > 0 && this.comments[0].time <= currentTime) {
            const comment = this.comments.shift()!;
            this.emitComment(comment);
        }
    }

    private emitComment(comment: Comment): void {
        const danmakuElement = document.createElement("div");
        danmakuElement.textContent = comment.content;
        danmakuElement.classList.add("danmaku-comment");
        danmakuElement.style.color = comment.color;
        danmakuElement.style.fontSize = `${Danmaku.FONT_SIZE}px`;

        const lane = this.findLane(comment);
        if (lane === -1) {
            return;
        }

        this.container.appendChild(danmakuElement);
        const commentWidth = danmakuElement.offsetWidth;
        
        const danmakuComment: DanmakuComment = {
            ...comment,
            y: lane * Danmaku.LANE_HEIGHT,
            x: 0,
            speed: 0,
            width: commentWidth,
            lane,
            expiry: performance.now() + Danmaku.DURATION * 1000,
            element: danmakuElement,
        };

        switch (comment.scrollMode) {
            case "slide":
                const containerWidth = this.container.offsetWidth;
                danmakuComment.x = containerWidth;
                danmakuComment.speed = (containerWidth + commentWidth) / Danmaku.DURATION;
                danmakuElement.style.top = `${danmakuComment.y}px`;
                danmakuElement.style.transform = `translateX(${danmakuComment.x}px)`;
                this.slidingLanes[lane] = performance.now() + (commentWidth / danmakuComment.speed) * 1000;
                break;
            case "top":
                danmakuElement.style.top = `${danmakuComment.y}px`;
                danmakuElement.style.left = `50%`;
                danmakuElement.style.transform = `translateX(-50%)`;
                this.topLanes[lane] = danmakuComment.expiry;
                break;
            case "bottom":
                const totalLanes = Math.floor(this.container.offsetHeight / Danmaku.LANE_HEIGHT);
                danmakuComment.y = (totalLanes - 1 - lane) * Danmaku.LANE_HEIGHT;
                danmakuElement.style.top = `${danmakuComment.y}px`;
                danmakuElement.style.left = `50%`;
                danmakuElement.style.transform = `translateX(-50%)`;
                this.bottomLanes[lane] = danmakuComment.expiry;
                break;
        }

        this.activeComments.push(danmakuComment);
    }

    private findLane(comment: Comment): number {
        const now = performance.now();
        const lanes = this.getLanesForMode(comment.scrollMode);
        for (let i = 0; i < lanes.length; i++) {
            if (lanes[i] <= now) {
                return i;
            }
        }
        return -1;
    }

    private getLanesForMode(mode: "slide" | "top" | "bottom"): number[] {
        switch (mode) {
            case "slide":
                return this.slidingLanes;
            case "top":
                return this.topLanes;
            case "bottom":
                return this.bottomLanes;
        }
    }
}