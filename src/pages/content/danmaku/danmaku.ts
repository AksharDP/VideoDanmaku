import { Comment } from "../api";
import { ReportModal } from "../modal-report/modal-report";

interface DanmakuComment extends Comment {
    y: number;
    x: number;
    speed: number;
    width: number;
    lane: number;
    expiry: number;
    element: HTMLElement;
    isPaused?: boolean;
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
    private reportModal: ReportModal;
    private isVisible: boolean = true;

    private commentsCount: number = 0;

    private slidingLanes: number[] = [];
    private topLanes: number[] = [];
    private bottomLanes: number[] = [];
    private static readonly DURATION = 7;
    private static readonly LANE_HEIGHT = 30;
    private static readonly FONT_SIZE = 24;

    // Settings properties
    private speedMultiplier: number = 1;
    private opacityLevel: number = 1;
    private fontSizeMultiplier: number = 1;
    private densityMode: "sparse" | "normal" | "dense" = "normal";
    private densityDelay: number = 1000; // Default to 1 second for normal

    constructor(videoPlayer: HTMLVideoElement, container: HTMLElement) {
        this.videoPlayer = videoPlayer;
        this.container = container;
        this.reportModal = new ReportModal();
        this.resize();
        this.addVideoEventListeners();
    }

    public get getCurrentTime(): number {
        return this.videoPlayer.currentTime;
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

    public play(): void {
        if (this.isRunning || !this.isVisible) return;
        console.log("Danmaku playing");

        this.resyncCommentQueue();

        this.isRunning = true;
        this.animationFrameId = requestAnimationFrame((t) =>
            this.animationLoop(t)
        );
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

    public seek(): void {
        console.log("Danmaku seeking");
        this.activeComments.forEach((comment) => comment.element.remove());
        this.activeComments = [];

        this.resyncCommentQueue();

        this.slidingLanes.fill(0);
        this.topLanes.fill(0);
        this.bottomLanes.fill(0);
    }

    private resyncCommentQueue(): void {
        const currentTime = this.videoPlayer.currentTime;

        this.comments = [];

        const onScreenComments = this.allComments.filter((comment) => {
            const hasStarted = comment.time <= currentTime;
            const hasNotEnded = comment.time + Danmaku.DURATION > currentTime;
            return hasStarted && hasNotEnded;
        });

        this.activeComments.forEach((c) => c.element.remove());
        this.activeComments = [];

        onScreenComments.forEach((comment) => {
            const timeElapsed = currentTime - comment.time;
            this.emitComment(comment, timeElapsed);
        });

        const startIndex = this.allComments.findIndex(
            (comment) => comment.time >= currentTime
        );

        this.comments =
            startIndex === -1 ? [] : this.allComments.slice(startIndex);

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
        this.isVisible = true;
        if (!this.videoPlayer.paused) {
            this.play();
        }
    }

    public hide(): void {
        this.container.style.display = "none";
        this.isVisible = false;
        this.pause();
    }

    public toggleVisibility(force?: boolean): boolean {
        this.isVisible = force ?? !this.isVisible;
        if (this.isVisible) {
            this.show();
        } else {
            this.hide();
        }
        return this.isVisible;
    }

    public addComment(comment: Comment): void {
        this.emitComment(comment);
        const insertIndex = this.allComments.findIndex(
            (c) => c.time > comment.time
        );
        if (insertIndex === -1) {
            this.allComments.push(comment);
        } else {
            this.allComments.splice(insertIndex, 0, comment);
        }
        this.commentsCount++;
    }

    public setVideoEventListeners(listeners: VideoEventListener[]): void {
        this.videoEventListeners = listeners;
    }

    public reinitialize(videoPlayer: HTMLVideoElement): void {
        console.log("Reinitializing Danmaku for new video player.");
        this.pause();
        this.clear();

        this.videoEventListeners.forEach(({ event, listener }) => {
            this.videoPlayer.removeEventListener(event, listener);
        });
        this.videoEventListeners = [];

        this.videoPlayer = videoPlayer;
        this.resize();

        this.addVideoEventListeners();
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

    private addVideoEventListeners(): void {
        const listeners: VideoEventListener[] = [
            { event: "play", listener: () => this.play() },
            { event: "pause", listener: () => this.pause() },
            { event: "seeking", listener: () => this.seek() },
            { event: "waiting", listener: () => this.pause() },
            { event: "playing", listener: () => this.play() },
        ];

        listeners.forEach(({ event, listener }) => {
            this.videoPlayer.addEventListener(event, listener);
            this.videoEventListeners.push({ event, listener });
        });
    }

    private animationLoop(timestamp: number): void {
        if (!this.isRunning) return;

        if (!this.lastTimestamp) {
            this.lastTimestamp = timestamp;
            this.animationFrameId = requestAnimationFrame((t) =>
                this.animationLoop(t)
            );
            return;
        }

        const delta = (timestamp - this.lastTimestamp) / 1000;
        this.lastTimestamp = timestamp;

        this.updateActiveComments(delta);
        this.emitNewComments();

        this.animationFrameId = requestAnimationFrame((t) =>
            this.animationLoop(t)
        );
    }

    private updateActiveComments(delta: number): void {
        const now = performance.now();
        this.activeComments = this.activeComments.filter((comment) => {
            if (comment.isPaused) {
                comment.expiry += delta * 1000;
            }

            if (comment.scrollMode === "slide") {
                if (!comment.isPaused) {
                    comment.x -= comment.speed * delta;
                    comment.element.style.transform = `translateX(${comment.x}px)`;
                }
                if (comment.x + comment.width < 0) {
                    comment.element.remove();
                    return false;
                }
            } else {
                if (now > comment.expiry) {
                    comment.element.remove();
                    return false;
                }
            }
            return true;
        });
    }

    private emitNewComments(): void {
        const currentTime = this.videoPlayer.currentTime;
        while (
            this.comments.length > 0 &&
            this.comments[0].time <= currentTime
        ) {
            const comment = this.comments.shift()!;
            this.emitComment(comment);
        }
    }

    private emitComment(comment: Comment, timeElapsed = 0): void {
        const danmakuElement = document.createElement("div");
        danmakuElement.textContent = comment.content;
        danmakuElement.classList.add("danmaku-comment");
        danmakuElement.style.color = comment.color;
        danmakuElement.style.fontSize = `${Danmaku.FONT_SIZE}px`;

        const popup = document.createElement("div");
        popup.className = "danmaku-comment-popup";
        popup.style.display = "none";

        const copyButton = document.createElement("button");
        copyButton.className = "danmaku-popup-button";
        copyButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy-icon lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
        copyButton.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            navigator.clipboard.writeText(comment.content).catch((err) => {
                console.error("Failed to copy text: ", err);
            });
        };

        const reportButton = document.createElement("button");
        reportButton.className = "danmaku-popup-button";
        reportButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-alert-icon lucide-circle-alert"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`;
        reportButton.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.reportModal.show(comment);
        };

        popup.appendChild(copyButton);
        popup.appendChild(reportButton);

        popup.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
        };

        danmakuElement.appendChild(popup);

        const lane = this.findAvailableLane(comment);
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
            isPaused: false,
        };

        danmakuElement.addEventListener("mouseenter", () => {
            danmakuComment.isPaused = true;
            popup.style.display = "flex";
        });
        danmakuElement.addEventListener("mouseleave", () => {
            danmakuComment.isPaused = false;
            popup.style.display = "none";
        });

        switch (comment.scrollMode) {
            case "slide":
                { const containerWidth = this.container.offsetWidth;
                danmakuComment.speed =
                    (containerWidth + commentWidth) / Danmaku.DURATION;
                const distanceTraveled = timeElapsed * danmakuComment.speed;
                danmakuComment.x = containerWidth - distanceTraveled;
                danmakuElement.style.top = `${danmakuComment.y}px`;
                danmakuElement.style.transform = `translateX(${danmakuComment.x}px)`;
                this.slidingLanes[lane] =
                    performance.now() +
                    (commentWidth / danmakuComment.speed) * 1000;
                break; }
            case "top":
                danmakuElement.style.top = `${danmakuComment.y}px`;
                danmakuElement.style.left = `50%`;
                danmakuElement.style.transform = `translateX(-50%)`;
                this.topLanes[lane] = danmakuComment.expiry;
                break;
            case "bottom":
                { const totalLanes = Math.floor(
                    this.container.offsetHeight / Danmaku.LANE_HEIGHT
                );
                danmakuComment.y =
                    (totalLanes - 1 - lane) * Danmaku.LANE_HEIGHT;
                danmakuElement.style.top = `${danmakuComment.y}px`;
                danmakuElement.style.left = `50%`;
                danmakuElement.style.transform = `translateX(-50%)`;
                this.bottomLanes[lane] = danmakuComment.expiry;
                break; }
        }

        this.activeComments.push(danmakuComment);
    }

    private findAvailableLane(comment: Comment): number {
        const now = performance.now();
        const lanes = this.getLanesForMode(comment.scrollMode);
        
        // Always start from lane 0 and work upwards to prioritize lower line numbers
        for (let i = 0; i < lanes.length; i++) {
            // Check if the lane is available based on density settings
            if (this.isLaneAvailable(lanes, i, now)) {
                return i;
            }
        }
        return -1;
    }

    private isLaneAvailable(lanes: number[], laneIndex: number, now: number): boolean {
        // If the lane is already expired, it's available
        if (lanes[laneIndex] <= now) {
            return true;
        }
        
        // Check density settings to see if we can use this lane
        const timeUntilAvailable = lanes[laneIndex] - now;
        return timeUntilAvailable <= this.densityDelay;
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

    // Settings methods
    public setSpeed(percent: number): void {
        this.speedMultiplier = percent / 100;
        // Apply speed to all active comments
        this.activeComments.forEach((comment) => {
            if (comment.scrollMode === "slide") {
                const containerWidth = this.container.offsetWidth;
                comment.speed = (containerWidth + comment.width) / Danmaku.DURATION * this.speedMultiplier;
            }
        });
    }

    public setDensity(density: "sparse" | "normal" | "dense"): void {
        this.densityMode = density;
        
        // Set the delay based on density mode
        switch (density) {
            case "sparse":
                this.densityDelay = 2000; // 2 seconds
                break;
            case "normal":
                this.densityDelay = 1000; // 1 second
                break;
            case "dense":
                this.densityDelay = 0; // No delay
                break;
        }
        
        // Re-evaluate which comments should be visible based on new density
        this.seek();
    }

    public setOpacity(percent: number): void {
        this.opacityLevel = percent / 100;
        this.container.style.opacity = this.opacityLevel.toString();
    }

    public setFontSize(percent: number): void {
        this.fontSizeMultiplier = percent / 100;
        const newFontSize = Danmaku.FONT_SIZE * this.fontSizeMultiplier;

        // Apply font size to all active comments
        this.activeComments.forEach((comment) => {
            comment.element.style.fontSize = `${newFontSize}px`;
        });

        // Update CSS custom property for future comments
        this.container.style.setProperty('--danmaku-font-size', `${newFontSize}px`);
    }

}
