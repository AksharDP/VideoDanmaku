import { Comment } from "../api";
import { RawComment, PlannedComment } from "../interfaces/danmaku";
import { ReportModal } from "../modal-report/modal-report";
import { DensityMode, ScrollMode, FontSize } from "../interfaces/enum";

export class Danmaku {

    public videoPlayer: HTMLVideoElement;
    private container: HTMLElement;
    private controls: HTMLElement;
    private reportModal: ReportModal = new ReportModal();
    private comments: RawComment[] = [];
    // private allComments: PlannedComment[] = [];

    public get getCommentsCount(): number { return this.comments.length; }

    private nextEmitIndex: number = 0;
    private isRunning = false;
    private isVisible: boolean = true;

    // --- For local, real-time comment placement ---
    private oldVideoPlayerHeight: number = 0;
    private oldVideoPlayerWidth: number = 0;
    private localLaneCount: number = 10;
    private localSlidingLanes: (HTMLElement | null)[] = [];
    private localTopBottomLanes: (HTMLElement | null)[] = [];
    private tempCanvasContext: CanvasRenderingContext2D = document.createElement('canvas').getContext('2d')!;

    // --- Settings ---
    private density: DensityMode = DensityMode.NORMAL;
    private baseDuration = 7000;
    private speedMultiplier: number = 1;
    private opacityLevel: number = 1;
    private fontSizeMultiplier: number = 1;
    private laneHeight: number = 30;

    // --- Performance ---
    private commentPool: HTMLElement[] = [];
    private readonly maxPoolSize: number = 150;

    // --- Animation tracking ---
    private activeAnimations: Map<HTMLElement, Animation> = new Map();

    constructor(videoPlayer: HTMLVideoElement, container: HTMLElement, controls: HTMLElement) {
        this.videoPlayer = videoPlayer;
        this.container = container;
        this.controls = controls;
        this.oldVideoPlayerHeight = this.videoPlayer.clientHeight;
        this.oldVideoPlayerWidth = this.videoPlayer.clientWidth;
        this.addVideoEventListeners();
        this.calculateLanes();
        this.localSlidingLanes = new Array(this.localLaneCount).fill(null);
        this.localTopBottomLanes = new Array(this.localLaneCount).fill(null);
    }


    /**
    * Loads the pre-calculated comments from a DisplayPlan.
    */
    public setComments(comments: RawComment[]): void {
        // this.allComments = this.planRawComments(comments);
        this.comments = comments;
        this.syncCommentQueue();
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

        if (this.isVisible) {
            this.play();
            this.syncCommentQueue();
        } else {
            this.pause();
        }
        return this.isVisible;
    }


    /**
    * Syncs the danmaku display to the current video time.
    */
    public syncCommentQueue(): void {
        if (this.getCommentsCount === 0 || !this.isVisible) return;

        const currentTime = this.videoPlayer.currentTime * 1000;
        this.clearCurrentComments();
        this.calculateLanes();
        this.nextEmitIndex = this.comments.findIndex(c => c.time > currentTime);
        if (this.nextEmitIndex === -1) this.nextEmitIndex = this.comments.length;

        for (let i = 0; i < this.nextEmitIndex; i++) {
            const comment = this.comments[i];
            // ! Maybe create a map for durations based on scroll mode to avoid this check every time
            let duration = this.baseDuration;
            if (comment.scrollMode !== ScrollMode.SLIDE) duration = this.baseDuration / 2;
            const effectiveDuration = duration / this.speedMultiplier;
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
    public addComment(comment: Comment): void {
        // binary search insertion into comments array
        let left = 0;
        let right = this.comments.length;
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (this.comments[mid].time < comment.time) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }
        this.comments.splice(left, 0, comment);
        if (left <= this.nextEmitIndex) {
            this.nextEmitIndex++;
        }
    }

    private getAvailableSlidingLane(): number {
        for (let i = 0; i < this.localLaneCount; i++) {
            const laneElement = this.localSlidingLanes[i];
            if (!laneElement) {
                return i;
            }

            if (!this.container.contains(laneElement)) {
                this.localSlidingLanes[i] = null;
                return i;
            }
        }
        return -1;
    }


    private getAvailableTopLane(): number {
        for (let i = 0; i < this.localLaneCount; i++) {
            if (!this.localTopBottomLanes[i] ||
                !this.container.contains(this.localTopBottomLanes[i])) {
                return i;
            }
        }
        return -1;
    }


    private getAvailableBottomLane(): number {
        for (let i = this.localLaneCount - 1; i >= 0; i--) {
            if (!this.localTopBottomLanes[i] ||
                !this.container.contains(this.localTopBottomLanes[i])) {
                return i;
            }
        }
        return -1;
    }


    /**
    * The main loop, called on videoPlayer's 'timeupdate' event.
    */
    private emitNewComments(): void {
        if (!this.isRunning || !this.isVisible) return;

        const currentTime = this.videoPlayer.currentTime * 1000;
        while (this.nextEmitIndex < this.getCommentsCount && this.comments[this.nextEmitIndex].time <= currentTime) {
            const commentToEmit = this.comments[this.nextEmitIndex];
            this.emitComment(commentToEmit, false);
            this.nextEmitIndex++;
        }
    }

    private emitComment(comment: RawComment, isResync: boolean): void {
        console.debug(`Emitting comment: ${comment.content}, mode: ${comment.scrollMode}, isResync: ${isResync}`);

        let lane = -1;

        // Check lane availability FIRST before getting element from pool
        switch (comment.scrollMode) {
            case ScrollMode.SLIDE:
                lane = this.getAvailableSlidingLane();
                console.debug(`Sliding lane assigned: ${lane}`);
                break;
            case ScrollMode.TOP:
                lane = this.getAvailableTopLane();
                console.debug(`Top lane assigned: ${lane}`);
                break;
            case ScrollMode.BOTTOM:
                lane = this.getAvailableBottomLane();
                console.debug(`Bottom lane assigned: ${lane}`);
                break;
        }

        // Early return if no lane is available - more efficient!
        if (lane === -1) {
            console.debug("No available lane found, returning early without creating element.");
            return;
        }

        // Only get element from pool if we have an available lane
        const danmakuElement = this.getElementFromPool(comment);

        // Apply scroll mode specific classes
        if (comment.scrollMode === ScrollMode.TOP || comment.scrollMode === ScrollMode.BOTTOM) {
            danmakuElement.classList.add('danmaku-animation-center');
        }

        // const effectiveDuration = duration / this.speedMultiplier;
        // console.debug(`Effective duration: ${effectiveDuration}, lane: ${lane}`);
        danmakuElement.style.top = `${lane * this.laneHeight}px`;
        console.debug(`Element top position set to: ${danmakuElement.style.top}`);


        // Assign element to appropriate lane tracking
        if (comment.scrollMode === ScrollMode.SLIDE) {
            console.debug(this.localSlidingLanes);
            this.localSlidingLanes[lane] = danmakuElement;
            console.debug(this.localSlidingLanes);
        } else {
            console.debug(this.localTopBottomLanes);
            this.localTopBottomLanes[lane] = danmakuElement;
            console.debug(this.localTopBottomLanes);
        }

        // Use Web Animations API instead of CSS animations
        if (isResync) {
            this.startAnimation(danmakuElement, comment.scrollMode, isResync, comment.time);
        } else {
            this.startAnimation(danmakuElement, comment.scrollMode, isResync);
        }
    }


    private startAnimation(element: HTMLElement, scrollMode: ScrollMode, isResync: boolean, startTime?: number): void {
        let keyframes: Keyframe[] = [];

        const baseDuration = scrollMode === ScrollMode.SLIDE ? this.baseDuration : this.baseDuration / 2;
        const effectiveDuration = baseDuration / this.speedMultiplier;

        const options: KeyframeAnimationOptions = {
            duration: effectiveDuration,
            easing: 'linear',
            fill: 'forwards'
        };

        if (scrollMode === ScrollMode.SLIDE) {
            keyframes = [
                { transform: `translateX(${this.container.clientWidth}px)` },
                { transform: `translateX(-${element.offsetWidth}px)` }
            ];
        }

        const animation = element.animate(keyframes, options);
        this.activeAnimations.set(element, animation);

        const handleFinish = () => {
            this.returnElementToPool(element);
        };

        animation.addEventListener('finish', handleFinish, { once: true });

        if (isResync && startTime !== undefined) {
            const videoTimeMs = this.videoPlayer.currentTime * 1000;
            const elapsedTime = videoTimeMs - startTime;

            if (elapsedTime >= effectiveDuration) {
                animation.cancel();
                this.activeAnimations.delete(element);
                handleFinish();
                console.debug(`Resync skipped animation: startTime = ${startTime}, elapsed >= duration (${elapsedTime} >= ${effectiveDuration})`);
                return;
            }

            if (elapsedTime > 0) {
                animation.currentTime = elapsedTime;
            }

            console.debug(`Resyncing animation: startTime = ${startTime}, effectiveDuration = ${effectiveDuration}, elapsedTime = ${elapsedTime}, new currentTime = ${animation.currentTime}`);
        }

        if (!this.isRunning) {
            animation.pause();
        }
}


    private getElementFromPool(comment: RawComment): HTMLElement {
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
        // ! Change so color is a number and would need to be converted to hex string
        el.style.color = comment.color;
        // el.style.color = `#${comment.color.toString(16).padStart(6, '0')}`;
        el.style.fontSize = `${24 * this.fontSizeMultiplier}px`;
        el.style.opacity = this.opacityLevel.toString();
        el.dataset.commentId = comment.id.toString();
        el.dataset.emissionTime = comment.time.toString();

        this.container.appendChild(el);
        return el;
    }


    private returnElementToPool(element: HTMLElement): void {
        // Cancel any active animation
        const animation = this.activeAnimations.get(element);
        if (animation) {
            animation.cancel();
            this.activeAnimations.delete(element);
        }

        const top = parseInt(element.style.top, 10);
        if (!isNaN(top)) {
            const lane = Math.round(top / this.laneHeight);
            if (lane >= 0) {
                if (this.localSlidingLanes[lane] === element) {
                    this.localSlidingLanes[lane] = null;
                }
                if (this.localTopBottomLanes[lane] === element) {
                    this.localTopBottomLanes[lane] = null;
                }
            }
        }

        element.remove();

        if (this.commentPool.length < this.maxPoolSize) {
            this.commentPool.push(element);
        }
    }

    public destroy(): void {
        this.pause();
        this.clearCurrentComments();
        this.comments = [];
        this.commentPool = [];
        this.activeAnimations.forEach(animation => animation.cancel());
        this.activeAnimations.clear();
    }


    private clearCurrentComments(): void {
        while (this.container.firstChild) {
            this.returnElementToPool(this.container.firstChild as HTMLElement);
        }
        this.localSlidingLanes = new Array(this.localLaneCount).fill(null);
        this.localTopBottomLanes = new Array(this.localLaneCount).fill(null);
    }


    // --- Settings Methods ---

    public setDensity(density: DensityMode): void {
        this.density = density;
        this.calculateLanes();
        this.syncCommentQueue();
    }


    public setSpeed(percent: number): void {
        this.speedMultiplier = Math.max(0.1, percent / 100);
        this.syncCommentQueue();
    }


    public setOpacity(percent: number): void {
        this.opacityLevel = percent / 100;
        this.container.style.opacity = this.opacityLevel.toString();
    }


    public setFontSize(percent: number): void {
        this.fontSizeMultiplier = Math.max(0.5, percent / 100);
        this.laneHeight = Math.floor(30 * this.fontSizeMultiplier);
        this.calculateLanes();
        this.syncCommentQueue();
    }


    private calculateLanes(): void {
        const screenHeight = this.videoPlayer.offsetHeight;
        console.debug(`Video player height: ${screenHeight}, lane height: ${this.laneHeight}`);
        const newLaneCount = Math.max(1, Math.floor(screenHeight / this.laneHeight));
        console.debug(`Local lane count: ${newLaneCount}`);

        if (newLaneCount !== this.localLaneCount) {
            const oldLaneCount = this.localLaneCount;
            this.localLaneCount = newLaneCount;
            console.debug(`Lane count changed from ${oldLaneCount} to ${newLaneCount}`);
            this.adjustLanes();
        }

        this.oldVideoPlayerHeight = this.videoPlayer.clientHeight;
        this.oldVideoPlayerWidth = this.videoPlayer.clientWidth;
    }


    // private adjustLanes(): void {
    //     console.debug("Adjusting lanes...");

    //     const maxTop = this.localLaneCount * this.laneHeight;

    //     this.container.querySelectorAll('.danmaku-comment').forEach(el => {
    //         const comment = el as HTMLElement;
    //         const commentBounds = comment.getBoundingClientRect();
    //         console.debug(`Comment top: ${commentBounds.top}, left: ${commentBounds.left}, text: ${comment.textContent}`);

    //         // all comments
    //         if (parseInt(comment.style.top) > maxTop) {
    //             this.returnElementToPool(comment);
    //         }

    //         if (comment.classList.contains('danmaku-animation-slide')) {
    //             console.debug("Adjusting sliding comment position...");
    //             // calculate the % of the animation completed based on current left position with old width
    //             const pos = commentBounds.left;
    //             const progress = 1 - (commentBounds.left / this.oldVideoPlayerWidth)
    //             // set new left position based on new width and progress
    //             const newPos = this.videoPlayer.clientWidth - (this.videoPlayer.clientWidth * progress);
    //             comment.style.left = `${newPos}px`;
    //             console.debug(`pos: ${pos}, old width: ${this.oldVideoPlayerWidth}, progress: ${progress}, new left: ${newPos}`);
    //         }
    //     });
    // }

    private adjustLanes(): void {
        console.debug("Adjusting lanes...");
        const maxTop = this.localLaneCount * this.laneHeight;

        for (const [element, animation] of Array.from(this.activeAnimations.entries())) {
            if (parseInt(element.style.top) >= maxTop) {
                this.returnElementToPool(element);
                continue;
            }

            if (!animation.effect || !(animation.effect instanceof KeyframeEffect)) {
                continue;
            }

            const keyframes = animation.effect.getKeyframes();

            // Identify sliding animations by checking their keyframes for a 'transform' property
            if (keyframes.length > 0 && keyframes[0].transform) {
                const currentTime = animation.currentTime;
                const duration = animation.effect.getComputedTiming().duration;

                if (duration === null || duration === undefined ||
                    typeof currentTime !== 'number' || isNaN(currentTime) ||
                    typeof duration !== 'number' || isNaN(duration) ||
                    duration <= 0 || currentTime < 0
                ) {
                    console.debug(animation);
                    console.debug("Invalid animation timing values, skipping adjustment.");
                    this.returnElementToPool(element);
                    continue;
                }

                const progress = (currentTime / duration);
                animation.cancel();
                const newKeyframes = [
                    { transform: `translateX(${this.container.clientWidth}px)` },
                    { transform: `translateX(-${element.offsetWidth}px)` }
                ];

                const newOptions: KeyframeAnimationOptions = {
                    duration: duration,
                    easing: 'linear',
                    fill: 'forwards'
                };

                const newAnimation = element.animate(newKeyframes, newOptions);
                newAnimation.addEventListener('finish', () => {
                    this.returnElementToPool(element);
                }, { once: true });
                this.activeAnimations.set(element, newAnimation);
                const resumeTime = Math.max(0, Math.min(duration, progress * duration));
                if (resumeTime > 0) {
                    newAnimation.currentTime = resumeTime;
                }

                if (!this.isRunning) {
                    newAnimation.pause();
                }
            }
        }
    }


    private setAllAnimationsPlayState(state: 'running' | 'paused'): void {
        // Instead of setting CSS animationPlayState, control Web Animations API
        this.activeAnimations.forEach(animation => {
            if (state === 'running') {
                animation.play();
            } else {
                animation.pause();
            }
        });
    }


    private addVideoEventListeners(): void {
        this.videoPlayer.addEventListener('timeupdate', this.emitNewComments.bind(this));
        this.videoPlayer.addEventListener('play', this.play.bind(this));
        this.videoPlayer.addEventListener('pause', this.pause.bind(this));
        this.videoPlayer.addEventListener('seeked', this.syncCommentQueue.bind(this));

        const resizeObserver = new ResizeObserver(() => {
            this.calculateLanes();
        });

        resizeObserver.observe(this.videoPlayer);
        console.debug("Added video event listeners.");
    }
}