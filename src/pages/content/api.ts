import packageJson from "../../../package.json";
import { FontSize, ScrollMode } from "./interfaces/enum";
import { RawComment } from "./interfaces/danmaku";

const API_BASE_URL = packageJson.API_BASE_URL;

// Define proper user type instead of using any
export interface User {
    id: number;
    email: string;
    username: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface Comment {
    id: number;
    content: string;
    time: number;
    color: string;
    userId: number;
    scrollMode: ScrollMode;
    fontSize: FontSize;
    likes?: number;
}

export interface LoginRequest {
    emailOrUsername: string;
    password: string;
    rememberMe?: boolean;
}

export interface SignupRequest {
    email: string;
    username: string;
    password: string;
}

export interface AuthResponse {
    success: boolean;
    token?: string;
    error?: string;
    message?: string;
    user?: User;
    status?: number;
}

export interface ReportRequest {
    commentId: number;
    reason: string;
    additionalDetails?: string;
}

// Base response interface
export interface BaseResponse {
    success: boolean;
    error?: string;
    message?: string;
}

// Extended response interfaces
export interface PostCommentResponse extends BaseResponse {
    status?: number;
}

export interface CommentLikesResponse extends BaseResponse {
    likes?: number;
    dislikes?: number;
}

/**
 * Maps API raw comment to internal RawComment.
 */
function mapApiToRaw(apiComment: any): RawComment {
    return {
        id: apiComment.id,
        content: apiComment.content,
        time: apiComment.time, // ms as per JSON
        color: apiComment.color,
        userId: parseInt(apiComment.user_id),
        scrollMode: apiComment.scroll_mode as ScrollMode,
        fontSize: apiComment.font_size as FontSize,
        likes: parseInt(apiComment.like_score || '0'),
    };
}

/**
 * Fetches raw comments from getComments API and plans them client-side into a DisplayPlan.
 */
export async function getComments(platform: string, videoId: string, limit: number, bucketSize: number, maxCommentsPerBucket: number): Promise<RawComment[] | null> {
    try {
        console.log("getDisplayPlan called with:", { platform, videoId });
        const url = `${API_BASE_URL}/getComments?platform=${platform}&videoId=${videoId}&limit=${limit}&bucketSize=${bucketSize}&maxCommentsPerBucket=${maxCommentsPerBucket}`;
        console.log("Fetching from URL:", url);
        const response = await fetch(url);
        console.log("Response status:", response.status, "ok:", response.ok);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data: { success: boolean; comments: any[]; source?: string; } = await response.json();
        console.log("Response data:", data);

        if (data.success && Array.isArray(data.comments) && data.comments.length > 0) {
            const rawComments: RawComment[] = data.comments.map(mapApiToRaw);
            console.log("Mapped raw comments:", rawComments.length);
            // const plannedComments = planRawComments(rawComments);
            // console.log("Planned comments:", plannedComments.length);
            return rawComments;
        }
        console.log("No comments or invalid format, returning empty plan");
        return null;
    } catch (error) {
        console.error("Failed to fetch and plan display:", error);
        console.debug("Failed to fetch and plan display:", { platform, videoId });
        console.debug(window.location.href);
        return null;
    }
}


export async function postComment(
    platform: string,
    videoId: string,
    time: number,
    content: string,
    color: string,
    scrollMode: ScrollMode,
    fontSize: FontSize
): Promise<PostCommentResponse> {
    try {
        const token = await new Promise<string | null>((resolve) => {
            chrome.storage.local.get("authToken", (result) => {
                resolve(result.authToken || null);
            });
        });

        if (!token) {
            return { success: false, error: "You must be logged in to comment." };
        }

        const url = `${API_BASE_URL}/addComment`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                platform,
                videoId,
                time: Math.round(time),
                text: content,
                color,
                scrollMode,
                fontSize,
            }),
        });
        const data = await response.json();
        if (!response.ok) {
            if (response.status === 401) {
                chrome.storage.local.remove("authToken");
            }
            return { success: false, error: data.error || `HTTP error!`, status: response.status };
        }
        return { success: data.success };
    } catch (error) {
        console.error("Failed to post comment:", error);
        if (error instanceof Error) {
            return { success: false, error: error.message };
        }
        return { success: false, error: "An unknown error occurred." };
    }
}

export async function login(loginData: LoginRequest): Promise<AuthResponse> {
    try {
        const response = await fetch(`${API_BASE_URL}/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(loginData),
        });

        const data = await response.json();

        if (response.ok) {
            return {
                success: true,
                token: data.token,
                user: data.user,
            };
        } else {
            return {
                success: false,
                error: data.error || "Login failed",
                status: response.status,
            };
        }
    } catch (error) {
        console.error("Login network error:", error);
        return {
            success: false,
            error: "Network error. Please try again.",
        };
    }
}

export async function signup(signupData: SignupRequest): Promise<AuthResponse> {
    try {
        const response = await fetch(`${API_BASE_URL}/signup`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(signupData),
        });

        const data = await response.json();

        if (response.ok) {
            return {
                success: true,
                message: data.message,
                user: data.user,
            };
        } else {
            return {
                success: false,
                error: data.error || "Signup failed",
                status: response.status,
            };
        }
    } catch (error) {
        console.error("Signup network error:", error);
        return {
            success: false,
            error: "Network error. Please try again.",
        };
    }
}

export async function reportComment(
    commentId: number,
    reason: string,
    additionalDetails?: string
): Promise<boolean> {
    try {
        const token = await new Promise<string | null>((resolve) => {
            chrome.storage.local.get("authToken", (result) => {
                resolve(result.authToken || null);
            });
        });

        if (!token) {
            console.error("No auth token found. Please login.");
            return false;
        }

        const url = `${API_BASE_URL}/reportComment`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                commentId,
                reason,
                additionalDetails: additionalDetails || "",
            }),
        });

        if (!response.ok) {
            if (response.status === 401) {
                console.error("Authentication failed. Please login again.");
                chrome.storage.local.remove("authToken");
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.success;
    } catch (error) {
        console.error("Failed to report comment:", error);
        return false;
    }
}

export async function likeComment(commentId: number, isLike: boolean): Promise<BaseResponse> {
    try {
        const token = await new Promise<string | null>((resolve) => {
            chrome.storage.local.get("authToken", (result) => {
                resolve(result.authToken || null);
            });
        });

        if (!token) {
            return { success: false, error: "You must be logged in to like comments." };
        }

        const url = `${API_BASE_URL}/likeComment`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                commentId,
                isLike,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            if (response.status === 401) {
                chrome.storage.local.remove("authToken");
                return { success: false, error: "Authentication failed. Please login again." };
            }
            return { success: false, error: data.error || `HTTP error! status: ${response.status}` };
        }

        return { success: data.success };
    } catch (error) {
        console.error("Failed to like comment:", error);
        if (error instanceof Error) {
            return { success: false, error: error.message };
        }
        return { success: false, error: "An unknown error occurred." };
    }
}

export async function removeLike(commentId: number): Promise<BaseResponse> {
    try {
        const token = await new Promise<string | null>((resolve) => {
            chrome.storage.local.get("authToken", (result) => {
                resolve(result.authToken || null);
            });
        });

        if (!token) {
            return { success: false, error: "You must be logged in to remove likes." };
        }

        const url = `${API_BASE_URL}/removeLike`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                commentId,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            if (response.status === 401) {
                chrome.storage.local.remove("authToken");
                return { success: false, error: "Authentication failed. Please login again." };
            }
            return { success: false, error: data.error || `HTTP error! status: ${response.status}` };
        }

        return { success: data.success };
    } catch (error) {
        console.error("Failed to remove like:", error);
        if (error instanceof Error) {
            return { success: false, error: error.message };
        }
        return { success: false, error: "An unknown error occurred." };
    }
}

export async function deleteComment(commentId: number): Promise<BaseResponse> {
    try {
        const token = await new Promise<string | null>((resolve) => {
            chrome.storage.local.get("authToken", (result) => {
                resolve(result.authToken || null);
            });
        });

        if (!token) {
            return { success: false, error: "You must be logged in to delete comments." };
        }

        const url = `${API_BASE_URL}/deleteComment`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                commentId,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            if (response.status === 401) {
                chrome.storage.local.remove("authToken");
                return { success: false, error: "Authentication failed. Please login again." };
            }
            return { success: false, error: data.error || `HTTP error! status: ${response.status}` };
        }

        return { success: data.success };
    } catch (error) {
        console.error("Failed to delete comment:", error);
        if (error instanceof Error) {
            return { success: false, error: error.message };
        }
        return { success: false, error: "An unknown error occurred." };
    }
}

export async function getCommentLikes(commentId: number): Promise<CommentLikesResponse> {
    try {
        const url = `${API_BASE_URL}/commentLikes/${commentId}`;
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        });

        const data = await response.json();

        if (!response.ok) {
            return { success: false, error: data.error || `HTTP error! status: ${response.status}` };
        }

        return { 
            success: data.success,
            likes: data.likes,
            dislikes: data.dislikes
        };
    } catch (error) {
        console.error("Failed to get comment likes:", error);
        if (error instanceof Error) {
            return { success: false, error: error.message };
        }
        return { success: false, error: "An unknown error occurred." };
    }
}

// Authentication utilities
export async function isLoggedIn(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        chrome.storage.local.get("authToken", (result) => {
            resolve(!!result.authToken);
        });
    });
}

export async function logout(): Promise<void> {
    return new Promise<void>((resolve) => {
        chrome.storage.local.remove("authToken", () => {
            resolve();
        });
    });
}

export async function getAuthToken(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
        chrome.storage.local.get("authToken", (result) => {
            resolve(result.authToken || null);
        });
    });
}
