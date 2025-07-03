import { Comment } from "../api";

interface DanmakuComment extends Comment {
    y: number;
    x: number;
    speed: number; // pixels per second
    width: number;
    lane: number;
    expiry: number; // The video timestamp when the comment should disappear
}

export class Danmaku {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
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
        this.canvas = document.createElement("canvas");
        this.ctx = this.canvas.getContext("2d")!;
        this.setupCanvas();
        this.videoPlayer.addEventListener('seeking', () => this.onSeek());
        this.start();

        const numLanes = Math.floor(this.canvas.height / Danmaku.LANE_HEIGHT);
        this.slidingLanes = new Array(numLanes).fill(0);
        this.topLanes = new Array(numLanes).fill(0);
        this.bottomLanes = new Array(numLanes).fill(0);
    }

    private setupCanvas() {
        const videoRect = this.videoPlayer.getBoundingClientRect();
        this.canvas.width = videoRect.width;
        this.canvas.height = videoRect.height;
        this.canvas.style.position = "absolute";
        this.canvas.style.top = `${this.videoPlayer.offsetTop}px`;
        this.canvas.style.left = `${this.videoPlayer.offsetLeft}px`;
        this.canvas.style.pointerEvents = "none";
        this.canvas.style.zIndex = "10";
        this.videoPlayer.parentElement?.appendChild(this.canvas);

        const resizeObserver = new ResizeObserver(() => this.onResize());
        resizeObserver.observe(this.videoPlayer);
    }

    private onResize() {
        const videoRect = this.videoPlayer.getBoundingClientRect();
        this.canvas.width = videoRect.width;
        this.canvas.height = videoRect.height;
        this.canvas.style.top = `${this.videoPlayer.offsetTop}px`;
        this.canvas.style.left = `${this.videoPlayer.offsetLeft}px`;

        const numLanes = Math.floor(this.canvas.height / Danmaku.LANE_HEIGHT);
        this.slidingLanes = new Array(numLanes).fill(0);
        this.topLanes = new Array(numLanes).fill(0);
        this.bottomLanes = new Array(numLanes).fill(0);
    }

    private onSeek() {
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

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
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
                }
            });

        } else {
            this.lastTimestamp = 0;
        }

        this.activeComments = this.activeComments.filter(comment => {
            if (comment.expiry <= currentTime) {
                return false; // Comment has expired
            }
            this.ctx.fillStyle = comment.color;
            this.ctx.font = `${Danmaku.FONT_SIZE}px Arial`;
            this.ctx.fillText(comment.content, comment.x, comment.y);
            return true;
        });

        requestAnimationFrame(this.renderLoop);
    };

    public addDanmaku(comment: Comment) {
        this.ctx.font = `${Danmaku.FONT_SIZE}px Arial`;
        const width = this.ctx.measureText(comment.content).width;
        const currentTime = this.videoPlayer.currentTime;

        let lane = -1;
        let y = 0;
        let x = 0;
        let speed = 0;

        if (comment.scrollMode === 'slide') {
            speed = (this.canvas.width + width) / Danmaku.DURATION;
            const timeToClear = (width / speed);

            for (let i = 0; i < this.slidingLanes.length; i++) {
                if (this.slidingLanes[i] <= currentTime) {
                    lane = i;
                    this.slidingLanes[i] = currentTime + timeToClear;
                    break;
                }
            }
            if (lane === -1) return; // No available lane

            x = this.canvas.width;
            y = (lane * Danmaku.LANE_HEIGHT) + (Danmaku.LANE_HEIGHT / 2) + (Danmaku.FONT_SIZE / 2);

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

            x = (this.canvas.width - width) / 2;
            if (comment.scrollMode === 'top') {
                y = (lane * Danmaku.LANE_HEIGHT) + (Danmaku.LANE_HEIGHT / 2) + (Danmaku.FONT_SIZE / 2);
            } else { // bottom
                y = this.canvas.height - (lane * Danmaku.LANE_HEIGHT) - (Danmaku.LANE_HEIGHT / 2) + (Danmaku.FONT_SIZE / 2);
            }
        }

        const danmaku: DanmakuComment = {
            ...comment,
            x: x,
            y: y,
            speed: speed,
            width: width,
            lane: lane,
            expiry: currentTime + Danmaku.DURATION,
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
    }
}
