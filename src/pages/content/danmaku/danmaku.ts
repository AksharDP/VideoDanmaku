import { Comment } from "../api";
import { PlannedComment } from "../interfaces/danmaku";
import { ReportModal } from "../modal-report/modal-report";
import { DensityConfig, DensityMode, ScrollMode } from "../interfaces/enum";

export class Danmaku {
    public videoPlayer: HTMLVideoElement;
    private container: HTMLElement;
    private controls: HTMLElement;
    private reportModal: ReportModal;

    private allComments: PlannedComment[] = [];
    public get getCommentsCount(): number { return this.allComments.length; }

    private nextEmitIndex: number = 0;
    private isRunning = false;
    private isVisible: boolean = true;

    // --- For local, real-time comment placement ---
    private localLaneCount: number = 10;
    private localSlidingLanes: number[] = [];
    private localTopBottomLanes: number[] = [];
    private tempCanvasContext: CanvasRenderingContext2D;

    // --- Settings ---
    private speedMultiplier: number = 1;
    private opacityLevel: number = 1;
    private fontSizeMultiplier: number = 1;
    private laneHeight: number;

    // --- Performance ---
    private commentPool: HTMLElement[] = [];
    private readonly maxPoolSize: number = 150;

    constructor(videoPlayer: HTMLVideoElement, container: HTMLElement, controls: HTMLElement) {
        this.videoPlayer = videoPlayer;
        this.container = container;
        this.controls = controls;

        this.laneHeight = 30; // Base lane height
        this.reportModal = new ReportModal();
        
        const tempCanvas = document.createElement('canvas');
        this.tempCanvasContext = tempCanvas.getContext('2d')!;

        this.addVideoEventListeners();
        this.recalculateLocalLanes();
    }

    /**
     * Loads the pre-calculated comments from a DisplayPlan.
     */
    public setComments(comments: PlannedComment[]): void {
        this.allComments = comments; // Already sorted by time from the backend
        this.resyncCommentQueue();
    }

    public play(): void {
        if (this.isRunning || !this.isVisible) return;
        this.isRunning = true;
        this.setAllAnimationsPlayState('running');
    }

    public pause(): void {
        if (!this.isRunning) return;
        this.isRunning = false;
        this.setAllAnimationsPlayState('paused');
    }
    
    public toggleVisibility(force?: boolean): boolean {
        this.isVisible = force ?? !this.isVisible;
        this.container.style.display = this.isVisible ? "" : "none";
        if(this.isVisible) {
            this.play();
            this.resyncCommentQueue();
        } else {
            this.pause();
        }
        return this.isVisible;
    }

    /**
     * Syncs the danmaku display to the current video time.
     */
    public resyncCommentQueue(): void {
        if (this.getCommentsCount === 0 || !this.isVisible) return;

        const currentTime = this.videoPlayer.currentTime * 1000;
        this.clearCurrentComments();
        this.recalculateLocalLanes();

        this.nextEmitIndex = this.allComments.findIndex(c => c.time > currentTime);
        if (this.nextEmitIndex === -1) this.nextEmitIndex = this.allComments.length;

        for (let i = 0; i < this.nextEmitIndex; i++) {
            const comment = this.allComments[i];
            const effectiveDuration = comment.duration / this.speedMultiplier;
            const timeSinceEmission = currentTime - comment.time;

            if (timeSinceEmission < effectiveDuration) {
                this.emitComment(comment, true);
            }
        }
    }
    
    /**
     * Adds a newly submitted user comment. This comment is not part of the
     * pre-processed plan and is placed in real-time.
     */
    public addLocalComment(comment: Comment): void {
        const currentTime = this.videoPlayer.currentTime * 1000;
        const textWidth = this.getTextWidth(comment.content, `${24 * this.fontSizeMultiplier}px Roboto`);
        const duration = comment.scrollMode === ScrollMode.SLIDE ? 7000 : 3500;

        let lane = -1;
        if(comment.scrollMode === ScrollMode.SLIDE) {
            lane = this.findAvailableLocalLane(this.localSlidingLanes, currentTime, duration, textWidth);
        } else {
            lane = this.findAvailableLocalLane(this.localTopBottomLanes, currentTime, duration, 0);
        }
        
        if (lane === -1) {
            // All lanes are busy, drop the comment for now.
            // A more advanced implementation could queue it.
            console.warn("No available lane for local comment.");
            return;
        }

        const plannedComment: PlannedComment = {
            ...comment,
            lane,
            duration,
            width: textWidth,
        };
        
        // Insert into allComments array at the correct sorted position
        const insertIndex = this.allComments.findIndex(c => c.time > plannedComment.time);
        if (insertIndex === -1) {
            this.allComments.push(plannedComment);
        } else {
            this.allComments.splice(insertIndex, 0, plannedComment);
        }

        // If the comment should be visible now, emit it.
        if (plannedComment.time <= currentTime) {
            this.emitComment(plannedComment, false);
        }
    }

    /**
     * The main loop, called on videoPlayer's 'timeupdate' event.
     */
    private emitNewComments(): void {
        if (!this.isRunning || !this.isVisible) return;

        const currentTime = this.videoPlayer.currentTime * 1000;

        while (this.nextEmitIndex < this.allComments.length && this.allComments[this.nextEmitIndex].time <= currentTime) {
            const commentToEmit = this.allComments[this.nextEmitIndex];
            this.emitComment(commentToEmit, false);
            this.nextEmitIndex++;
        }
    }

    private emitComment(comment: PlannedComment, isResync: boolean): void {
        const danmakuElement = this.getElementFromPool(comment);
        const effectiveDuration = comment.duration / this.speedMultiplier;

        danmakuElement.style.top = `${comment.lane * this.laneHeight}px`;
        danmakuElement.style.setProperty('--danmaku-duration', `${effectiveDuration / 1000}s`);

        if (isResync) {
            const timeSinceEmission = (this.videoPlayer.currentTime * 1000) - comment.time;
            const progress = timeSinceEmission / effectiveDuration;
            danmakuElement.style.animationDelay = `-${progress * effectiveDuration / 1000}s`;
        } else {
            danmakuElement.style.animationDelay = '0s';
        }

        danmakuElement.classList.add(`danmaku-animation-${comment.scrollMode}`);
        danmakuElement.style.animationPlayState = this.isRunning ? 'running' : 'paused';

        danmakuElement.addEventListener('animationend', () => {
            this.returnElementToPool(danmakuElement);
        }, { once: true });
    }

    private getElementFromPool(comment: PlannedComment): HTMLElement {
        let el: HTMLElement;
        if (this.commentPool.length > 0) {
            el = this.commentPool.pop()!;
            el.removeAttribute('style');
            el.className = 'danmaku-comment';
        } else {
            el = document.createElement("div");
            el.className = "danmaku-comment";
        }

        el.textContent = comment.content;
        el.style.color = comment.color;
        el.style.fontSize = `${24 * this.fontSizeMultiplier}px`;
        el.style.opacity = this.opacityLevel.toString();
        el.dataset.commentId = comment.id.toString();

        this.container.appendChild(el);
        return el;
    }

    private returnElementToPool(element: HTMLElement): void {
        element.remove();
        if (this.commentPool.length < this.maxPoolSize) {
            this.commentPool.push(element);
        }
    }
    
    public destroy(): void {
        this.pause();
        this.clearCurrentComments();
        this.allComments = [];
        this.commentPool = [];
    }
    
    private clearCurrentComments(): void {
        while (this.container.firstChild) {
            this.returnElementToPool(this.container.firstChild as HTMLElement);
        }
    }

    // --- Settings Methods ---
    public setSpeed(percent: number): void {
        this.speedMultiplier = Math.max(0.1, percent / 100);
        this.resyncCommentQueue();
    }

    public setOpacity(percent: number): void {
        this.opacityLevel = percent / 100;
        this.container.style.opacity = this.opacityLevel.toString();
    }

    public setFontSize(percent: number): void {
        this.fontSizeMultiplier = Math.max(0.5, percent / 100);
        this.laneHeight = Math.floor(30 * this.fontSizeMultiplier);
        this.recalculateLocalLanes();
        this.resyncCommentQueue();
    }

    // --- Helpers and Event Listeners ---
    
    private getTextWidth(text: string, font: string): number {
        this.tempCanvasContext.font = font;
        return this.tempCanvasContext.measureText(text).width;
    }
    
    private recalculateLocalLanes(): void {
        console.debug("Recalculating local lanes...");
        const screenHeight = this.videoPlayer.offsetHeight;
        console.debug(`Video player height: ${screenHeight}, lane height: ${this.laneHeight}`);
        this.localLaneCount = Math.max(1, Math.floor(screenHeight / this.laneHeight)) - 1;
        this.localSlidingLanes = new Array(this.localLaneCount).fill(0);
        this.localTopBottomLanes = new Array(this.localLaneCount).fill(0);
        console.debug(`Local lane count: ${this.localLaneCount}`);
    }
    
    private findAvailableLocalLane(lanes: number[], currentTime: number, duration: number, textWidth: number): number {
        for (let i = 0; i < lanes.length; i++) {
            if (lanes[i] < currentTime) {
                const containerWidth = this.container.offsetWidth;
                // For sliding comments, reserve the lane until the tail clears the edge
                const reservationTime = textWidth > 0 
                    ? (textWidth / (containerWidth + textWidth)) * duration 
                    : duration;
                lanes[i] = currentTime + reservationTime;
                return i;
            }
        }
        return -1; // No lane found
    }

    private setAllAnimationsPlayState(state: 'running' | 'paused'): void {
        this.container.querySelectorAll('.danmaku-comment').forEach(el => {
            (el as HTMLElement).style.animationPlayState = state;
        });
    }

    private addVideoEventListeners(): void {
        this.videoPlayer.addEventListener('timeupdate', this.emitNewComments.bind(this));
        this.videoPlayer.addEventListener('play', this.play.bind(this));
        this.videoPlayer.addEventListener('pause', this.pause.bind(this));
        this.videoPlayer.addEventListener('seeked', this.resyncCommentQueue.bind(this));
        // this.videoPlayer.addEventListener('resize', this.recalculateLocalLanes.bind(this));
        const resizeObserver = new ResizeObserver(() => {
            this.recalculateLocalLanes();
        });
        resizeObserver.observe(this.videoPlayer);
        console.debug("Added video event listeners.");
    }
}