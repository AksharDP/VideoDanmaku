import { Comment } from "../api";
import { RawComment, PlannedComment } from "../interfaces/danmaku";
import { ReportModal } from "../modal-report/modal-report";
import { DensityMode, DensityMap, ScrollMode, FontSize } from "../interfaces/enum";

export class Danmaku {

	private static readonly DEBUG = false;

	public videoPlayer: HTMLVideoElement;
	private container: HTMLElement;
	private controls: HTMLElement;
	private reportModal: ReportModal = new ReportModal();
	private comments: RawComment[] = [];

	public get getCommentsCount(): number { return this.comments.length; }

	private nextEmitIndex: number = 0;
	private isRunning = false;
	private isVisible: boolean = true;
	private isInViewport: boolean = true;

	private oldVideoPlayerHeight: number = 0;
	private oldVideoPlayerWidth: number = 0;
	private localLaneCount: number = 10;
	private localSlidingLanes: (HTMLElement | null)[] = [];
	private localTopBottomLanes: (HTMLElement | null)[] = [];
	private tempCanvasContext: CanvasRenderingContext2D | null = document.createElement('canvas').getContext('2d');
	private readonly commentFontStack = 'Roboto, Arial, sans-serif';
	private containerWidth = 0;
	private containerHeight = 0;
	private readonly measurementCache = new Map<string, number>();
	private readonly slidingLaneElements = new Map<number, Set<HTMLElement>>();
	private readonly slidingMeta = new WeakMap<HTMLElement, { emissionMs: number; width: number; left: number; right: number }>();

	private density: DensityMode = DensityMode.NORMAL;
	private baseDuration = 7000;
	private speedMultiplier: number = 1;
	private opacityLevel: number = 1;
	private fontSizeMultiplier: number = 1;
	private laneHeight: number = 30;
	private hoverPopup: HTMLElement | null = null;
	private hoverPopupActiveComment: HTMLElement | null = null;
	private mouseEnterTimer: number | null = null;
	private readonly hoverPopupGap = 8;

	private commentPool: HTMLElement[] = [];
	private readonly maxPoolSize: number = 150;

	private activeAnimations: Map<HTMLElement, Animation> = new Map();

	// RAF optimization
	private rafId: number | null = null;
	private lastEmissionTime: number = 0;
	private readonly emissionThrottle = 16.67; // ~60fps

	// Intersection Observer for viewport detection
	private intersectionObserver: IntersectionObserver | null = null;

	constructor(videoPlayer: HTMLVideoElement, container: HTMLElement, controls: HTMLElement) {
		this.videoPlayer = videoPlayer;
		this.container = container;
		this.controls = controls;
		this.calculateLanes();
		this.localSlidingLanes = new Array(this.localLaneCount).fill(null);
		this.localTopBottomLanes = new Array(this.localLaneCount).fill(null);
		this.addVideoEventListeners();
		this.setupEventDelegation();
		this.setupIntersectionObserver();
	}


	public setComments(comments: RawComment[]): void {
		this.comments = comments;
		this.syncCommentQueue();
	}


	public play(): void {
		if (this.isRunning || !this.isVisible || !this.isInViewport) return;
		this.isRunning = true;
		this.setAllAnimationsPlayState('running');
		this.startEmissionLoop();
	}


	public pause(): void {
		if (!this.isRunning) return;
		this.isRunning = false;
		this.setAllAnimationsPlayState('paused');
		this.stopEmissionLoop();
	}


	public toggleVisibility(force?: boolean): boolean {
		this.isVisible = force ?? !this.isVisible;
		this.container.style.display = this.isVisible ? "" : "none";

		if (this.isVisible && this.isInViewport) {
			this.play();
			this.syncCommentQueue();
		} else {
			this.pause();
			this.hideHoverPopup();
		}
		return this.isVisible;
	}


	// RAF-based emission loop for better performance
	private startEmissionLoop(): void {
		if (this.rafId !== null) return;
		const emissionLoop = (timestamp: number) => {
			if (!this.isRunning || !this.isVisible || !this.isInViewport) {
				this.rafId = null;
				return;
			}
			if (timestamp - this.lastEmissionTime >= this.emissionThrottle) {
				this.emitNewComments();
				this.lastEmissionTime = timestamp;
			}
			this.rafId = requestAnimationFrame(emissionLoop);
		};
		this.rafId = requestAnimationFrame(emissionLoop);
	}

	private stopEmissionLoop(): void {
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
	}

	/**
	* Syncs the danmaku display to the current video time.
	*/
	public syncCommentQueue(): void {
		if (this.getCommentsCount === 0 || !this.isVisible) return;

		const currentTime = this.videoPlayer.currentTime * 1000;
		this.clearCurrentComments();

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

	// Optimized metadata-based collision detection
	private computeSlideBoundsAt(elapsedMs: number, width: number): { left: number; right: number } {
		const effectiveDuration = this.baseDuration / this.speedMultiplier;
		const progress = Math.max(0, Math.min(1, elapsedMs / effectiveDuration));
		const x = this.containerWidth - (this.containerWidth + width) * progress;
		return { left: x, right: x + width };
	}

	private getAvailableSlidingLanesResync(comment: RawComment): number {
		if (comment.scrollMode !== ScrollMode.SLIDE) return -1;

		const nowMs = this.videoPlayer.currentTime * 1000;
		const elapsedMs = nowMs - comment.time;
		const effectiveDuration = this.baseDuration / this.speedMultiplier;

		if (elapsedMs < 0 || elapsedMs >= effectiveDuration) return -1;

		const rawWidth = this.measureCommentWidth(comment.content);
		const width = Math.ceil(rawWidth);
		const bounds = this.computeSlideBoundsAt(elapsedMs, width);

		return this.getAvailableSlidingLane(bounds);
	}

	// Optimized lane detection using metadata instead of DOM reads
	private getAvailableSlidingLane(bounds?: { left: number; right: number }): number {
		if (!bounds) {
			for (let i = 0; i < this.localLaneCount; i++) {
				const laneElement = this.localSlidingLanes[i];
				if (!laneElement || !laneElement.isConnected) {
					this.localSlidingLanes[i] = null;
					return i;
				}
			}
			return -1;
		}

		const spacing = DensityMap[this.density].delay;
		const nowMs = this.videoPlayer.currentTime * 1000;
		const effectiveDuration = this.baseDuration / this.speedMultiplier;

		laneLoop:
		for (let i = 0; i < this.localLaneCount; i++) {
			const laneSet = this.slidingLaneElements.get(i);
			if (!laneSet || laneSet.size === 0) {
				this.slidingLaneElements.delete(i);
				return i;
			}

			for (const element of laneSet) {
				if (!element.isConnected) {
					laneSet.delete(element);
					this.slidingMeta.delete(element);
					continue;
				}

				const metadata = this.slidingMeta.get(element);
				if (!metadata) {
					laneSet.delete(element);
					continue;
				}

				const elapsedMs = nowMs - metadata.emissionMs;
				if (elapsedMs < 0 || elapsedMs >= effectiveDuration) {
					laneSet.delete(element);
					this.slidingMeta.delete(element);
					continue;
				}

				// Use cached bounds from metadata instead of DOM reads
				const other = this.computeSlideBoundsAt(elapsedMs, metadata.width);
				const noOverlap =
					(bounds.right + spacing) <= other.left ||
					(bounds.left - spacing) >= other.right;

				if (!noOverlap) {
					continue laneLoop;
				}
			}

			if (laneSet.size === 0) {
				this.slidingLaneElements.delete(i);
			}
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
		if (!this.isRunning || !this.isVisible || !this.isInViewport) return;

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
				break;

			case ScrollMode.TOP:
				lane = this.getAvailableTopLane();
				break;

			case ScrollMode.BOTTOM:
				lane = this.getAvailableBottomLane();
				break;
		}

		if (lane === -1) {
			this.debugLog("No available lane found, returning early without creating element.");
			return;
		}

		const danmakuElement = this.getElementFromPool(comment);
		const measuredWidth = danmakuElement.dataset.measuredWidth ? Number(danmakuElement.dataset.measuredWidth) : undefined;
		const emissionTime = isResync ? comment.time : this.videoPlayer.currentTime * 1000;

		if (comment.scrollMode === ScrollMode.TOP || comment.scrollMode === ScrollMode.BOTTOM) {
			danmakuElement.classList.add('danmaku-animation-center');
		}

		danmakuElement.style.top = `${lane * this.laneHeight}px`;
		danmakuElement.dataset.laneIndex = lane.toString();
		danmakuElement.dataset.scrollMode = comment.scrollMode.toString();
		danmakuElement.dataset.emissionTime = emissionTime.toString();

		if (comment.scrollMode === ScrollMode.SLIDE) {
			this.localSlidingLanes[lane] = danmakuElement;
			this.registerSlidingElement(lane, danmakuElement, emissionTime, measuredWidth);
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
			const targetWidth = measuredWidth ?? element.getBoundingClientRect().width;
			keyframes = [
				{ transform: `translateX(${this.containerWidth}px)` },
				{ transform: `translateX(-${targetWidth}px)` }
			];
		}

		// Apply will-change for GPU acceleration
		element.style.willChange = 'transform';
		const animation = element.animate(keyframes, options);
		this.activeAnimations.set(element, animation);

		const handleFinish = () => {
			element.style.willChange = 'auto'; // Remove will-change to free memory
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
				return;
			}

			if (elapsedTime > 0) {
				animation.currentTime = elapsedTime;
			}
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

	// Optimized measurement with persistent caching
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
		this.slidingMeta.delete(element);

		element.removeAttribute('data-lane-index');
		element.removeAttribute('data-scroll-mode');
		element.removeAttribute('data-measured-width');
		element.style.willChange = 'auto';
		// Remove immediately for better memory management
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

		if (element.dataset.scrollMode === ScrollMode.SLIDE.toString()) {
			this.pruneSlidingLaneElement(lane, element);
		}
	}

	// Event delegation for better performance
	private setupEventDelegation(): void {
		this.container.addEventListener('pointerenter', this.handleDelegatedPointerEnter, true);
		this.container.addEventListener('pointerleave', this.handleDelegatedPointerLeave, true);
	}

	private handleDelegatedPointerEnter = (event: PointerEvent): void => {
		const target = event.target as HTMLElement;
		if (!target || !target.classList.contains('danmaku-comment')) return;

		if (this.mouseEnterTimer) {
			clearTimeout(this.mouseEnterTimer);
		}

		this.mouseEnterTimer = window.setTimeout(() => {
			this._showPopupAndPauseAnimation(target, event);
		}, 50);
	};

	private handleDelegatedPointerLeave = (event: PointerEvent): void => {
		const target = event.target as HTMLElement;
		if (!target || !target.classList.contains('danmaku-comment')) return;

		if (this.mouseEnterTimer) {
			clearTimeout(this.mouseEnterTimer);
			this.mouseEnterTimer = null;
		}

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


	// Intersection Observer for viewport detection
	private setupIntersectionObserver(): void {
		this.intersectionObserver = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				this.isInViewport = entry.isIntersecting;
				if (!this.isInViewport) {
					this.pause();
				} else if (this.isVisible && this.isRunning) {
					this.play();
				}
			}
		}, { threshold: 0.1 });
		this.intersectionObserver.observe(this.container);
	}

	public destroy(): void {
		this.pause();
		this.stopEmissionLoop();
		this.clearCurrentComments();
		this.comments = [];
		this.commentPool = [];
		this.activeAnimations.forEach(animation => animation.cancel());
		this.activeAnimations.clear();
		this.hideHoverPopup(true);
		this.measurementCache.clear();
		this.slidingLaneElements.clear();
		if (this.intersectionObserver) {
			this.intersectionObserver.disconnect();
			this.intersectionObserver = null;
		}
		// Remove event delegation
		this.container.removeEventListener('pointerenter', this.handleDelegatedPointerEnter, true);
		this.container.removeEventListener('pointerleave', this.handleDelegatedPointerLeave, true);
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
		this.slidingLaneElements.clear();
		this.hideHoverPopup();
	}



	public setDensity(density: DensityMode): void {
		this.density = density;
	}


	public setSpeed(percent: number): void {
		this.speedMultiplier = Math.max(0.1, percent / 100);
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
		const height = this.container.clientHeight;
		if (width > 0 && width !== this.containerWidth) {
			this.containerWidth = width;
		}
		if (height > 0 && height !== this.containerHeight) {
			this.containerHeight = height;
		}
	}

	private getContainerWidth(): number {
		if (this.containerWidth === 0) {
			this.cacheContainerMetrics();
		}
		return this.containerWidth || this.container.clientWidth;
	}

	private registerSlidingElement(lane: number, element: HTMLElement, emissionMs: number, measuredWidth?: number): void {
		let laneSet = this.slidingLaneElements.get(lane);
		if (!laneSet) {
			laneSet = new Set<HTMLElement>();
			this.slidingLaneElements.set(lane, laneSet);
		}
		laneSet.add(element);

		const widthFromParam = measuredWidth ?? (element.dataset.measuredWidth ? Number(element.dataset.measuredWidth) : NaN);
		const width = Number.isFinite(widthFromParam) ? widthFromParam : this.measureCommentWidth(element.textContent || '');
		if (width > 0) {
			// Cache bounds for metadata-based collision detection
			const bounds = this.computeSlideBoundsAt(0, width);
			this.slidingMeta.set(element, {
				emissionMs,
				width,
				left: bounds.left,
				right: bounds.right
			});
		}
	}

	private pruneSlidingLaneElement(lane: number, element: HTMLElement): void {
		const laneSet = this.slidingLaneElements.get(lane);
		if (!laneSet) return;
		laneSet.delete(element);
		this.slidingMeta.delete(element);
		if (laneSet.size === 0) {
			this.slidingLaneElements.delete(lane);
		}
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

			// ...existing code for animation adjustment...
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
		// Remove timeupdate listener as we're using RAF now
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

	// Simplified popup methods (existing implementation)
	private _showPopupAndPauseAnimation(target: HTMLElement, event: PointerEvent): void {
		if (!target) return;

		const related = event.relatedTarget as Node | null;
		const previousActive = this.hoverPopupActiveComment;
		const popupVisible = Boolean(
			this.hoverPopup &&
			this.hoverPopup.style.display !== 'none' &&
			this.hoverPopup.style.visibility !== 'hidden'
		);

		if (previousActive === target && popupVisible) {
			this.hoverPopupActiveComment = target;
			const animation = this.activeAnimations.get(target);
			if (animation) {
				animation.pause();
			}
			// Set z-index when hovering
			target.style.zIndex = '998';
			return;
		}

		const fromPopup = Boolean(related && this.hoverPopup && this.hoverPopup.contains(related));
		const isSameCommentReenter = fromPopup && previousActive === target;

		this.hoverPopupActiveComment = target;

		if (isSameCommentReenter && this.hoverPopup) {
			this.debugLog("Re-entered same comment from popup, keeping popup visible.");
			this.hoverPopup.style.display = 'flex';
			this.hoverPopup.style.visibility = 'visible';
		} else {
			this.debugLog("Showing popup for new comment.");
			this.showHoverPopup(target, event);
		}

		const animation = this.activeAnimations.get(target);
		if (animation) {
			animation.pause();
		}
		// Set z-index when hovering
		target.style.zIndex = '998';
	}

	private createHoverPopup(): HTMLElement {
		if (this.hoverPopup) return this.hoverPopup;
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
			}
		});
		popup.appendChild(reportBtn);
		popup.addEventListener('mouseleave', this.handlePopupMouseLeave);
		this.container.appendChild(popup);
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

	private showHoverPopup(target: HTMLElement, event: PointerEvent): void {
		if (!this.hoverPopup) {
			this.hoverPopup = this.createHoverPopup();
		}
		this.hoverPopup.style.display = 'flex';
		this.hoverPopup.style.visibility = 'visible';
		this.positionHoverPopup(this.hoverPopup, event, target);
	}

	private positionHoverPopup(popup: HTMLElement, event: PointerEvent, target: HTMLElement): void {

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
		// Remove z-index from the active comment
		if (this.hoverPopupActiveComment) {
			this.hoverPopupActiveComment.style.zIndex = '';
		}
		this.hoverPopupActiveComment = null;
	}
}