import { Comment } from "../api";
import { ReportModal } from "../modal-report/modal-report";
import { DensityMode, DensityConfig, ScrollMode } from "../interfaces/enum";

interface DanmakuComment extends Comment {
    y: number;
    x: number;
    speed: number;
    width: number;
    lane: number;
    expiry: number;
    element: HTMLElement;
    isPaused?: boolean;
    startTime: number; // Track when this comment was created
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
    private static readonly MAX_COMMENT_DELAY = 5000; // Maximum 5 seconds delay for comments

    private resizeObserver: ResizeObserver | null = null;
    private lastVideoRect: DOMRect | null = null;

    // Settings properties
    private speedMultiplier: number = 1;
    private opacityLevel: number = 1;
    private fontSizeMultiplier: number = 1;
    private densityMode: DensityMode = DensityMode.NORMAL;

    // Performance optimizations
    private commentPool: HTMLElement[] = [];
    private maxPoolSize: number = 50;
    private pendingRemovals: DanmakuComment[] = [];
    private lastEmitTime: number = 0;
    private emitThrottle: number = 16; // ~60fps

    constructor(videoPlayer: HTMLVideoElement, container: HTMLElement) {
        this.videoPlayer = videoPlayer;
        this.container = container;
        this.reportModal = new ReportModal();
        this.resize();
        this.addVideoEventListeners();
        this.setupResizeObserver();
        this.setupWindowResizeListener();
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
        this.isRunning = true;
        this.lastTimestamp = 0; // Reset timestamp when playing
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
        // Batch DOM removals
        const elementsToRemove = this.activeComments.map(comment => comment.element);
        elementsToRemove.forEach(element => element.remove());
        this.activeComments = [];

        this.resyncCommentQueue();

        // Reset lane tracking
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

        // Batch DOM removals
        const elementsToRemove = this.activeComments.map(comment => comment.element);
        elementsToRemove.forEach(element => element.remove());
        this.activeComments = [];

        // Emit all on-screen comments at once
        onScreenComments.forEach((comment) => {
            this.emitComment(comment);
        });

        const startIndex = this.allComments.findIndex(
            (comment) => comment.time >= currentTime
        );

        this.comments = startIndex === -1 ? [] : this.allComments.slice(startIndex);
        this.lastTimestamp = 0;
    }

    public resize(): void {
        const videoRect = this.videoPlayer.getBoundingClientRect();
        const numLanes = Math.floor(videoRect.height / Danmaku.LANE_HEIGHT);
        
        // Store the current video rect for comparison
        this.lastVideoRect = videoRect;
        
        // Only recreate lanes if the number of lanes has changed
        if (this.slidingLanes.length !== numLanes) {
            this.slidingLanes = new Array(numLanes).fill(0);
            this.topLanes = new Array(numLanes).fill(0);
            this.bottomLanes = new Array(numLanes).fill(0);
            
            // Re-seek to reposition all comments with the new lane configuration
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
        this.pause();
        this.clear();

        this.videoEventListeners.forEach(({ event, listener }) => {
            this.videoPlayer.removeEventListener(event, listener);
        });
        this.videoEventListeners = [];

        this.videoPlayer = videoPlayer;
        this.resize();

        this.addVideoEventListeners();
        
        // Clean up and set up resize observers again
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
        
        // Clean up resize observers
        this.cleanupResizeObserver();
        this.cleanupWindowResizeListener();
        
        // Clear comment pool
        this.commentPool = [];
    }
    
    private setupResizeObserver(): void {
        this.resizeObserver = new ResizeObserver(() => {
            this.resize();
        });
        this.resizeObserver.observe(this.videoPlayer);
    }
    
    private cleanupResizeObserver(): void {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
    }
    
    private setupWindowResizeListener(): void {
        window.addEventListener('resize', this.handleWindowResize);
    }
    
    private cleanupWindowResizeListener(): void {
        window.removeEventListener('resize', this.handleWindowResize);
    }
    
    private handleWindowResize = (): void => {
        if (this.resizeTimeoutId) {
            window.clearTimeout(this.resizeTimeoutId);
        }
        
        this.resizeTimeoutId = window.setTimeout(() => {
            this.resize();
        }, 100);
    };
    
    private resizeTimeoutId: number | null = null;

    public clear(): void {
        // Batch DOM removals
        const elementsToRemove = this.activeComments.map(comment => comment.element);
        elementsToRemove.forEach(element => element.remove());
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
        const stillActive: DanmakuComment[] = [];
        
        // Process comments in batches for better performance
        for (let i = 0; i < this.activeComments.length; i++) {
            const comment = this.activeComments[i];
            
            if (comment.isPaused) {
                comment.expiry += delta * 1000;
                stillActive.push(comment);
                continue;
            }

            if (comment.scrollMode === ScrollMode.SLIDE) {
                comment.x -= comment.speed * delta;
                comment.element.style.transform = `translateX(${comment.x}px)`;
                
                // Only check removal condition
                if (comment.x + comment.width >= 0) {
                    stillActive.push(comment);
                } else {
                    this.pendingRemovals.push(comment);
                }
            } else {
                if (now <= comment.expiry) {
                    stillActive.push(comment);
                } else {
                    this.pendingRemovals.push(comment);
                }
            }
        }
        
        // Batch remove elements
        if (this.pendingRemovals.length > 0) {
            this.pendingRemovals.forEach(comment => comment.element.remove());
            this.pendingRemovals = [];
        }
        
        this.activeComments = stillActive;
    }

    private emitNewComments(): void {
        const currentTime = this.videoPlayer.currentTime;
        const now = performance.now();
        
        // Throttle comment emission to reduce CPU usage
        if (now - this.lastEmitTime < this.emitThrottle) {
            return;
        }
        this.lastEmitTime = now;
        
        // Process comments that are due to be displayed
        let processedCount = 0;
        const maxProcessedPerFrame = 10; // Limit processing per frame
        
        while (this.comments.length > 0 && processedCount < maxProcessedPerFrame) {
            const comment = this.comments[0];
            const timeDiff = currentTime - comment.time;
            
            // If comment is within the allowable delay window and we can display it, do so
            if (timeDiff >= 0 && this.canDisplayComment(comment)) {
                this.comments.shift();
                this.emitComment(comment);
                processedCount++;
            } 
            // If comment is more than MAX_COMMENT_DELAY past its time, skip it
            else if (timeDiff > Danmaku.MAX_COMMENT_DELAY / 1000) {
                this.comments.shift();
                processedCount++;
            } 
            else {
                // Comment is not yet due or is too far past its time
                break;
            }
        }
    }
    
    private canDisplayComment(comment: Comment): boolean {
        const now = performance.now();
        const lanes = this.getLanesForMode(comment.scrollMode);
        
        // Check if any lane is available for this comment
        for (let i = 0; i < lanes.length; i++) {
            if (this.isLaneAvailable(lanes, i, now)) {
                return true;
            }
        }
        return false;
    }

    private emitComment(comment: Comment, timeElapsed = 0): void {
        // Check if this comment is already active to prevent duplicates
        const isAlreadyActive = this.activeComments.some(activeComment => 
            activeComment.id === comment.id && 
            activeComment.time === comment.time && 
            activeComment.content === comment.content
        );
        
        if (isAlreadyActive) {
            return;
        }

        // Reuse DOM elements from pool when possible
        let danmakuElement: HTMLElement;
        if (this.commentPool.length > 0) {
            danmakuElement = this.commentPool.pop()!;
            danmakuElement.textContent = comment.content;
            // Reset any previous styles
            danmakuElement.className = "danmaku-comment";
            danmakuElement.style.color = comment.color;
            danmakuElement.style.fontSize = `${Danmaku.FONT_SIZE * this.fontSizeMultiplier}px`;
            
            // Clear existing popup if any
            const existingPopup = danmakuElement.querySelector('.danmaku-comment-popup');
            if (existingPopup) {
                existingPopup.remove();
            }
        } else {
            danmakuElement = document.createElement("div");
            danmakuElement.textContent = comment.content;
            danmakuElement.classList.add("danmaku-comment");
            danmakuElement.style.color = comment.color;
            danmakuElement.style.fontSize = `${Danmaku.FONT_SIZE * this.fontSizeMultiplier}px`;
        }

        // Create popup only when needed
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
            // Return element to pool instead of discarding
            if (this.commentPool.length < this.maxPoolSize) {
                this.commentPool.push(danmakuElement);
            }
            return;
        }

        this.container.appendChild(danmakuElement);
        const commentWidth = danmakuElement.offsetWidth;

        const now = performance.now();
        const danmakuComment: DanmakuComment = {
            ...comment,
            y: lane * Danmaku.LANE_HEIGHT,
            x: 0,
            speed: 0,
            width: commentWidth,
            lane,
            expiry: now + Danmaku.DURATION * 1000,
            element: danmakuElement,
            isPaused: false,
            startTime: now, // Track when this comment was created
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
            case ScrollMode.SLIDE:
                {
                    const containerWidth = this.container.offsetWidth;
                    danmakuComment.speed = (containerWidth + commentWidth) / Danmaku.DURATION * this.speedMultiplier;
                    
                    // Calculate position based on actual time since comment should have started
                    const timeSinceStart = this.videoPlayer.currentTime - comment.time;
                    const distanceTraveled = timeSinceStart * danmakuComment.speed;
                    danmakuComment.x = containerWidth - distanceTraveled;
                    
                    danmakuElement.style.top = `${danmakuComment.y}px`;
                    danmakuElement.style.transform = `translateX(${danmakuComment.x}px)`;
                    
                    // Set the lane availability time based on the time it takes for the comment to clear the lane
                    this.slidingLanes[lane] = now + ((commentWidth + danmakuComment.x) / danmakuComment.speed) * 1000;
                    break;
                }
            case ScrollMode.TOP:
                danmakuElement.style.top = `${danmakuComment.y}px`;
                danmakuElement.style.left = `50%`;
                danmakuElement.style.transform = `translateX(-50%)`;
                this.topLanes[lane] = danmakuComment.expiry;
                break;
            case ScrollMode.BOTTOM:
                {
                    const totalLanes = Math.floor(
                        this.container.offsetHeight / Danmaku.LANE_HEIGHT
                    );
                    danmakuComment.y = (totalLanes - 1 - lane) * Danmaku.LANE_HEIGHT;
                    danmakuElement.style.top = `${danmakuComment.y}px`;
                    danmakuElement.style.left = `50%`;
                    danmakuElement.style.transform = `translateX(-50%)`;
                    this.bottomLanes[lane] = danmakuComment.expiry;
                    break;
                }
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
        
        // For dense mode, always allow comments (no delay)
        if (this.densityMode === DensityMode.DENSE) {
            return true;
        }
        
        // For sparse and normal modes, check if enough time has passed
        const timeSinceLastComment = now - lanes[laneIndex];
        return timeSinceLastComment >= (DensityConfig[this.densityMode] - 100); // Small buffer for timing precision
    }

    private getLanesForMode(mode: ScrollMode): number[] {
        switch (mode) {
            case ScrollMode.SLIDE:
                return this.slidingLanes;
            case ScrollMode.TOP:
                return this.topLanes;
            case ScrollMode.BOTTOM:
                return this.bottomLanes;
        }
    }

    // Settings methods
    public setSpeed(percent: number): void {
        this.speedMultiplier = percent / 100;
        // Apply speed to all active comments
        this.activeComments.forEach((comment) => {
            if (comment.scrollMode === ScrollMode.SLIDE) {
                const containerWidth = this.container.offsetWidth;
                comment.speed = (containerWidth + comment.width) / Danmaku.DURATION * this.speedMultiplier;
            }
        });
    }

    public setDensity(density: DensityMode): void {
        this.densityMode = density;
        
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
