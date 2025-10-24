import { ScrollMode, FontSize } from "./enum";

/**
 * Represents a raw comment structure, as it would be stored in your database.
 * The backend will use this, along with other data like 'likes', to generate the plan.
 */
export interface RawComment {
    id: number;
    content: string;
    time: number;
    color: string;
    userId: number;
    scrollMode: ScrollMode;
    fontSize: FontSize;
    likes?: number;
}

// Message from main page to iframe with page status
export interface PageStatusMessage {
  type: 'PAGE_STATUS';
  videoId: string | null;
  isVideoPage: boolean;
  timestamp: number;
}

// Message from iframe to main page indicating readiness
export interface IframeReadyMessage {
  type: 'IFRAME_READY';
  timestamp: number;
}

// Message from iframe to main page with danmaku status
export interface DanmakuStatusMessage {
  type: 'DANMAKU_STATUS';
  commentsEnabled: boolean;
  commentsCount: number;
  timestamp: number;
}

// Message from main page to iframe to add a new comment
export interface AddCommentMessage {
  type: 'ADD_COMMENT';
  comment: RawComment;
  timestamp: number;
}

// Message from main page to iframe to toggle visibility
export interface ToggleVisibilityMessage {
  type: 'TOGGLE_VISIBILITY';
  force?: boolean;
  timestamp: number;
}

// Message from main page to iframe to request current time
export interface GetCurrentTimeMessage {
  type: 'GET_CURRENT_TIME';
  requestId: number;
  timestamp: number;
}

// Message from iframe to main page with current time response
export interface CurrentTimeResponseMessage {
  type: 'CURRENT_TIME_RESPONSE';
  requestId: number;
  currentTime: number;
  timestamp: number;
}
