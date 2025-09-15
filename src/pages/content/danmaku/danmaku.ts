import { Comment } from "../api";
import { ReportModal } from "../modal-report/modal-report";
import { DensityConfig, DensityMode, ScrollMode } from "../interfaces/enum";
import { createCanvas, CanvasRenderingContext2D } from 'canvas';

// This interface holds the pre-calculated layout information for a comment.
// It references a comment by its ID to save memory.
interface DanmakuLayoutInfo {
    commentId: number;
    lane: number;
    startTime: number; // The actual, calculated time the comment should appear on screen (in milliseconds).
    scrollMode: ScrollMode;
    speed: number;
    width: number;
}

type VideoEventListener = {
    event: string;
    listener: () => void;
};

// noinspection D
export class Danmaku {
    private container: HTMLElement;
    public videoPlayer: HTMLVideoElement;
    private controls: HTMLElement;

    // Stores the original comment data from the API.
    public allComments: Comment[] = [];
    // Stores the pre-calculated layout for every comment, sorted by startTime.
    private commentLayout: DanmakuLayoutInfo[] = [];

    private nextEmitIndex: number = 0;

    private isRunning = false;
    private isResyncing = false;
    private needsResync = false;
    private lastTimestamp: number = 0;
    private animationFrameId: number | null = null;
    private videoEventListeners: VideoEventListener[] = [];
    private reportModal: ReportModal;
    private isVisible: boolean = true;
    public get getCommentsCount(): number {
        return this.commentsCount;
    }
    private commentsCount: number = 0;

    // --- Constants ---
    private readonly DURATION = 7000; // milliseconds
    private laneHeight: number; // pixels
    private fontSize: number; // pixels

    // --- Observers and Timers ---
    private resizeObserver: ResizeObserver | null = null;
    private resizeTimeoutId: number | null = null;
    private resyncTimeoutId: number | null = null;
    private lastKnownWidth: number = 0;
    private lastKnownHeight: number = 0;

    // --- Settings ---
    private speedMultiplier: number = 1;
    private opacityLevel: number = 1;
    private fontSizeMultiplier: number = 1;
    private densityMode: DensityMode = DensityMode.NORMAL;

    // --- Performance ---
    private commentPool: HTMLElement[] = [];
    private maxPoolSize: number = 50;
    private tempCanvasContext: CanvasRenderingContext2D;

    // --- NEW: Popup Management ---
    private popupElement: HTMLElement | null = null;
    private hoveredComment: { element: HTMLElement, isPaused: boolean, commentId: number, scrollMode: ScrollMode } | null = null;
    private showPopupTimeout: number | null = null;
    private currentMouseX: number = 0;
    private currentMouseY: number = 0;

    constructor();
    constructor(videoPlayer: HTMLVideoElement, container: HTMLElement);

    constructor(videoPlayer?: HTMLVideoElement, container?: HTMLElement, controls?: HTMLElement) {

        this.videoPlayer = videoPlayer || document.createElement("video");
        this.container = container || document.createElement("div");
        this.controls = controls || document.createElement("div");

        this.fontSize = 24; // pixels
        this.laneHeight = 30; // pixels
        this.reportModal = new ReportModal();
        const tempCanvas = createCanvas(500, 50);
        this.tempCanvasContext = tempCanvas.getContext('2d');

        // Comprehensive logging
        console.log('[Danmaku] Constructor: Instance created.');
        console.log('[Danmaku] Constructor: Initial values set', {
            fontSize: this.fontSize,
            laneHeight: this.laneHeight,
        });

        if (videoPlayer && container) {
            this.lastKnownWidth = container.offsetWidth;
            this.lastKnownHeight = container.offsetHeight;
            console.log('[Danmaku] Constructor: Container and videoPlayer provided. Initializing listeners and observers.', {
                lastKnownWidth: this.lastKnownWidth,
                lastKnownHeight: this.lastKnownHeight
            });
            this.addVideoEventListeners();
            this.setupResizeObserver();
            this.setupWindowResizeListener();
            this.initializePopup(); // NEW: Initialize the single popup
        }
    }

    /**
     * Entry point for loading comments. Sorts comments by time,
     * pre-calculates their layout, and prepares them for rendering.
     */
    public setComments(comments: Comment[]): void {
        console.log(`[Danmaku] setComments: Received ${comments.length} comments.`);
        this.allComments = comments.sort((a, b) => a.time - b.time);
        console.log('[Danmaku] setComments: Comments sorted by time.');
        this.calculateLayouts();
        this.nextEmitIndex = 0;
        this.commentsCount = this.allComments.length;
        console.log('[Danmaku] setComments: Setup complete.', {
            nextEmitIndex: this.nextEmitIndex,
            commentsCount: this.commentsCount,
            layoutCount: this.commentLayout.length
        });
    }

    public getComments(): Comment[] {
        return this.allComments;
    }

    /**
     * The core layout calculation logic. Iterates through all comments and assigns
     * them a specific lane and start time based on availability, preventing overlaps.
     */
    private calculateLayouts(): void {
        console.log('[Danmaku] calculateLayouts: Starting layout calculation.');
        const containerWidth = this.container.offsetWidth || this.lastKnownWidth || this.videoPlayer.offsetWidth || 1280;
        const screenHeight = this.lastKnownHeight || this.videoPlayer.offsetHeight;
        const laneCount = (Math.floor(screenHeight / this.laneHeight) || 10) - 1;
        const duration = this.DURATION / this.speedMultiplier;

        console.log('[Danmaku] calculateLayouts: Parameters', { containerWidth, screenHeight, laneCount, duration, densityMode: this.densityMode });

        this.tempCanvasContext.font = `${this.fontSize * this.fontSizeMultiplier}px Roboto, Arial, sans-serif`;

        const laneTracker = {
            [ScrollMode.SLIDE]: Array(laneCount).fill(0),
            [ScrollMode.TOP]: Array(laneCount).fill(0),
            [ScrollMode.BOTTOM]: Array(laneCount).fill(0),
        };

        const newLayout: DanmakuLayoutInfo[] = [];

        for (const comment of this.allComments) {
            const textWidth = this.tempCanvasContext.measureText(comment.content).width;
            const speed = (containerWidth + textWidth + containerWidth / 5) / (duration / 1000);

            let assignedLane = -1;
            let layoutStartTime = comment.time;
            const densityDelay = DensityConfig[this.densityMode].delay;
            const halfDuration = duration / 2;

            if (comment.scrollMode === ScrollMode.SLIDE) {
                let bestLane = -1;
                let earliestAvailableTime = Infinity;

                for (let i = 0; i < laneCount; i++) {
                    if (laneTracker[ScrollMode.SLIDE][i] < earliestAvailableTime) {
                        earliestAvailableTime = laneTracker[ScrollMode.SLIDE][i];
                        bestLane = i;
                    }
                }

                layoutStartTime = Math.max(comment.time, earliestAvailableTime);
                assignedLane = bestLane;

                const entryTime = layoutStartTime + ((textWidth + 25) / speed) * 1000; // 25px buffer
                laneTracker[ScrollMode.SLIDE][assignedLane] = entryTime + densityDelay;
            } else {
                const lanes = laneTracker[comment.scrollMode];
                let bestLane = -1;
                let earliestFinishTime = Infinity;

                for (let i = 0; i < lanes.length; i++) {
                    if (lanes[i] < earliestFinishTime) {
                        earliestFinishTime = lanes[i];
                        bestLane = i;
                    }
                }

                layoutStartTime = Math.max(comment.time, earliestFinishTime);
                assignedLane = bestLane;
                lanes[bestLane] = layoutStartTime + halfDuration + densityDelay;
            }

            newLayout.push({
                commentId: comment.id,
                lane: assignedLane,
                startTime: layoutStartTime,
                scrollMode: comment.scrollMode,
                speed: speed,
                width: textWidth
            });
        }

        this.commentLayout = newLayout.sort((a, b) => a.startTime - b.startTime);
        console.log(`[Danmaku] calculateLayouts: Finished. Calculated ${this.commentLayout.length} layouts.`);
    }

    private getDuration(layout: DanmakuLayoutInfo): number {
        return layout.scrollMode === ScrollMode.SLIDE
            ? this.DURATION / this.speedMultiplier
            : (this.DURATION / this.speedMultiplier) / 2;
    }

    public play(): void {
        if (this.isRunning || !this.isVisible) return;
        console.log('[Danmaku] play: Starting animation loop.');
        this.isRunning = true;

        this.container.querySelectorAll('.danmaku-comment').forEach(el => {
            (el as HTMLElement).style.animationPlayState = 'running';
        });

        this.lastTimestamp = 0;
        this.animationFrameId = requestAnimationFrame((t) => this.animationLoop(t));
    }

    public pause(): void {
        if (!this.isRunning) return;
        console.log('[Danmaku] pause: Stopping animation loop.');
        this.isRunning = false;

        this.container.querySelectorAll('.danmaku-comment').forEach(el => {
            (el as HTMLElement).style.animationPlayState = 'paused';
        });

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    public resyncCommentQueue(): void {
        if (this.commentLayout.length === 0) return;
        console.log('[Danmaku] resyncCommentQueue: Resynchronizing comment queue with video time. ' + this.commentLayout);
        const currentTime = this.videoPlayer.currentTime * 1000;
        console.log(`[Danmaku] resyncCommentQueue: Resyncing to video time ${currentTime.toFixed(2)}ms.`);

        this.container.querySelectorAll('.danmaku-comment').forEach(el => this.returnElementToPool(el as HTMLElement));
        console.log('[Danmaku] resyncCommentQueue: Cleared all visible comments from DOM.');

        this.nextEmitIndex = this.findFirstLayoutAfter(currentTime);
        console.log(`[Danmaku] resyncCommentQueue: Next comment to be emitted is at index ${this.nextEmitIndex}.`);

        let reEmittedCount = 0;
        for (let i = 0; i < this.nextEmitIndex; i++) {
            const layout = this.commentLayout[i];
            const duration = this.getDuration(layout);
            if (layout.startTime + duration > currentTime) {
                const comment = this.allComments.find(c => c.id === layout.commentId);
                if (comment) {
                    this.emitComment(comment, layout);
                    reEmittedCount++;
                }
            }
        }
        console.log(`[Danmaku] resyncCommentQueue: Re-emitted ${reEmittedCount} comments that should be on screen.`);
        this.lastTimestamp = 0;
    }

    private debouncedResync = () => {
        if (this.resyncTimeoutId) {
            clearTimeout(this.resyncTimeoutId);
        }
        this.resyncTimeoutId = window.setTimeout(() => {
            this.resyncCommentQueue();
        }, 50); // 50ms debounce time
    }

    private findFirstLayoutAfter(time: number): number {
        // Binary search to find the first comment that should appear after the current time
        let low = 0;
        let high = this.commentLayout.length;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (this.commentLayout[mid].startTime <= time) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        return low;
    }

    public resize(): void {
        console.log('[Danmaku] resize: Detected resize. Recalculating layouts and resyncing queue.');
        if (this.allComments.length > 0) {
            this.calculateLayouts();
            this.debouncedResync();
        }
    }

    public show(): void {
        console.log('[Danmaku] show: Making comments visible.');
        this.container.style.display = "";
        this.isVisible = true;
        if (!this.videoPlayer.paused) {
            this.play();
        }
    }

    public hide(): void {
        console.log('[Danmaku] hide: Hiding comments.');
        this.container.style.display = "none";
        this.isVisible = false;
        this.pause();
    }

    public toggleVisibility(force?: boolean): boolean {
        this.isVisible = force ?? !this.isVisible;
        console.log(`[Danmaku] toggleVisibility: Visibility set to ${this.isVisible}.`);
        if (this.isVisible) {
            this.show();
            this.resyncCommentQueue();
        } else {
            this.hide();
        }
        return this.isVisible;
    }

    public addComment(comment: Comment): void {
        console.log('[Danmaku] addComment: Adding new comment.', { comment });
        const insertIndex = this.allComments.findIndex(c => c.time > comment.time);
        if (insertIndex === -1) {
            this.allComments.push(comment);
        } else {
            this.allComments.splice(insertIndex, 0, comment);
        }
        this.commentsCount++;
        this.calculateLayouts();
        this.resyncCommentQueue();
    }

    public setVideoEventListeners(listeners: VideoEventListener[]): void {
        this.videoEventListeners = listeners;
    }

    public reinitialize(videoPlayer: HTMLVideoElement): void {
        console.log('[Danmaku] reinitialize: Reinitializing with a new video player.');
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
        console.log('[Danmaku] destroy: Destroying instance, cleaning up all resources.');
        this.pause();
        this.clear();
        this.videoEventListeners.forEach(({ event, listener }) => {
            this.videoPlayer.removeEventListener(event, listener);
        });
        this.videoEventListeners = [];

        this.container.removeEventListener('mouseover', this.handleContainerMouseOver);
        this.container.removeEventListener('mouseout', this.handleContainerMouseOut);
        this.popupElement?.remove();

        if (this.showPopupTimeout) clearTimeout(this.showPopupTimeout);

        this.cleanupResizeObserver();
        this.cleanupWindowResizeListener();
        this.commentPool = [];
    }

    public clear(): void {
        console.log('[Danmaku] clear: Clearing all comments and layouts.');
        this.allComments = [];
        this.commentLayout = [];
        this.nextEmitIndex = 0;
        this.commentsCount = 0;
        this.container.innerHTML = '';
    }

    private animationLoop(timestamp: number): void {
        if (!this.isRunning) return;
        this.emitNewComments();
        this.animationFrameId = requestAnimationFrame((t) => this.animationLoop(t));
    }

    private emitNewComments(): void {
        if (!this.videoPlayer) return;
        const currentTime = this.videoPlayer.currentTime * 1000;
        while (this.nextEmitIndex < this.commentLayout.length && this.commentLayout[this.nextEmitIndex].startTime <= currentTime) {
            const layout = this.commentLayout[this.nextEmitIndex];
            const comment = this.allComments.find(c => c.id === layout.commentId);
            if (comment) {
                this.emitComment(comment, layout);
            }
            this.nextEmitIndex++;
        }
    }

    private emitComment(comment: Comment, layout: DanmakuLayoutInfo): void {
        try {
            // console.log(`[Danmaku] emitComment: Emitting comment ID ${comment.id}`, { layout });
            const danmakuElement = this.getElementFromPool(comment);
            this.setInitialPosition(danmakuElement, layout);
            danmakuElement.classList.add(`danmaku-animation-${layout.scrollMode}`);
            if (this.videoPlayer.paused) {
                danmakuElement.style.animationPlayState = 'paused';
            }
            danmakuElement.addEventListener('animationend', () => {
                this.returnElementToPool(danmakuElement);
            }, { once: true });
        } catch (error) {
            console.error(`[Danmaku] emitComment: Failed to emit comment ${comment.id}:`, error);
        }
    }

    private getElementFromPool(comment: Comment): HTMLElement {
        let danmakuElement: HTMLElement;
        if (this.commentPool.length > 0) {
            danmakuElement = this.commentPool.pop()!;
            danmakuElement.removeAttribute('style');
            danmakuElement.className = 'danmaku-comment';
        } else {
            danmakuElement = document.createElement("div");
            danmakuElement.className = "danmaku-comment";
        }

        danmakuElement.textContent = comment.content;
        danmakuElement.style.color = comment.color;
        danmakuElement.style.fontSize = `${this.fontSize * this.fontSizeMultiplier}px`;
        danmakuElement.style.opacity = this.opacityLevel.toString();
        danmakuElement.dataset.commentId = comment.id.toString();

        this.container.appendChild(danmakuElement);
        return danmakuElement;
    }

    private setInitialPosition(element: HTMLElement, layout: DanmakuLayoutInfo): void {
        const currentTime = this.videoPlayer.currentTime * 1000;
        const timeSinceStart = currentTime - layout.startTime;
        const duration = this.getDuration(layout);
        
        element.style.setProperty('--danmaku-duration', `${duration / 1000}s`);

        switch (layout.scrollMode) {
            case ScrollMode.SLIDE: {
                element.style.top = `${layout.lane * this.laneHeight}px`;
                if (timeSinceStart > 0) {
                    // This logic is now handled by animation-delay.
                    // To correctly handle resync, we set a negative animation-delay.
                    element.style.animationDelay = `-${timeSinceStart / 1000}s`;
                }
                break;
            }
            case ScrollMode.TOP: {
                element.style.top = `${layout.lane * this.laneHeight}px`;
                element.style.left = `50%`;
                element.style.transform = `translateX(-50%)`;
                if (timeSinceStart > 0) {
                    element.style.animationDelay = `-${timeSinceStart / 1000}s`;
                }
                break;
            }
            case ScrollMode.BOTTOM: {
                const totalLanes = Math.floor((this.lastKnownHeight || this.videoPlayer.offsetHeight) / this.laneHeight);
                const y = (totalLanes - 1 - layout.lane) * this.laneHeight;
                element.style.top = `${y}px`;
                element.style.left = `50%`;
                element.style.transform = `translateX(-50%)`;
                 if (timeSinceStart > 0) {
                    element.style.animationDelay = `-${timeSinceStart / 1000}s`;
                }
                break;
            }
        }
    }

    private returnElementToPool(element: HTMLElement): void {
        element.remove();
        if (this.commentPool.length < this.maxPoolSize) {
            element.removeAttribute('style');
            element.className = 'danmaku-comment';
            this.commentPool.push(element);
        }
    }

    // --- NEW: Popup Interaction Logic ---

    private initializePopup(): void {
        console.log('[Danmaku] initializePopup: Creating and appending popup element.');
        this.popupElement = document.createElement("div");
        this.popupElement.className = "danmaku-comment-popup";

        const copyButton = document.createElement("button");
        copyButton.className = "danmaku-popup-button copy-btn";
        copyButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;

        const reportButton = document.createElement("button");
        reportButton.className = "danmaku-popup-button report-btn";
        reportButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`;

        this.popupElement.appendChild(copyButton);
        this.popupElement.appendChild(reportButton);
        this.container.appendChild(this.popupElement);

        this.container.addEventListener('mouseover', this.handleContainerMouseOver, { passive: true });
        this.container.addEventListener('mouseout', this.handleContainerMouseOut, { passive: true });

        this.popupElement.addEventListener('mouseenter', () => {
            if (this.popupElement) this.popupElement.classList.add('hover');
        });

        this.popupElement.addEventListener('mouseleave', () => {
            this.hidePopup();
        }, { passive: true });

        window.addEventListener('mousemove', this.handleMouseMove, { passive: true });
    }

    private handleContainerMouseOver = (event: MouseEvent): void => {
        const target = event.target as HTMLElement;
        if (target.classList.contains('danmaku-comment')) {
            const commentId = parseInt(target.dataset.commentId || '', 10);
            if (!isNaN(commentId)) {
                const commentData = this.allComments.find(c => c.id === commentId);
                if (commentData) {
                    if (this.showPopupTimeout) clearTimeout(this.showPopupTimeout);
                    this.currentMouseX = event.clientX;
                    this.currentMouseY = event.clientY;
                    this.showPopupTimeout = window.setTimeout(() => {
                        this.showPopup(this.currentMouseX, this.currentMouseY, target, commentData);
                        this.showPopupTimeout = null;
                    }, 200);
                }
            }
        }
    };

    private handleContainerMouseOut = (event: MouseEvent): void => {
        const relatedTarget = event.relatedTarget as HTMLElement;
        if (this.popupElement && !this.popupElement.contains(relatedTarget)) {
            if (this.showPopupTimeout) {
                clearTimeout(this.showPopupTimeout);
                this.showPopupTimeout = null;
            }
            this.hidePopup();
        }
    };

    private handleMouseMove = (event: MouseEvent): void => {
        this.currentMouseX = event.clientX;
        this.currentMouseY = event.clientY;
    };
    
    private showPopup(clientX: number, clientY: number, element: HTMLElement, commentData: Comment): void {
        if (!commentData) return;
        console.log(`[Danmaku] showPopup: Showing popup for comment ID ${commentData.id}`);

        this.hoveredComment = { element, isPaused: true, commentId: commentData.id, scrollMode: commentData.scrollMode };
        element.style.animationPlayState = 'paused';

        if (!this.popupElement) return;

        const copyBtn = this.popupElement.querySelector('.copy-btn') as HTMLElement;
        const reportBtn = this.popupElement.querySelector('.report-btn') as HTMLElement;

        copyBtn.onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(element.textContent || '').catch(err => console.warn('Copy failed:', err));
        };
        reportBtn.onclick = (e) => {
            e.stopPropagation();
            this.reportModal.show(commentData);
        };

        const popupRect = this.popupElement.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        const commentRect = element.getBoundingClientRect();
        const controlsRect = this.controls.getBoundingClientRect();

        const availableHeight = containerRect.height - (controlsRect.height + 10);

        const relativeCommentTop = commentRect.top - containerRect.top;
        const relativeCommentBottom = commentRect.bottom - containerRect.top;

        console.log('[Danmaku] showPopup: Positioning calculations', {
            popupRect, containerRect, commentRect, controlsRect, availableHeight, relativeCommentTop, relativeCommentBottom
        });

        let top = relativeCommentBottom;
        if (top + popupRect.height > availableHeight) {
            const aboveTop = relativeCommentTop - popupRect.height;
            if (aboveTop >= 0) {
                top = aboveTop;
            } else {
                top = availableHeight - popupRect.height;
            }
        }
    
        let left = clientX - containerRect.left - (popupRect.width / 2);
        left = Math.max(0, Math.min(left, containerRect.width - popupRect.width));
    
        console.log('[Danmaku] showPopup: Final position calculated', { top, left });
        this.popupElement.style.top = `${top}px`;
        this.popupElement.style.left = `${left}px`;
        this.popupElement.style.visibility = 'visible';
        this.popupElement.style.display = 'flex';
    }
    
    private hidePopup(): void {
        if (this.hoveredComment) {
            console.log(`[Danmaku] hidePopup: Hiding popup for comment ID ${this.hoveredComment.commentId}`);
            if (!this.videoPlayer.paused) {
                this.hoveredComment.element.style.animationPlayState = 'running';
            }
            this.hoveredComment = null;
        }
        if (this.popupElement) {
            this.popupElement.style.display = 'none';
            this.popupElement.style.visibility = 'hidden';
        }
    }

    // --- Event Listeners and Observers Setup ---

    private addVideoEventListeners(): void {
        const listeners: VideoEventListener[] = [
            { event: "play", listener: () => this.play() },
            { event: "pause", listener: () => this.pause() },
            { event: "seeked", listener: () => this.debouncedResync() },
            { event: "waiting", listener: () => this.pause() },
            { event: "playing", listener: () => this.play() },
        ];
        listeners.forEach(({ event, listener }) => {
            this.videoPlayer.addEventListener(event, listener);
            this.videoEventListeners.push({ event, listener });
        });
        console.log(`[Danmaku] addVideoEventListeners: Added ${listeners.length} listeners to the video player.`);
    }

    private setupResizeObserver(): void {
        this.resizeObserver = new ResizeObserver((entries) => {
            if (entries && entries.length > 0) {
                const { width, height } = entries[0].contentRect;
                if (width !== this.lastKnownWidth || height !== this.lastKnownHeight) {
                    console.log(`[Danmaku] ResizeObserver: Detected container size change to ${width}x${height}.`);
                    this.lastKnownWidth = width;
                    this.lastKnownHeight = height;
                    this.resize();
                }
            } else {
                this.resize();
            }
        });
        this.resizeObserver.observe(this.videoPlayer);
        console.log('[Danmaku] setupResizeObserver: Observer is now watching the video player.');
    }

    private cleanupResizeObserver(): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        console.log('[Danmaku] cleanupResizeObserver: Observer disconnected.');
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
        console.log(`[Danmaku] setSpeed: Speed multiplier set to ${this.speedMultiplier}.`);
        this.calculateLayouts();
        this.resyncCommentQueue();
    }

    public setDensity(density: DensityMode): void {
        this.densityMode = density;
        console.log(`[Danmaku] setDensity: Density mode set to '${this.densityMode}'.`);
        this.calculateLayouts();
        this.resyncCommentQueue();
    }

    public setOpacity(percent: number): void {
        this.opacityLevel = percent / 100;
        console.log(`[Danmaku] setOpacity: Opacity level set to ${this.opacityLevel}.`);
        this.container.style.opacity = this.opacityLevel.toString();
    }

    public setFontSize(percent: number): void {
        this.fontSizeMultiplier = Math.max(0.1, percent / 100);
        this.laneHeight = Math.floor(this.fontSize * this.fontSizeMultiplier * 1.2);
        console.log(`[Danmaku] setFontSize: Font size multiplier set to ${this.fontSizeMultiplier}, new lane height is ${this.laneHeight}px.`);
        this.calculateLayouts();
        this.resyncCommentQueue();
    }
}