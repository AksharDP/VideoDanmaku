import { Comment } from "../api";
import { ReportModal } from "../modal-report/modal-report";
import { DensityConfig, DensityMode, ScrollMode } from "../interfaces/enum";

type VideoEventListener = {
    event: string;
    listener: () => void;
};

export class Danmaku {
    private container: HTMLElement;
    public videoPlayer: HTMLVideoElement;
    private controls: HTMLElement;

    public allComments: Comment[] = [];
    public get getCommentsCount(): number { return this.allComments.length; };
    private laneCount: number = 10;
    private slidingLanes: number[] = [];
    private topBottomLanes: number[] = [];

    private nextEmitIndex: number = 0;
    private isRunning = false;
    private reportModal: ReportModal;
    private isVisible: boolean = true;

    // --- Constants ---
    private readonly DURATION = 7000; // milliseconds
    private laneHeight: number; // pixels
    private fontSize: number; // pixels

    // --- Observers and Timers ---
    private resizeObserver: ResizeObserver | null = null;
    private resizeTimeoutId: number | null = null;
    private lastKnownWidth: number = 0;
    private lastKnownHeight: number = 0;

    // --- Settings ---
    private speedMultiplier: number = 1;
    private opacityLevel: number = 1;
    private fontSizeMultiplier: number = 1;
    private densityMode: DensityMode = DensityMode.NORMAL;

    // --- Performance ---
    private commentPool: HTMLElement[] = [];
    private maxPoolSize: number = 100;
    private tempCanvasContext: CanvasRenderingContext2D;

    // --- Popup Management ---
    private popupElement: HTMLElement | null = null;
    private hoveredComment: { element: HTMLElement, commentId: number } | null = null;
    private showPopupTimeout: number | null = null;

    constructor(videoPlayer?: HTMLVideoElement, container?: HTMLElement, controls?: HTMLElement) {
        console.debug('[Danmaku] Constructor called', { videoPlayer, container, controls });
        this.videoPlayer = videoPlayer || document.createElement("video");
        this.container = container || document.createElement("div");
        this.controls = controls || document.createElement("div");

        this.fontSize = 24;
        this.laneHeight = 30;
        console.log(`[Danmaku] Set fontSize: ${this.fontSize}, laneHeight: ${this.laneHeight}`);
        this.reportModal = new ReportModal();

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 500;
        tempCanvas.height = 50;
        this.tempCanvasContext = tempCanvas.getContext('2d') || {
            measureText: (text: string) => ({ width: text.length * 12 * this.fontSizeMultiplier })
        } as CanvasRenderingContext2D;
        console.log('[Danmaku] Created temporary canvas for text measurement');

        console.log(videoPlayer);
        console.log(container);
        if (videoPlayer && container) {
            this.lastKnownWidth = container.offsetWidth;
            this.lastKnownHeight = container.offsetHeight;
            console.log(`[Danmaku] Set lastKnownWidth: ${this.lastKnownWidth}, lastKnownHeight: ${this.lastKnownHeight}`);
            this.initializeLanes();
            this.addVideoEventListeners();
            this.setupResizeObserver();
            this.setupWindowResizeListener();
            this.initializePopup();
            console.log('[Danmaku] Initialization complete with videoPlayer and container');
        } else {
            console.log('[Danmaku] Initialization skipped: videoPlayer or container not provided');
        }
        console.debug('[Danmaku] Constructor finished');
    }

    private initializeLanes(): void {
        this.laneCount = this.calculateLaneCount();
        this.slidingLanes = new Array(this.laneCount).fill(-1);
        this.topBottomLanes = new Array(this.laneCount).fill(-1);
        console.log(`[Danmaku] Initialized ${this.laneCount} lanes`);
    }

    public setComments(comments: Comment[]): void {
        console.debug('[Danmaku] setComments called', { comments });
        this.allComments = comments.sort((a, b) => a.time - b.time);
        this.resyncCommentQueue();
        console.debug('[Danmaku] setComments finished', { allComments: this.allComments });
    }

    public getComments(): Comment[] {
        console.debug('[Danmaku] getComments called');
        return this.allComments;
    }

    private calculateLaneCount(): number {
        console.debug('[Danmaku] calculateLaneCount called');
        const screenHeight = this.lastKnownHeight || this.container.offsetHeight || this.videoPlayer.offsetHeight || 720;
        const controlsHeight = this.controls.offsetHeight || 0;
        const laneCount = Math.max(1, Math.floor((screenHeight - controlsHeight) / this.laneHeight));
        console.log(`[Danmaku] Calculated lane count: ${laneCount} (screenHeight: ${screenHeight}, controlsHeight: ${controlsHeight}, laneHeight: ${this.laneHeight})`);
        console.debug('[Danmaku] calculateLaneCount result', { laneCount });
        return laneCount;
    }

    private getDuration(scrollMode: ScrollMode): number {
        console.debug('[Danmaku] getDuration called', { scrollMode });
        if (scrollMode === ScrollMode.SLIDE) {
            return this.DURATION / this.speedMultiplier;
        } else {
            return (this.DURATION / this.speedMultiplier) / 2;
        }
    }

    public play(): void {
        console.debug('[Danmaku] play called', { isRunning: this.isRunning, isVisible: this.isVisible });
        if (this.isRunning || !this.isVisible) return;
        this.isRunning = true;
        this.setAllAnimationsPlayState('running');
    }

    public pause(): void {
        console.debug('[Danmaku] pause called', { isRunning: this.isRunning });
        if (!this.isRunning) return;
        this.isRunning = false;
        this.setAllAnimationsPlayState('paused');
    }

    private setAllAnimationsPlayState(state: 'running' | 'paused'): void {
        console.debug('[Danmaku] setAllAnimationsPlayState called', { state });
        this.container.querySelectorAll('.danmaku-comment').forEach(el => {
            (el as HTMLElement).style.animationPlayState = state;
        });
    }

    public resyncCommentQueue(): void {
        console.debug('[Danmaku] resyncCommentQueue called');
        if (this.getCommentsCount === 0) {
            console.log('[Danmaku] No comments to resync');
            return;
        }

        const currentTime = this.videoPlayer.currentTime * 1000;
        console.log(`[Danmaku] Current time: ${currentTime}ms`);

        // Clear all existing comments
        this.container.querySelectorAll('.danmaku-comment').forEach(el =>
            this.returnElementToPool(el as HTMLElement)
        );

        // Reset lane end times
        this.slidingLanes.fill(-1);
        this.topBottomLanes.fill(-1);

        this.nextEmitIndex = this.findNextCommentIndex(currentTime);
        console.log(`[Danmaku] Next emit index set to: ${this.nextEmitIndex}`);
        let reEmittedCount = 0;

        for (let i = 0; i < this.nextEmitIndex; i++) {
            const comment = this.allComments[i];
            const duration = this.getDuration(comment.scrollMode);
            if (comment.time + duration > currentTime) {
                console.log(`[Danmaku] Re-emitting comment ID ${comment.id} at time ${comment.time}ms`);
                this.emitComment(comment, true);
                reEmittedCount++;
            }
        }
        console.log(`[Danmaku] Resync complete. Re-emitted ${reEmittedCount} comments`);
        console.debug('[Danmaku] resyncCommentQueue finished');
    }

    private findNextCommentIndex(time: number): number {
        console.debug('[Danmaku] findNextCommentIndex called', { time });
        let low = 0;
        let high = this.allComments.length;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (this.allComments[mid].time <= time) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        console.debug('[Danmaku] findNextCommentIndex result', { index: low });
        return low;
    }

    // Modify resize method to properly handle lane management
    public resize(): void {
    console.log('[Danmaku] resize: Detected resize.');
    const newLaneCount = this.calculateLaneCount();

    // Update lane tracking arrays to the new size without losing data
    if (newLaneCount > this.laneCount) {
        // Add new available lanes (initialized to -1, meaning free)
        this.slidingLanes.push(...new Array(newLaneCount - this.laneCount).fill(-1));
        this.topBottomLanes.push(...new Array(newLaneCount - this.laneCount).fill(-1));
    } else if (newLaneCount < this.laneCount) {
        // Trim excess lanes
        this.slidingLanes.length = newLaneCount;
        this.topBottomLanes.length = newLaneCount;
    }

    this.laneCount = newLaneCount;
    // Reposition existing comments instead of a full, costly resync
    this.updateVisibleDanmakuPositions();
}


    /**
         * Iterates over visible comments, repositions them based on the new lane height,
         * and hides any that are now in out-of-bounds lanes.
         */
    private updateVisibleDanmakuPositions(): void {
    this.container.querySelectorAll('.danmaku-comment').forEach(el => {
        const element = el as HTMLElement;
        const lane = parseInt(element.dataset.lane || '-1', 10);

        if (lane === -1) return;

        if (lane >= this.laneCount) {
            // This lane no longer exists, hide the comment.
            // It will be removed from the DOM on animationend.
            element.style.display = 'none';
        } else {
            // Reposition the comment based on the potentially new laneHeight.
            element.style.top = `${lane * this.laneHeight}px`;
        }
    });
}

    private findAvailableSlidingLane(time: number): number {
        console.debug('[Danmaku] findAvailableSlidingLane called', { time });
        const duration = this.getDuration(ScrollMode.SLIDE);
        const delay = DensityConfig[this.densityMode].delay;

        // Ensure lane arrays match current laneCount
        while (this.slidingLanes.length < this.laneCount) {
            this.slidingLanes.push(-1);
        }

        for (let i = 0; i < this.laneCount; i++) {
            if (time === -1 || time >= this.slidingLanes[i] + delay) {
                this.slidingLanes[i] = time + duration;
                console.debug('[Danmaku] findAvailableSlidingLane result', { lane: i });
                return i;
            }
        }
        return -1;
    }

    private findAvailableTopLane(time: number): number {
        console.debug('[Danmaku] findAvailableTopLane called', { time });
        const duration = this.getDuration(ScrollMode.TOP);
        const delay = DensityConfig[this.densityMode].delay;

        // Ensure lane arrays match current laneCount
        while (this.topBottomLanes.length < this.laneCount) {
            this.topBottomLanes.push(-1);
        }

        for (let i = 0; i < this.laneCount; i++) {
            if (time === -1 || time >= this.topBottomLanes[i] + delay) {
                this.topBottomLanes[i] = time + duration;
                console.debug('[Danmaku] findAvailableTopLane result', { lane: i });
                return i;
            }
        }
        return -1;
    }

    private findAvailableBottomLane(time: number): number {
        console.debug('[Danmaku] findAvailableBottomLane called', { time });
        const duration = this.getDuration(ScrollMode.BOTTOM);
        const delay = DensityConfig[this.densityMode].delay;

        // Ensure lane arrays match current laneCount
        while (this.topBottomLanes.length < this.laneCount) {
            this.topBottomLanes.push(-1);
        }

        for (let i = this.laneCount - 1; i >= 0; i--) {
            if (time === -1 || time >= this.topBottomLanes[i] + delay) {
                this.topBottomLanes[i] = time + duration;
                console.debug('[Danmaku] findAvailableBottomLane result', { lane: i });
                return i;
            }
        }
        return -1;
    }

    public show(): void {
        console.debug('[Danmaku] show called');
        this.container.style.display = "";
        this.isVisible = true;
        if (!this.videoPlayer.paused) {
            this.play();
        }
    }

    public hide(): void {
        console.debug('[Danmaku] hide called');
        this.container.style.display = "none";
        this.isVisible = false;
        this.pause();
    }

    public toggleVisibility(force?: boolean): boolean {
        console.debug('[Danmaku] toggleVisibility called', { force });
        this.isVisible = force ?? !this.isVisible;
        if (this.isVisible) {
            this.show();
            this.resyncCommentQueue();
        } else {
            this.hide();
        }
        console.debug('[Danmaku] toggleVisibility finished', { isVisible: this.isVisible });
        return this.isVisible;
    }

    public addComment(comment: Comment): void {
        console.debug('[Danmaku] addComment called', { comment });
        const insertIndex = this.allComments.findIndex(c => c.time > comment.time);
        if (insertIndex === -1) {
            this.allComments.push(comment);
        } else {
            this.allComments.splice(insertIndex, 0, comment);
        }
        this.resyncCommentQueue();
        console.debug('[Danmaku] addComment finished', { allComments: this.allComments });
    }

    public removeEventListeners(): void {
        console.debug('[Danmaku] removeEventListeners called');
        this.videoPlayer.removeEventListener('timeupdate', this.emitNewComments.bind(this));
        this.videoPlayer.removeEventListener('play', this.play.bind(this));
        this.videoPlayer.removeEventListener('playing', this.play.bind(this));
        this.videoPlayer.removeEventListener('pause', this.pause.bind(this));
        this.videoPlayer.removeEventListener('waiting', this.pause.bind(this));
        this.videoPlayer.removeEventListener('stalled', this.pause.bind(this));
        this.videoPlayer.removeEventListener('seeking', this.pause.bind(this));
        this.videoPlayer.removeEventListener('seeked', this.resyncCommentQueue.bind(this));

    }

    public reinitialize(videoPlayer: HTMLVideoElement): void {
        console.debug('[Danmaku] reinitialize called', { videoPlayer });
        this.pause();
        this.clear();
        this.removeEventListeners();
        this.videoPlayer = videoPlayer;
        this.resize();
        this.addVideoEventListeners();
        this.cleanupResizeObserver();
        this.setupResizeObserver();
        console.debug('[Danmaku] reinitialize finished');
    }

    public destroy(): void {
        console.debug('[Danmaku] destroy called');
        this.pause();
        this.clear();
        this.removeEventListeners();
        this.container.removeEventListener('mouseover', this.handleContainerMouseOver);
        this.container.removeEventListener('mouseout', this.handleContainerMouseOut);
        this.popupElement?.remove();
        if (this.showPopupTimeout) clearTimeout(this.showPopupTimeout);
        this.cleanupResizeObserver();
        this.cleanupWindowResizeListener();
        this.commentPool = [];
        console.debug('[Danmaku] destroy finished');
    }

    public clear(): void {
        console.debug('[Danmaku] clear called');
        this.allComments = [];
        this.nextEmitIndex = 0;
        this.container.innerHTML = '';
        this.initializeLanes();
        console.debug('[Danmaku] clear finished');
    }

    private emitNewComments(): void {
        console.debug('[Danmaku] emitNewComments called', { currentTime: this.videoPlayer.currentTime });
        if (!this.videoPlayer || !this.isRunning) return;
        console.log('[Danmaku] Emitting new comments');
        const currentTime = this.videoPlayer.currentTime * 1000;

        let emittedCount = 0;
        while (this.nextEmitIndex < this.allComments.length &&
            this.allComments[this.nextEmitIndex].time <= currentTime) {
            const comment = this.allComments[this.nextEmitIndex];
            if (this.emitComment(comment)) {
                emittedCount++;
                this.nextEmitIndex++;
            } else {
                console.log(`[Danmaku] Failed to emit comment ID ${comment.id} at time ${comment.time}ms`);
                break;
            }
        }
        if (emittedCount > 0) {
            console.log(`[Danmaku] Emitted ${emittedCount} new comments at time ${currentTime}ms`);
        }
        console.debug('[Danmaku] emitNewComments finished');
    }

    private emitComment(comment: Comment, isResync: boolean = false): boolean {
        let lane: number = -1;
        const currentTime = this.videoPlayer.currentTime * 1000;

        if (comment.scrollMode === ScrollMode.SLIDE) {
            lane = this.findAvailableSlidingLane(comment.time);
        } else if (comment.scrollMode === ScrollMode.TOP) {
            lane = this.findAvailableTopLane(comment.time);
        } else if (comment.scrollMode === ScrollMode.BOTTOM) {
            lane = this.findAvailableBottomLane(comment.time);
        }

        if (lane === -1) return false;

        try {
            const danmakuElement = this.getElementFromPool(comment);
            danmakuElement.dataset.lane = lane.toString(); // Store the lane on the element
            const duration = this.getDuration(comment.scrollMode);
            const timeSinceStart = isResync ? currentTime - comment.time : 0;

            this.setInitialPosition(danmakuElement, timeSinceStart, duration, lane, comment.scrollMode, isResync);
            danmakuElement.classList.add(`danmaku-animation-${comment.scrollMode}`);
            danmakuElement.style.animationPlayState = this.isRunning ? 'running' : 'paused';

            danmakuElement.addEventListener('animationend', () => {
                this.returnElementToPool(danmakuElement);
            }, { once: true });

            return true;
        } catch (error) {
            console.error(`Failed to emit comment ${comment.id}:`, error);
            return false;
        }
    }

    private getElementFromPool(comment: Comment): HTMLElement {
        console.debug('[Danmaku] getElementFromPool called', { comment });
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
        console.debug('[Danmaku] getElementFromPool returning element', { element: danmakuElement });
        return danmakuElement;
    }

    private setInitialPosition(
        element: HTMLElement,
        timeSinceStart: number,
        duration: number,
        lane: number,
        scrollMode: ScrollMode,
        isResync: boolean = false
    ): void {
        console.debug('[Danmaku] setInitialPosition called', { element, timeSinceStart, duration, lane, scrollMode, isResync });
        element.style.setProperty('--danmaku-duration', `${duration / 1000}s`);

        if (isResync && scrollMode === ScrollMode.SLIDE && timeSinceStart > 0) {
            const progress = timeSinceStart / this.getDuration(scrollMode);
            const textWidth = this.tempCanvasContext.measureText(element.textContent || '').width;
            const totalDistance = this.lastKnownWidth + textWidth;
            const currentPos = totalDistance * (1 - progress) - textWidth;
            element.style.left = `${currentPos}px`;
            element.style.position = 'absolute';
            element.classList.remove(`danmaku-animation-${scrollMode}`);
        }

        // Ensure lane position is within bounds
        const clampedLane = Math.min(lane, this.laneCount - 1);
        element.style.top = `${clampedLane * this.laneHeight}px`;
        console.debug('[Danmaku] setInitialPosition finished');
    }

    private returnElementToPool(element: HTMLElement): void {
        console.debug('[Danmaku] returnElementToPool called', { element });
        element.remove();
        if (this.commentPool.length < this.maxPoolSize) {
            element.removeAttribute('style');
            element.className = 'danmaku-comment';
            this.commentPool.push(element);
        }
        console.debug('[Danmaku] returnElementToPool finished', { poolSize: this.commentPool.length });
    }

    // --- Popup Interaction Logic ---
    private initializePopup(): void {
        console.debug('[Danmaku] initializePopup called');
        this.popupElement = document.createElement("div");
        this.popupElement.className = "danmaku-comment-popup";

        const copyButton = document.createElement("button");
        copyButton.className = "danmaku-popup-button copy-btn";
        copyButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
            </svg>`;

        const reportButton = document.createElement("button");
        reportButton.className = "danmaku-popup-button report-btn";
        reportButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" x2="12" y1="8" y2="12"/>
                <line x1="12" x2="12.01" y1="16" y2="16"/>
            </svg>`;

        this.popupElement.appendChild(copyButton);
        this.popupElement.appendChild(reportButton);
        this.container.appendChild(this.popupElement);

        this.container.addEventListener('mouseover', this.handleContainerMouseOver);
        this.container.addEventListener('mouseout', this.handleContainerMouseOut);
        window.addEventListener('mousemove', this.handleMouseMove);
        console.debug('[Danmaku] initializePopup finished');
    }

    private handleContainerMouseOver = (event: MouseEvent): void => {
        console.debug('[Danmaku] handleContainerMouseOver called', { event });
        const target = event.target as HTMLElement;
        if (target.classList.contains('danmaku-comment')) {
            const commentId = parseInt(target.dataset.commentId || '', 10);
            if (!isNaN(commentId)) {
                const commentData = this.allComments.find(c => c.id === commentId);
                if (commentData) {
                    if (this.showPopupTimeout) clearTimeout(this.showPopupTimeout);
                    this.showPopupTimeout = window.setTimeout(() => {
                        this.showPopup(target, commentData);
                    }, 300);
                }
            }
        }
    };

    private handleContainerMouseOut = (event: MouseEvent): void => {
        console.debug('[Danmaku] handleContainerMouseOut called', { event });
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
        // Only log if popup is visible
        if (this.popupElement && this.popupElement.style.display !== 'none') {
            console.debug('[Danmaku] handleMouseMove called', { event });
        }
        if (this.popupElement && this.popupElement.style.display !== 'none') {
            const popupRect = this.popupElement.getBoundingClientRect();
            const containerRect = this.container.getBoundingClientRect();

            let top = event.clientY - containerRect.top + 10;
            let left = event.clientX - containerRect.left + 10;

            if (top + popupRect.height > containerRect.height) {
                top = event.clientY - containerRect.top - popupRect.height - 10;
            }

            if (left + popupRect.width > containerRect.width) {
                left = containerRect.width - popupRect.width - 10;
            }

            this.popupElement.style.top = `${Math.max(0, top)}px`;
            this.popupElement.style.left = `${Math.max(0, left)}px`;
        }
    };

    private showPopup(element: HTMLElement, commentData: Comment): void {
        console.debug('[Danmaku] showPopup called', { element, commentData });
        if (!commentData || !this.popupElement) return;

        this.hoveredComment = { element, commentId: commentData.id };
        element.style.animationPlayState = 'paused';

        const copyBtn = this.popupElement.querySelector('.copy-btn') as HTMLElement;
        const reportBtn = this.popupElement.querySelector('.report-btn') as HTMLElement;

        copyBtn.onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(element.textContent || '').catch(err => {
                console.warn('Copy failed:', err);
            });
        };

        reportBtn.onclick = (e) => {
            e.stopPropagation();
            this.reportModal.show(commentData);
        };

        const rect = element.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();

        this.popupElement.style.top = `${rect.bottom - containerRect.top + 5}px`;
        this.popupElement.style.left = `${rect.left - containerRect.left}px`;
        this.popupElement.style.display = 'flex';
        console.debug('[Danmaku] showPopup finished');
    }

    private hidePopup(): void {
        console.debug('[Danmaku] hidePopup called');
        if (this.hoveredComment) {
            // Restore animation state based on video state
            this.hoveredComment.element.style.animationPlayState =
                this.isRunning && !this.videoPlayer.paused ? 'running' : 'paused';
            this.hoveredComment = null;
        }
        if (this.popupElement) {
            this.popupElement.style.display = 'none';
        }
        console.debug('[Danmaku] hidePopup finished');
    }

    // --- Event Listeners and Observers Setup ---
    private addVideoEventListeners(): void {
        console.debug('[Danmaku] addVideoEventListeners called');
        this.videoPlayer.addEventListener('timeupdate', this.emitNewComments.bind(this));
        this.videoPlayer.addEventListener('play', this.play.bind(this));
        this.videoPlayer.addEventListener('playing', this.play.bind(this));
        this.videoPlayer.addEventListener('pause', this.pause.bind(this));
        this.videoPlayer.addEventListener('waiting', this.pause.bind(this));
        this.videoPlayer.addEventListener('stalled', this.pause.bind(this));
        this.videoPlayer.addEventListener('seeking', this.pause.bind(this));
        this.videoPlayer.addEventListener('seeked', this.resyncCommentQueue.bind(this));
        console.debug('[Danmaku] addVideoEventListeners finished');
    }

    private setupResizeObserver(): void {
        console.debug('[Danmaku] setupResizeObserver called');
        this.resizeObserver = new ResizeObserver((entries) => {
            if (entries && entries.length > 0) {
                const { width, height } = entries[0].contentRect;
                if (width !== this.lastKnownWidth || height !== this.lastKnownHeight) {
                    this.lastKnownWidth = width;
                    this.lastKnownHeight = height;
                    this.resize();
                }
            }
        });
        this.resizeObserver.observe(this.container);
        console.debug('[Danmaku] setupResizeObserver finished');
    }

    private cleanupResizeObserver(): void {
        console.debug('[Danmaku] cleanupResizeObserver called');
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        console.debug('[Danmaku] cleanupResizeObserver finished');
    }

    private setupWindowResizeListener(): void {
        console.debug('[Danmaku] setupWindowResizeListener called');
        window.addEventListener('resize', this.handleWindowResize);
        console.debug('[Danmaku] setupWindowResizeListener finished');
    }

    private cleanupWindowResizeListener(): void {
        console.debug('[Danmaku] cleanupWindowResizeListener called');
        window.removeEventListener('resize', this.handleWindowResize);
        console.debug('[Danmaku] cleanupWindowResizeListener finished');
    }

    private handleWindowResize = (): void => {
        console.debug('[Danmaku] handleWindowResize called');
        if (this.resizeTimeoutId) {
            clearTimeout(this.resizeTimeoutId);
        }
        this.resizeTimeoutId = window.setTimeout(() => this.resize(), 200);
        console.debug('[Danmaku] handleWindowResize finished');
    };

    // --- Settings Methods ---
    public setSpeed(percent: number): void {
        console.debug('[Danmaku] setSpeed called', { percent });
        this.speedMultiplier = Math.max(0.1, percent / 100);
        this.resyncCommentQueue();
        console.debug('[Danmaku] setSpeed finished', { speedMultiplier: this.speedMultiplier });
    }

    public setDensity(density: DensityMode): void {
        console.debug('[Danmaku] setDensity called', { density });
        this.densityMode = density;
        this.resyncCommentQueue();
        console.debug('[Danmaku] setDensity finished', { densityMode: this.densityMode });
    }

    public setOpacity(percent: number): void {
        console.debug('[Danmaku] setOpacity called', { percent });
        this.opacityLevel = percent / 100;
        this.container.style.opacity = this.opacityLevel.toString();
        console.debug('[Danmaku] setOpacity finished', { opacityLevel: this.opacityLevel });
    }

    public setFontSize(percent: number): void {
    this.fontSizeMultiplier = Math.max(0.1, percent / 100);
    this.laneHeight = Math.max(20, Math.floor(this.fontSize * this.fontSizeMultiplier * 1.25));
    console.log(`[Danmaku] setFontSize: Font size multiplier set to ${this.fontSizeMultiplier}, new lane height is ${this.laneHeight}px.`);
    
    // Call the efficient resize method instead of a full resync
    this.resize();
}
}