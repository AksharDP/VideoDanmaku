import { Comment } from "../api";
import { RawComment, PlannedComment } from "../interfaces/danmaku";
import { ReportModal } from "../modal-report/modal-report";
import { DensityMode, ScrollMode, FontSize } from "../interfaces/enum";

export class Danmaku {

	private static readonly DEBUG = false;

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
	private tempCanvasContext: CanvasRenderingContext2D | null = document.createElement('canvas').getContext('2d');
	private readonly commentFontStack = 'Roboto, Arial, sans-serif';

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
			if (!laneElement || !laneElement.isConnected) {
				this.localSlidingLanes[i] = null;
				return i;
			}
		}
		return -1;
	}

	private getAvailableTopLane(): number {
		for (let i = 0; i < this.localLaneCount; i++) {
			const laneElement = this.localTopBottomLanes[i];
			if (!laneElement || !laneElement.isConnected) {
				this.localTopBottomLanes[i] = null;
				return i;
			}
		}
		return -1;
	}

	private getAvailableBottomLane(): number {
		for (let i = this.localLaneCount - 1; i >= 0; i--) {
			const laneElement = this.localTopBottomLanes[i];
			if (!laneElement || !laneElement.isConnected) {
				this.localTopBottomLanes[i] = null;
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
		this.debugLog(`Emitting comment: ${comment.content}, mode: ${comment.scrollMode}, isResync: ${isResync}`);

		let lane = -1;

		switch (comment.scrollMode) {
			case ScrollMode.SLIDE:
				lane = this.getAvailableSlidingLane();
				this.debugLog(`Sliding lane assigned: ${lane}`);
				break;
			case ScrollMode.TOP:
				lane = this.getAvailableTopLane();
				this.debugLog(`Top lane assigned: ${lane}`);
				break;
			case ScrollMode.BOTTOM:
				lane = this.getAvailableBottomLane();
				this.debugLog(`Bottom lane assigned: ${lane}`);
				break;
		}

		if (lane === -1) {
			this.debugLog("No available lane found, returning early without creating element.");
			return;
		}

		const danmakuElement = this.getElementFromPool(comment);
		const measuredWidth = danmakuElement.dataset.measuredWidth ? Number(danmakuElement.dataset.measuredWidth) : undefined;

		if (comment.scrollMode === ScrollMode.TOP || comment.scrollMode === ScrollMode.BOTTOM) {
			danmakuElement.classList.add('danmaku-animation-center');
		}

		danmakuElement.style.top = `${lane * this.laneHeight}px`;
		danmakuElement.dataset.laneIndex = lane.toString();
		danmakuElement.dataset.scrollMode = comment.scrollMode.toString();

		if (comment.scrollMode === ScrollMode.SLIDE) {
			this.localSlidingLanes[lane] = danmakuElement;
		} else {
			this.localTopBottomLanes[lane] = danmakuElement;
		}

		this.startAnimation(
			danmakuElement,
			comment.scrollMode,
			isResync,
			isResync ? comment.time : undefined,
			measuredWidth
		);
	}


	private startAnimation(
		element: HTMLElement,
		scrollMode: ScrollMode,
		isResync: boolean,
		startTime?: number,
		measuredWidth?: number
	): void {
		let keyframes: Keyframe[] = [];

		const baseDuration = scrollMode === ScrollMode.SLIDE ? this.baseDuration : this.baseDuration / 2;
		const effectiveDuration = baseDuration / this.speedMultiplier;

		const options: KeyframeAnimationOptions = {
			duration: effectiveDuration,
			easing: 'linear',
			fill: 'forwards'
		};

		if (scrollMode === ScrollMode.SLIDE) {
			const containerWidth = this.container.clientWidth;
			const targetWidth = measuredWidth ?? element.getBoundingClientRect().width;
			keyframes = [
				{ transform: `translateX(${containerWidth}px)` },
				{ transform: `translateX(-${targetWidth}px)` }
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
				this.debugLog(`Resync skipped animation: startTime = ${startTime}, elapsed >= duration (${elapsedTime} >= ${effectiveDuration})`);
				return;
			}

			if (elapsedTime > 0) {
				animation.currentTime = elapsedTime;
			}

			this.debugLog(`Resyncing animation: startTime = ${startTime}, effectiveDuration = ${effectiveDuration}, elapsedTime = ${elapsedTime}, new currentTime = ${animation.currentTime}`);
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

		delete el.dataset.laneIndex;
		delete el.dataset.scrollMode;
		delete el.dataset.measuredWidth;

		el.textContent = comment.content;
		el.style.color = comment.color;
		el.style.fontSize = `${24 * this.fontSizeMultiplier}px`;
		el.style.opacity = this.opacityLevel.toString();
		el.dataset.commentId = comment.id.toString();
		el.dataset.emissionTime = comment.time.toString();

		if (comment.scrollMode === ScrollMode.SLIDE) {
			const width = this.measureCommentWidth(comment.content);
			if (width > 0) {
				const roundedWidth = Math.ceil(width);
				el.style.width = `${roundedWidth}px`;
				el.dataset.measuredWidth = roundedWidth.toString();
			}
		}

		this.container.appendChild(el);
		return el;
	}

	private measureCommentWidth(content: string): number {
		const ctx = this.tempCanvasContext;
		if (!ctx) return 0;
		const fontSize = 24 * this.fontSizeMultiplier;
		ctx.font = `normal ${fontSize}px ${this.commentFontStack}`;
		return ctx.measureText(content).width;
	}


	private returnElementToPool(element: HTMLElement): void {
		const animation = this.activeAnimations.get(element);
		if (animation) {
			animation.cancel();
			this.activeAnimations.delete(element);
		}

		this.releaseLane(element);

		element.removeAttribute('data-lane-index');
		element.removeAttribute('data-scroll-mode');
		element.removeAttribute('data-measured-width');

		element.remove();

		if (this.commentPool.length < this.maxPoolSize) {
			this.commentPool.push(element);
		}
	}

	private releaseLane(element: HTMLElement): void {
		const laneToken = element.dataset.laneIndex;
		if (laneToken === undefined) return;

		const lane = Math.trunc(Number(laneToken));
		if (!Number.isFinite(lane) || lane < 0) return;

		if (lane < this.localSlidingLanes.length && this.localSlidingLanes[lane] === element) {
			this.localSlidingLanes[lane] = null;
		}

		if (lane < this.localTopBottomLanes.length && this.localTopBottomLanes[lane] === element) {
			this.localTopBottomLanes[lane] = null;
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
		this.debugLog(`Video player height: ${screenHeight}, lane height: ${this.laneHeight}`);
		const newLaneCount = Math.max(1, Math.floor(screenHeight / this.laneHeight));
		this.debugLog(`Local lane count: ${newLaneCount}`);

		if (newLaneCount !== this.localLaneCount) {
			const oldLaneCount = this.localLaneCount;
			this.localLaneCount = newLaneCount;
			this.debugLog(`Lane count changed from ${oldLaneCount} to ${newLaneCount}`);
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
		this.debugLog("Adjusting lanes...");

		for (const [element, animation] of Array.from(this.activeAnimations.entries())) {
			const laneToken = element.dataset.laneIndex;
			const lane = laneToken !== undefined ? Math.trunc(Number(laneToken)) : NaN;

			if (!Number.isFinite(lane) || lane < 0 || lane >= this.localLaneCount) {
				this.returnElementToPool(element);
				continue;
			}

			if (!animation.effect || !(animation.effect instanceof KeyframeEffect)) {
				continue;
			}

			const keyframes = animation.effect.getKeyframes();

			if (keyframes.length > 0 && keyframes[0].transform) {
				const currentTime = animation.currentTime;
				const timing = animation.effect.getComputedTiming();
				const duration = typeof timing.duration === 'number' ? timing.duration : undefined;

				if (duration === undefined ||
					typeof currentTime !== 'number' ||
					Number.isNaN(currentTime) ||
					duration <= 0 ||
					currentTime < 0) {
					this.debugLog("Invalid animation timing values, skipping adjustment.", animation);
					this.returnElementToPool(element);
					continue;
				}

				const progress = currentTime / duration;
				animation.cancel();
				this.activeAnimations.delete(element);

				const measuredWidth = element.dataset.measuredWidth ? Number(element.dataset.measuredWidth) : undefined;
				const targetWidth = measuredWidth ?? element.getBoundingClientRect().width;

				const newKeyframes = [
					{ transform: `translateX(${this.container.clientWidth}px)` },
					{ transform: `translateX(-${targetWidth}px)` }
				];

				const newOptions: KeyframeAnimationOptions = {
					duration,
					easing: 'linear',
					fill: 'forwards'
				};

				const newAnimation = element.animate(newKeyframes, newOptions);
				newAnimation.addEventListener('finish', () => {
					this.returnElementToPool(element);
				}, { once: true });
				const resumeTime = Math.max(0, Math.min(duration, progress * duration));
				if (resumeTime > 0) {
					newAnimation.currentTime = resumeTime;
				}

				this.activeAnimations.set(element, newAnimation);

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
		this.debugLog("Added video event listeners.");
	}


	private debugLog(...args: unknown[]): void {
		if (!Danmaku.DEBUG) return;
		console.debug(...args);
	}
}