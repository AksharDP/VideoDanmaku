import { Comment } from "../api";

interface DanmakuComment extends Comment {
    y: number;
    x: number;
    speed: number; // pixels per second
    width: number;
    lane: number;
    expiry: number; // The video timestamp when the comment should disappear
    element: HTMLElement; // DOM element for the comment
}

export class Danmaku {
    private container: HTMLElement;
    private allComments: Comment[] = [];
    private comments: Comment[] = [];
    private activeComments: DanmakuComment[] = [];
    private videoPlayer: HTMLVideoElement;
    private isRunning = false;
    private lastTimestamp = 0;

    // Lane properties
    private slidingLanes: number[];
    private topLanes: number[];
    private bottomLanes: number[];
    private static readonly DURATION = 5; // 5 seconds on screen
    private static readonly LANE_HEIGHT = 30;
    private static readonly FONT_SIZE = 24;

    constructor(videoPlayer: HTMLVideoElement) {
        this.videoPlayer = videoPlayer;
        this.container = document.createElement("div");
        this.setupContainer();
        this.videoPlayer.addEventListener('seeking', () => this.onSeek());
        this.start();

        const videoRect = this.videoPlayer.getBoundingClientRect();
        const numLanes = Math.floor(videoRect.height / Danmaku.LANE_HEIGHT);
        this.slidingLanes = new Array(numLanes).fill(0);
        this.topLanes = new Array(numLanes).fill(0);
        this.bottomLanes = new Array(numLanes).fill(0);
    }

    private setupContainer() {
        const videoRect = this.videoPlayer.getBoundingClientRect();
        this.container.style.position = "absolute";
        this.container.style.top = `${this.videoPlayer.offsetTop}px`;
        this.container.style.left = `${this.videoPlayer.offsetLeft}px`;
        this.container.style.width = `${videoRect.width}px`;
        this.container.style.height = `${videoRect.height}px`;
        this.container.style.pointerEvents = "none";
        this.container.style.zIndex = "10";
        this.container.style.overflow = "hidden";
        this.videoPlayer.parentElement?.appendChild(this.container);

        const resizeObserver = new ResizeObserver(() => this.onResize());
        resizeObserver.observe(this.videoPlayer);
    }

    private onResize() {
        const videoRect = this.videoPlayer.getBoundingClientRect();
        this.container.style.top = `${this.videoPlayer.offsetTop}px`;
        this.container.style.left = `${this.videoPlayer.offsetLeft}px`;
        this.container.style.width = `${videoRect.width}px`;
        this.container.style.height = `${videoRect.height}px`;

        const numLanes = Math.floor(videoRect.height / Danmaku.LANE_HEIGHT);
        this.slidingLanes = new Array(numLanes).fill(0);
        this.topLanes = new Array(numLanes).fill(0);
        this.bottomLanes = new Array(numLanes).fill(0);
    }

    private onSeek() {
        // Remove all active comment elements
        this.activeComments.forEach(comment => {
            comment.element.remove();
        });
        this.activeComments = [];
        this.comments = [...this.allComments];
        this.lastTimestamp = 0;
        this.slidingLanes.fill(0);
        this.topLanes.fill(0);
        this.bottomLanes.fill(0);
    }

    public loadComments(comments: Comment[]) {
        this.allComments = comments.sort((a, b) => a.time - b.time);
        this.comments = [...this.allComments];
    }

    public addCommentToList(comment: Comment) {
        const allIdx = this.allComments.findIndex(c => c.time > comment.time);
        if (allIdx === -1) {
            this.allComments.push(comment);
        } else {
            this.allComments.splice(allIdx, 0, comment);
        }

        const currentIdx = this.comments.findIndex(c => c.time > comment.time);
        if (currentIdx === -1) {
            this.comments.push(comment);
        } else {
            this.comments.splice(currentIdx, 0, comment);
        }
    }

    private renderLoop = (timestamp: number) => {
        if (!this.isRunning) return;

        const currentTime = this.videoPlayer.currentTime;

        if (!this.videoPlayer.paused) {
            if (this.lastTimestamp === 0) {
                this.lastTimestamp = timestamp;
            }

            const deltaTime = (timestamp - this.lastTimestamp) / 1000;
            this.lastTimestamp = timestamp;

            while (this.comments.length > 0 && this.comments[0].time <= currentTime) {
                const comment = this.comments.shift()!;
                this.addDanmaku(comment);
            }

            this.activeComments.forEach(comment => {
                if (comment.scrollMode === 'slide') {
                    comment.x -= comment.speed * deltaTime;
                    comment.element.style.transform = `translateX(${comment.x}px)`;
                }
            });

        } else {
            this.lastTimestamp = 0;
        }

        this.activeComments = this.activeComments.filter(comment => {
            if (comment.expiry <= currentTime) {
                comment.element.remove();
                return false; // Comment has expired
            }
            return true;
        });

        requestAnimationFrame(this.renderLoop);
    };

    public addDanmaku(comment: Comment) {
        // Create a temporary element to measure text width
        const tempElement = document.createElement('div');
        tempElement.className = `danmaku-comment ${comment.fontSize}`;
        tempElement.style.position = 'absolute';
        tempElement.style.visibility = 'hidden';
        tempElement.style.whiteSpace = 'nowrap';
        tempElement.textContent = comment.content;
        document.body.appendChild(tempElement);
        
        const width = tempElement.offsetWidth;
        document.body.removeChild(tempElement);
        
        const currentTime = this.videoPlayer.currentTime;
        const containerRect = this.container.getBoundingClientRect();

        let lane = -1;
        let y = 0;
        let x = 0;
        let speed = 0;

        if (comment.scrollMode === 'slide') {
            speed = (containerRect.width + width) / Danmaku.DURATION;
            const timeToClear = (width / speed);

            for (let i = 0; i < this.slidingLanes.length; i++) {
                if (this.slidingLanes[i] <= currentTime) {
                    lane = i;
                    this.slidingLanes[i] = currentTime + timeToClear;
                    break;
                }
            }
            if (lane === -1) return; // No available lane

            x = containerRect.width;
            y = (lane * Danmaku.LANE_HEIGHT) + (Danmaku.LANE_HEIGHT / 2);

        } else { // Top or Bottom comments
            const lanes = comment.scrollMode === 'top' ? this.topLanes : this.bottomLanes;
            for (let i = 0; i < lanes.length; i++) {
                if (lanes[i] <= currentTime) {
                    lane = i;
                    lanes[i] = currentTime + Danmaku.DURATION;
                    break;
                }
            }
            if (lane === -1) return; // No available lane

            x = (containerRect.width - width) / 2;
            if (comment.scrollMode === 'top') {
                y = (lane * Danmaku.LANE_HEIGHT) + (Danmaku.LANE_HEIGHT / 2);
            } else { // bottom
                y = containerRect.height - (lane * Danmaku.LANE_HEIGHT) - (Danmaku.LANE_HEIGHT / 2);
            }
        }

        // Create the danmaku element
        const element = document.createElement('div');
        element.className = `danmaku-comment ${comment.fontSize} ${comment.scrollMode}`;
        element.style.color = comment.color;
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;
        element.textContent = comment.content;
        
        this.container.appendChild(element);

        const danmaku: DanmakuComment = {
            ...comment,
            x: x,
            y: y,
            speed: speed,
            width: width,
            lane: lane,
            expiry: currentTime + Danmaku.DURATION,
            element: element,
        };

        this.activeComments.push(danmaku);
    }

    public start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTimestamp = 0;
        requestAnimationFrame(this.renderLoop);
    }

    public stop() {
        this.isRunning = false;
        // Clean up all active comment elements
        this.activeComments.forEach(comment => {
            comment.element.remove();
        });
        this.activeComments = [];
    }
}
