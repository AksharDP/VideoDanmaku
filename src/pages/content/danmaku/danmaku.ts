import { Comment } from "../api";
import { ReportModal } from "../modal-report/modal-report";
import { DensityConfig, DensityMode, ScrollMode } from "../interfaces/enum";
import { createCanvas, CanvasRenderingContext2D } from 'canvas';


// This interface holds the pre-calculated layout information for a comment.
// It references a comment by its ID to save memory.
interface DanmakuLayoutInfo {
    commentId: number;
    lane: number;
    startTime: number; // The actual, calculated time the comment should appear on screen.
    scrollMode: ScrollMode;
    speed: number;
    width: number;
}

// This interface represents a comment that is currently active and visible on the screen.
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

// noinspection D
export class Danmaku {
    private container: HTMLElement;
    public videoPlayer: HTMLVideoElement;

    // Stores the original comment data from the API.
    private allComments: Comment[] = [];
    // Stores the pre-calculated layout for every comment.
    public commentLayout: DanmakuLayoutInfo[] = [];
    // A queue of comments scheduled to be rendered based on the current video time.
    private scheduledComments: DanmakuLayoutInfo[] = [];
    // The set of comments currently visible and animating on the screen.
    private activeComments: DanmakuComment[] = [];

    private isRunning = false;
    private lastTimestamp = 0;
    private animationFrameId: number | null = null;
    private videoEventListeners: VideoEventListener[] = [];
    private reportModal: ReportModal;
    private isVisible: boolean = true;
    public get getCommentsCount(): number {
        return this.commentsCount;
    }
    private commentsCount: number = 0;

    // --- Constants ---
    private static readonly DURATION = 7; // seconds
    private static readonly LANE_HEIGHT = 30; // pixels
    private static readonly FONT_SIZE = 24; // pixels

    // --- Observers and Timers ---
    private resizeObserver: ResizeObserver | null = null;
    private resizeTimeoutId: number | null = null;

    // --- Settings ---
    private speedMultiplier: number = 1;
    private opacityLevel: number = 1;
    private fontSizeMultiplier: number = 1;
    private densityMode: DensityMode = DensityMode.NORMAL;

    // --- Performance ---
    private commentPool: HTMLElement[] = [];
    private maxPoolSize: number = 50;
    private tempCanvasContext: CanvasRenderingContext2D;

    constructor();
    constructor(videoPlayer: HTMLVideoElement, container: HTMLElement);

    constructor(videoPlayer?: HTMLVideoElement, container?: HTMLElement) {
        if (videoPlayer && container) {
            this.videoPlayer = videoPlayer;
            this.container = container;
        } else {
            this.videoPlayer = document.createElement("video");
            this.container = document.createElement("div");
        }

        this.reportModal = new ReportModal();

        const tempCanvas = createCanvas(500, 50);
        this.tempCanvasContext = tempCanvas.getContext('2d');

        if (videoPlayer && container) {
            this.addVideoEventListeners();
            this.setupResizeObserver();
            this.setupWindowResizeListener();
        }
    }

    /**
     * Entry point for loading comments. Sorts comments by time,
     * pre-calculates their layout, and prepares them for rendering.
     */
    public setComments(comments: Comment[]): void {
        this.allComments = comments.sort((a, b) => a.time - b.time);
        this.calculateLayouts();
        console.log(this.allComments);
        console.log(this.commentLayout);
        this.seek();
        this.commentsCount = this.allComments.length;
    }

    public getComments(): Comment[] {
        return this.allComments;
    }

    /**
     * The core layout calculation logic. Iterates through all comments and assigns
     * them a specific lane and start time based on availability, preventing overlaps.
     */
    private calculateLayouts(): void {
        const screenWidth = this.videoPlayer.offsetWidth || 1280;
        const laneCount = (Math.floor(this.videoPlayer.offsetHeight / Danmaku.LANE_HEIGHT) || 10) - 1;
        const densityDelay = DensityConfig[this.densityMode].delay / 1000; // in seconds
        const duration = Danmaku.DURATION / this.speedMultiplier;
        const halfDuration = duration / 2; // Cached for fixed modes

        this.tempCanvasContext.font = `${Danmaku.FONT_SIZE * this.fontSizeMultiplier}px Roboto, Arial, sans-serif`;

        const laneTracker = {
            [ScrollMode.SLIDE]: Array(laneCount).fill(0),
            [ScrollMode.TOP]: Array(laneCount).fill(0),
            [ScrollMode.BOTTOM]: Array(laneCount).fill(0),
        };

        const newLayout: DanmakuLayoutInfo[] = [];

        for (const comment of this.allComments) {
            const textWidth = this.tempCanvasContext.measureText(comment.content).width;
            const speed = (screenWidth + textWidth) / duration;

            let assignedLane = -1;
            let layoutStartTime = comment.time; // Default to original time; may delay if needed

            if (comment.scrollMode === ScrollMode.SLIDE) {
                let bestLane = -1;
                let earliestAvailableTime = Infinity;

                for (let i = 0; i < laneCount; i++) {
                    if (laneTracker[ScrollMode.SLIDE][i] < earliestAvailableTime) {
                        earliestAvailableTime = laneTracker[ScrollMode.SLIDE][i];
                        bestLane = i;
                    }
                }

                // Change: Instead of skipping, delay startTime if needed to fit the lane
                layoutStartTime = Math.max(comment.time, earliestAvailableTime);
                assignedLane = bestLane;

                const entryTime = duration * textWidth / (screenWidth + textWidth);
                laneTracker[ScrollMode.SLIDE][assignedLane] = layoutStartTime + entryTime + densityDelay;
            } else { // TOP or BOTTOM
                const lanes = laneTracker[comment.scrollMode];
                let bestLane = -1;
                let earliestFinishTime = Infinity;

                for (let i = 0; i < lanes.length; i++) {
                    if (lanes[i] < earliestFinishTime) {
                        earliestFinishTime = lanes[i];
                        bestLane = i;
                    }
                }

                // Change: Delay startTime if needed, similar to SLIDE
                layoutStartTime = Math.max(comment.time, earliestFinishTime);
                assignedLane = bestLane;
                lanes[bestLane] = layoutStartTime + halfDuration;
            }

            // Always add to layout since we now guarantee assignment by delaying
            newLayout.push({
                commentId: comment.id,
                lane: assignedLane,
                startTime: layoutStartTime,
                scrollMode: comment.scrollMode,
                speed: speed,
                width: textWidth
            });
        }

        this.commentLayout = newLayout;
    }


    public play(): void {
        if (this.isRunning || !this.isVisible) return;
        this.isRunning = true;
        this.lastTimestamp = 0;
        this.animationFrameId = requestAnimationFrame((t) => this.animationLoop(t));
    }

    public pause(): void {
        if (!this.isRunning) return;
        this.isRunning = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    public seek(): void {
        this.activeComments.forEach(comment => this.returnElementToPool(comment.element));
        this.activeComments = [];
        this.resyncCommentQueue();
    }

    private resyncCommentQueue(): void {
        const currentTime = this.videoPlayer.currentTime;

        this.activeComments.forEach(comment => this.returnElementToPool(comment.element));
        this.activeComments = [];

        const onScreenLayouts = this.commentLayout.filter(layout => {
            const duration = (layout.scrollMode === ScrollMode.SLIDE) ? Danmaku.DURATION : Danmaku.DURATION / 2;
            return layout.startTime <= currentTime && layout.startTime + duration > currentTime;
        });

        onScreenLayouts.forEach(layout => {
            const comment = this.allComments.find(c => c.id === layout.commentId);
            if (comment) {
                this.emitComment(comment, layout);
            }
        });

        const startIndex = this.commentLayout.findIndex(layout => layout.startTime >= currentTime);
        this.scheduledComments = startIndex === -1 ? [] : this.commentLayout.slice(startIndex);
        this.lastTimestamp = 0; // Reset timestamp for smooth animation start
    }

    public resize(): void {
        if (this.allComments.length > 0) {
            this.calculateLayouts();
            this.seek();
        }
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
        this.isVisible ? this.show() : this.hide();
        return this.isVisible;
    }

    public addComment(comment: Comment): void {
        const insertIndex = this.allComments.findIndex(c => c.time > comment.time);
        if (insertIndex === -1) {
            this.allComments.push(comment);
        } else {
            this.allComments.splice(insertIndex, 0, comment);
        }
        this.commentsCount++;
        this.calculateLayouts();
        this.seek();
    }


    public setVideoEventListeners(listeners: VideoEventListener[]): void {
        this.videoEventListeners = listeners;
    }

    public reinitialize(videoPlayer: HTMLVideoElement): void {
        this.pause();
        this.clear();

        this.videoEventListeners.forEach(({ event, listener }) => {
            this.videoPlayer.removeEventListener(event, listener);
        });
        this.videoEventListeners = [];

        this.videoPlayer = videoPlayer;
        this.resize();

        this.addVideoEventListeners();

        this.cleanupResizeObserver();
        this.setupResizeObserver();
    }

    public destroy(): void {
        this.pause();
        this.clear();
        this.videoEventListeners.forEach(({ event, listener }) => {
            this.videoPlayer.removeEventListener(event, listener);
        });
        this.videoEventListeners = [];

        this.cleanupResizeObserver();
        this.cleanupWindowResizeListener();

        this.commentPool = [];
    }

    public clear(): void {
        this.activeComments.forEach(comment => this.returnElementToPool(comment.element));
        this.activeComments = [];
        this.scheduledComments = [];
        this.allComments = [];
        this.commentLayout = [];
        this.commentsCount = 0;
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
        const stillActive: DanmakuComment[] = [];

        for (const comment of this.activeComments) {
            if (comment.isPaused) {
                stillActive.push(comment);
                continue;
            }

            if (comment.scrollMode === ScrollMode.SLIDE) {
                comment.x -= comment.speed * delta;
                comment.element.style.transform = `translateX(${comment.x}px)`;

                if (comment.x + comment.width > 0) {
                    stillActive.push(comment);
                } else {
                    this.returnElementToPool(comment.element);
                }
            } else { // TOP or BOTTOM
                if (performance.now() <= comment.expiry) {
                    stillActive.push(comment);
                } else {
                    this.returnElementToPool(comment.element);
                }
            }
        }
        this.activeComments = stillActive;
    }

    private emitNewComments(): void {
        const currentTime = this.videoPlayer.currentTime;
        while (this.scheduledComments.length > 0 && this.scheduledComments[0].startTime <= currentTime) {
            const layout = this.scheduledComments.shift()!;
            const comment = this.allComments.find(c => c.id === layout.commentId);
            if (comment) {
                this.emitComment(comment, layout);
            }
        }
    }

    private emitComment(comment: Comment, layout: DanmakuLayoutInfo): void {
        if (this.activeComments.some(ac => ac.id === comment.id)) {
            return; // Prevent duplicates
        }

        const danmakuElement = this.getElementFromPool(comment);
        const commentWidth = layout.width;

        const danmakuComment: DanmakuComment = {
            ...comment,
            lane: layout.lane,
            y: layout.lane * Danmaku.LANE_HEIGHT,
            x: 0,
            speed: layout.speed,
            width: commentWidth,
            expiry: performance.now() + Danmaku.DURATION * 1000,
            element: danmakuElement,
        };

        this.setupPopupInteraction(danmakuElement, danmakuComment);
        this.setInitialPosition(danmakuElement, danmakuComment, layout);

        this.activeComments.push(danmakuComment);
    }

    private getElementFromPool(comment: Comment): HTMLElement {
        let danmakuElement: HTMLElement;
        if (this.commentPool.length > 0) {
            danmakuElement = this.commentPool.pop()!;
            // Clear previous content and event listeners if necessary
            danmakuElement.innerHTML = '';
        } else {
            danmakuElement = document.createElement("div");
        }

        danmakuElement.className = "danmaku-comment";
        danmakuElement.textContent = comment.content;
        danmakuElement.style.color = comment.color;
        danmakuElement.style.fontSize = `${Danmaku.FONT_SIZE * this.fontSizeMultiplier}px`;
        danmakuElement.style.opacity = this.opacityLevel.toString();

        this.container.appendChild(danmakuElement);
        return danmakuElement;
    }

    private setupPopupInteraction(element: HTMLElement, danmakuComment: DanmakuComment): void {
        const popup = this.createPopup(danmakuComment);
        element.appendChild(popup);

        element.onmouseenter = () => {
            danmakuComment.isPaused = true;
            popup.style.display = "flex";
        };
        element.onmouseleave = () => {
            danmakuComment.isPaused = false;
            popup.style.display = "none";
        };
    }

    private setInitialPosition(element: HTMLElement, danmakuComment: DanmakuComment, layout: DanmakuLayoutInfo): void {
        switch (layout.scrollMode) {
            case ScrollMode.SLIDE: {
                const containerWidth = this.videoPlayer.offsetWidth;
                const timeSinceStart = this.videoPlayer.currentTime - layout.startTime;
                danmakuComment.x = containerWidth - (timeSinceStart * danmakuComment.speed);
                element.style.top = `${danmakuComment.y}px`;
                element.style.transform = `translateX(${danmakuComment.x}px)`;
                break;
            }
            case ScrollMode.TOP:
                element.style.top = `${danmakuComment.y}px`;
                element.style.left = `50%`;
                element.style.transform = `translateX(-50%)`;
                break;
            case ScrollMode.BOTTOM: {
                const totalLanes = Math.floor(this.container.offsetHeight / Danmaku.LANE_HEIGHT);
                danmakuComment.y = (totalLanes - 1 - layout.lane) * Danmaku.LANE_HEIGHT;
                element.style.top = `${danmakuComment.y}px`;
                element.style.left = `50%`;
                element.style.transform = `translateX(-50%)`;
                break;
            }
        }
    }


    private createPopup(comment: Comment): HTMLElement {
        const popup = document.createElement("div");
        popup.className = "danmaku-comment-popup";
        popup.style.display = "none";

        const copyButton = document.createElement("button");
        copyButton.className = "danmaku-popup-button";
        copyButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
        copyButton.onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(comment.content);
        };

        const reportButton = document.createElement("button");
        reportButton.className = "danmaku-popup-button";
        reportButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`;
        reportButton.onclick = (e) => {
            e.stopPropagation();
            this.reportModal.show(comment);
        };

        popup.appendChild(copyButton);
        popup.appendChild(reportButton);
        return popup;
    }

    private returnElementToPool(element: HTMLElement): void {
        // Reset properties before pooling
        element.onmouseenter = null;
        element.onmouseleave = null;
        element.remove();
        if (this.commentPool.length < this.maxPoolSize) {
            this.commentPool.push(element);
        }
    }

    // --- Event Listeners and Observers Setup ---

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

    private setupResizeObserver(): void {
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.videoPlayer);
    }

    private cleanupResizeObserver(): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
    }

    private setupWindowResizeListener(): void {
        window.addEventListener('resize', this.handleWindowResize);
    }

    private cleanupWindowResizeListener(): void {
        window.removeEventListener('resize', this.handleWindowResize);
    }

    private handleWindowResize = (): void => {
        if (this.resizeTimeoutId) {
            clearTimeout(this.resizeTimeoutId);
        }
        this.resizeTimeoutId = window.setTimeout(() => this.resize(), 200);
    };

    // --- Settings Methods ---

    public setSpeed(percent: number): void {
        this.speedMultiplier = Math.max(0.1, percent / 100);
        this.calculateLayouts();
        this.seek();
    }

    public setDensity(density: DensityMode): void {
        this.densityMode = density;
        this.calculateLayouts();
        this.seek();
    }

    public setOpacity(percent: number): void {
        this.opacityLevel = percent / 100;
        this.container.style.opacity = this.opacityLevel.toString();
        this.activeComments.forEach(c => c.element.style.opacity = this.opacityLevel.toString());
    }

    public setFontSize(percent: number): void {
        this.fontSizeMultiplier = Math.max(0.1, percent / 100);
        this.calculateLayouts();
        this.seek();
    }
}
