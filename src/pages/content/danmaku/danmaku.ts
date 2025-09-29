import { Comment } from "../api";
import { RawComment, PlannedComment } from "../interfaces/danmaku";
import { ReportModal } from "../modal-report/modal-report";
import { DensityMode, DensityMap, ScrollMode, FontSize } from "../interfaces/enum";

export class Danmaku {

	private static readonly DEBUG = true;

	public videoPlayer: HTMLVideoElement;
	private container: HTMLElement;
	private controls: HTMLElement;
	private reportModal: ReportModal = new ReportModal();
	private comments: RawComment[] = [];

	public get getCommentsCount(): number { return this.comments.length; }

	private nextEmitIndex: number = 0;
	private isRunning = false;
	private isVisible: boolean = true;

	private oldVideoPlayerHeight: number = 0;
	private oldVideoPlayerWidth: number = 0;
	private localLaneCount: number = 10;
	private localSlidingLanes: (HTMLElement | null)[] = [];
	private localTopBottomLanes: (HTMLElement | null)[] = [];
	private tempCanvasContext: CanvasRenderingContext2D | null = document.createElement('canvas').getContext('2d');
	private readonly commentFontStack = 'Roboto, Arial, sans-serif';
	private containerWidth = 0;
	private readonly measurementCache = new Map<string, number>();

	private density: DensityMode = DensityMode.NORMAL;
	private baseDuration = 7000;
	private speedMultiplier: number = 1;
	private opacityLevel: number = 1;
	private fontSizeMultiplier: number = 1;
	private laneHeight: number = 30;
	private hoverPopup: HTMLElement | null = null;
	private hoverPopupActiveComment: HTMLElement | null = null;
	private mouseEnterTimer: number | null = null; // Added timer property
	private readonly hoverPopupGap = 8;

	private commentPool: HTMLElement[] = [];
	private readonly maxPoolSize: number = 150;

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


	public setComments(comments: RawComment[]): void {
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
			this.hideHoverPopup();
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

		// this.calculateLanes();
		this.nextEmitIndex = this.comments.findIndex(c => c.time > currentTime);
		if (this.nextEmitIndex === -1) this.nextEmitIndex = this.comments.length;

		for (let i = 0; i < this.nextEmitIndex; i++) {
			const comment = this.comments[i];
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

	// 1) Helper: compute slide bounds at a given elapsed time
	private computeSlideBoundsAt(elapsedMs: number, width: number): { left: number; right: number } {
		const containerWidth = this.getContainerWidth();
		const effectiveDuration = this.baseDuration / this.speedMultiplier;
		const progress = Math.max(0, Math.min(1, elapsedMs / effectiveDuration));
		// Matches keyframes: from translateX(containerWidth) to translateX(-width)
		const x = containerWidth - (containerWidth + width) * progress;
		return { left: x, right: x + width };
	}

	// 2) New: resync-time lane chooser for sliding comments
	private getAvailableSlidingLanesResync(comment: RawComment): number {
		// Only meaningful for sliding comments; guard optional callers.
		if (comment.scrollMode !== ScrollMode.SLIDE) return -1;

		const nowMs = this.videoPlayer.currentTime * 1000;
		const elapsedMs = nowMs - comment.time;
		const effectiveDuration = this.baseDuration / this.speedMultiplier;

		// If this comment would not be on-screen anymore (or not yet), skip.
		if (elapsedMs < 0 || elapsedMs >= effectiveDuration) return -1;

		// Match width calculation used during element creation to avoid drift
		const rawWidth = this.measureCommentWidth(comment.content);
		const width = Math.ceil(rawWidth);
		const bounds = this.computeSlideBoundsAt(elapsedMs, width);

		// Ask the bounds-aware lane picker for a lane that is free at these bounds
		return this.getAvailableSlidingLane(bounds);
	}

	// 3) Update: make getAvailableSlidingLane optionally bounds-aware
	private getAvailableSlidingLane(
		bounds?: { left: number; right: number }
	): number {
		if (!bounds) {
			const containerWidth = this.getContainerWidth();
			for (let i = 0; i < this.localLaneCount; i++) {
				const laneElement = this.localSlidingLanes[i];
				if (!laneElement) return i;

				const rightEdge = laneElement.getBoundingClientRect().right;
				const delay = DensityMap[this.density].delay;
				// If the previously assigned element has moved sufficiently left or is detached, reuse the lane
				if (!laneElement.isConnected || rightEdge + delay < containerWidth) {
					this.localSlidingLanes[i] = null;
					return i;
				}
			}
			return -1;
		}

		// Bounds-aware scan across all lanes for resync placement
		const spacing = DensityMap[this.density].delay;
		const nowMs = this.videoPlayer.currentTime * 1000;
		const effectiveDuration = this.baseDuration / this.speedMultiplier;

		// For each lane, test if any active sliding comment intersects [left,right] at 'now'
		laneLoop:
		for (let i = 0; i < this.localLaneCount; i++) {
			// Check all active elements in this lane
			for (const [element] of Array.from(this.activeAnimations.entries())) {
				if (!element.isConnected) continue;

				const laneToken = element.dataset.laneIndex;
				if (laneToken === undefined) continue;
				const laneIndex = Math.trunc(Number(laneToken));
				if (laneIndex !== i) continue;

				// Only compare against other sliding comments
				const modeToken = element.dataset.scrollMode;
				if (modeToken === undefined || modeToken !== ScrollMode.SLIDE.toString()) continue;

				// Reconstruct this element’s width and elapsed time
				const measured = element.dataset.measuredWidth ? Number(element.dataset.measuredWidth) : undefined;
				const width = measured ?? element.getBoundingClientRect().width;

				const startToken = element.dataset.emissionTime;
				if (startToken === undefined) continue;
				const emissionMs = Number(startToken);
				const elapsedMs = nowMs - emissionMs;

				// If this element should not be on screen at 'now', skip
				if (elapsedMs < 0 || elapsedMs >= effectiveDuration) continue;

				// Compute this element's in-flight bounds at 'now'
				const other = this.computeSlideBoundsAt(elapsedMs, width);

				// Collision test with density spacing as horizontal padding
				const noOverlap =
					(bounds.right + spacing) <= other.left ||
					(bounds.left - spacing) >= other.right;

				if (!noOverlap) {
					// This lane conflicts; try next lane
					continue laneLoop;
				}
			}

			// No conflicts in this lane for these bounds
			return i;
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
				lane = isResync
					? this.getAvailableSlidingLanesResync(comment)
					: this.getAvailableSlidingLane();
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
			const containerWidth = this.getContainerWidth();
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

		if (!el.dataset.popupBound) {
			el.addEventListener('mouseenter', this.handleCommentMouseEnter);
			el.addEventListener('mousemove', this.handleCommentMouseEnter); // Added mousemove
			el.addEventListener('mouseleave', this.handleCommentMouseLeave);
			el.dataset.popupBound = '1';
		}

		return el;
	}

	private measureCommentWidth(content: string): number {
		const ctx = this.tempCanvasContext;
		if (!ctx) return 0;
		const fontSize = 24 * this.fontSizeMultiplier;
		const cacheKey = `${fontSize}:${content}`;
		const cachedWidth = this.measurementCache.get(cacheKey);
		if (cachedWidth !== undefined) return cachedWidth;
		ctx.font = `normal ${fontSize}px ${this.commentFontStack}`;
		const width = ctx.measureText(content).width;
		this.measurementCache.set(cacheKey, width);
		if (this.measurementCache.size > 500) {
			this.measurementCache.clear();
		}
		return width;
	}


	private returnElementToPool(element: HTMLElement): void {
		const animation = this.activeAnimations.get(element);
		if (animation) {
			animation.cancel();
			this.activeAnimations.delete(element);
		}

		this.releaseLane(element);

		if (element === this.hoverPopupActiveComment) {
			this.hideHoverPopup();
		}

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
		this.hideHoverPopup(true);
		this.measurementCache.clear();
	}


	private clearCurrentComments(): void {
		while (this.container.firstChild) {
			const child = this.container.firstChild as HTMLElement;
			if (child === this.hoverPopup) {
				this.container.removeChild(child);
			} else {
				this.returnElementToPool(child);
			}
		}
		this.localSlidingLanes = new Array(this.localLaneCount).fill(null);
		this.localTopBottomLanes = new Array(this.localLaneCount).fill(null);
		this.activeAnimations.clear();
		this.hideHoverPopup();
	}



	public setDensity(density: DensityMode): void {
		this.density = density;
		// this.calculateLanes();
		// this.syncCommentQueue();
	}


	public setSpeed(percent: number): void {
		this.speedMultiplier = Math.max(0.1, percent / 100);
		// this.syncCommentQueue();
	}


	public setOpacity(percent: number): void {
		this.opacityLevel = percent / 100;
		this.container.style.opacity = this.opacityLevel.toString();
	}


	public setFontSize(percent: number): void {
		this.fontSizeMultiplier = Math.max(0.5, percent / 100);
		this.laneHeight = Math.floor(30 * this.fontSizeMultiplier);
		this.calculateLanes();
		this.measurementCache.clear();
		// this.syncCommentQueue();
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

		this.cacheContainerMetrics();
		this.oldVideoPlayerHeight = this.videoPlayer.clientHeight;
		this.oldVideoPlayerWidth = this.videoPlayer.clientWidth;
	}

	private cacheContainerMetrics(): void {
		const width = this.container.clientWidth;
		if (width > 0 && width !== this.containerWidth) {
			this.containerWidth = width;
		}
	}

	private getContainerWidth(): number {
		if (this.containerWidth === 0) {
			this.cacheContainerMetrics();
		}
		return this.containerWidth || this.container.clientWidth;
	}

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

	// This method is now a debouncer
	private handleCommentMouseEnter = (event: MouseEvent): void => {
		const target = event.currentTarget as HTMLElement;
		if (!target) return;

		if (this.mouseEnterTimer) {
			clearTimeout(this.mouseEnterTimer);
		}

		this.mouseEnterTimer = window.setTimeout(() => {
			this._showPopupAndPauseAnimation(target, event);
		}, 50);
	};

	// Original logic moved to a new private method
	private _showPopupAndPauseAnimation(target: HTMLElement, event: MouseEvent): void {
		if (!target) return;

		const related = event.relatedTarget as Node | null;
		const fromPopup = Boolean(related && this.hoverPopup && this.hoverPopup.contains(related));
		const previousActive = this.hoverPopupActiveComment;
		const isSameCommentReenter = fromPopup && previousActive === target;

		this.hoverPopupActiveComment = target;

		if (isSameCommentReenter && this.hoverPopup) {
			console.debug("Re-entered same comment from popup, keeping popup visible.");
			this.hoverPopup.style.display = 'flex';
			this.hoverPopup.style.visibility = 'visible';
		} else {
			console.debug("Showing popup for new comment.");
			this.showHoverPopup(target, event);
		}

		const animation = this.activeAnimations.get(target);
		if (animation) {
			animation.pause();
		}
	}

	private handleCommentMouseLeave = (event: MouseEvent): void => {
		// Clear any pending timer when the mouse leaves
		if (this.mouseEnterTimer) {
			clearTimeout(this.mouseEnterTimer);
			this.mouseEnterTimer = null;
		}

		const target = event.currentTarget as HTMLElement | null;
		if (!target) return;

		const nextTarget = event.relatedTarget as Node | null;
		if (nextTarget && this.hoverPopup && this.hoverPopup.contains(nextTarget)) {
			return;
		}

		if (this.isRunning) {
			const animation = this.activeAnimations.get(target);
			if (animation) {
				animation.play();
			}
		}

		if (target === this.hoverPopupActiveComment) {
			this.hoverPopupActiveComment = null;
		}

		this.hideHoverPopup();
	};

	private createHoverPopup(): HTMLElement {
		if (this.hoverPopup) return this.hoverPopup;
		// if (getComputedStyle(this.container).position === 'static') {
		// 	this.container.style.position = 'relative';
		// }
		const popup = document.createElement('div');
		popup.className = 'danmaku-popup';
		const copyBtn = document.createElement('button');
		copyBtn.className = 'danmaku-popup-button';
		copyBtn.title = 'Copy';
		copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
		copyBtn.addEventListener('click', () => {
			if (this.hoverPopupActiveComment) {
				void navigator.clipboard.writeText(this.hoverPopupActiveComment.textContent || '');
			}
		});
		popup.appendChild(copyBtn);
		const reportBtn = document.createElement('button');
		reportBtn.className = 'danmaku-popup-button';
		reportBtn.title = 'Report';
		reportBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
		reportBtn.addEventListener('click', () => {
			if (this.hoverPopupActiveComment) {
				// Handle report action
			}
		});
		popup.appendChild(reportBtn);
		// popup.querySelectorAll<SVGElement>('svg').forEach(svg => {
		// 	svg.setAttribute('width', '16');
		// 	svg.setAttribute('height', '16');
		// 	svg.setAttribute('viewBox', '0 0 24 24');
		// 	if (!svg.innerHTML.trim()) {
		// 		svg.innerHTML = '<rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" />';
		// 	}
		// });
		popup.addEventListener('mouseleave', this.handlePopupMouseLeave);
		this.container.appendChild(popup);
		// this.hoverPopup = popup;
		return popup;
	}

	private handlePopupMouseLeave = (event: MouseEvent): void => {
		const nextTarget = event.relatedTarget as Node | null;
		if (nextTarget && this.hoverPopupActiveComment && this.hoverPopupActiveComment.contains(nextTarget as Node)) {
			return;
		}

		if (this.hoverPopupActiveComment && this.isRunning) {
			const animation = this.activeAnimations.get(this.hoverPopupActiveComment);
			if (animation) {
				animation.play();
			}
		}

		this.hoverPopupActiveComment = null;
		this.hideHoverPopup();
	};

	private showHoverPopup(target: HTMLElement, event: MouseEvent): void {
		if (!this.hoverPopup) {
			this.hoverPopup = this.createHoverPopup();
		}
		this.hoverPopup.style.display = 'flex';
		this.hoverPopup.style.visibility = 'visible';
		this.positionHoverPopup(this.hoverPopup, event, target);
	}

	private positionHoverPopup(popup: HTMLElement, event: MouseEvent, target: HTMLElement): void {

		const containerRect = this.container.getBoundingClientRect();
		const videoPlayerRect = this.videoPlayer.getBoundingClientRect();
		const commentRect = target.getBoundingClientRect();
		const popupRect = popup.getBoundingClientRect();
		const popupWidth = popupRect.width || popup.offsetWidth;
		const popupHeight = popupRect.height || popup.offsetHeight;

		let popupLeft = (event.clientX - containerRect.left)
		if (popupLeft < 0) {
			popupLeft = 0;
		} else if (popupLeft + popupRect.width > containerRect.width) {
			popupLeft = containerRect.width - popupRect.width;
		}

		const top = commentRect.bottom - videoPlayerRect.top
		let popupTop = top;
		if (popupTop + popupHeight > videoPlayerRect.height) {
			popupTop = commentRect.top - videoPlayerRect.top - popupHeight
		} else if (popupTop < 0) {
			popupTop = 0;
		}

		popup.style.left = `${popupLeft}px`;
		popup.style.top = `${popupTop}px`;
	}

	private hideHoverPopup(remove = false): void {
		if (!this.hoverPopup) return;
		this.hoverPopup.style.display = 'none';
		this.hoverPopup.style.visibility = 'hidden';
		if (remove) {
			this.hoverPopup.remove();
			this.hoverPopup = null;
		}
		this.hoverPopupActiveComment = null;
	}
}