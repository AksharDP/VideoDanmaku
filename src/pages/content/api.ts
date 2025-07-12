import packageJson from "../../../package.json";

const API_BASE_URL = packageJson.API_BASE_URL;

export interface Comment {
    id: number;
    content: string;
    time: number;
    color: string;
    userId: number;
    scrollMode: "slide" | "top" | "bottom";
    fontSize: "small" | "normal" | "large";
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
    status?: number;
}

// export interface ReportRequest {
//     commentId: number;
//     reason: string;
//     additionalDetails?: string;
// }
//
// export interface ReportResponse {
//     success: boolean;
//     error?: string;
//     message?: string;
// }

export async function getComments(platform: string, videoId: string, commentLimit: number): Promise<Comment[]> {
    try {
        console.log("getComments called with:", {platform, videoId, commentLimit});
        const url = `${API_BASE_URL}/getComments?platform=${platform}&videoId=${videoId}&limit=${commentLimit}`;
        console.log("Fetching from URL:", url);
        const response = await fetch(url);
        console.log("Response status:", response.status, "ok:", response.ok);
        if (!response.ok) {
            console.error(Error(`HTTP error! status: ${response.status}`));
            return [];
        }
        const data = await response.json();
        console.log("Response data:", data);
        if (data.success && Array.isArray(data.comments)) {
            console.log("Returning comments:", data.comments.length);
            return data.comments;
        }
        console.log("No comments found or invalid response format");
        return [];
    } catch (error) {
        console.error("Failed to fetch comments:", error);
        return [];
    }
}

export async function postComment(
    platform: string,
    videoId: string,
    time: number,
    content: string,
    color: string,
    scrollMode: "slide" | "top" | "bottom",
    fontSize: "small" | "normal" | "large"
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
        if (!response.ok) {
            if (response.status === 401) {
                console.error("Authentication failed. Please login again.");
                // Optionally remove invalid token
                await chrome.storage.local.remove("authToken");
            }
            console.error("Authentication failed. " + await response.json());
            return false;
            // throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data.success;
    } catch (error) {
        console.error("Failed to post comment:", error);
        return false;
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
                await chrome.storage.local.remove("authToken");
            }
            console.error("Authentication failed. " + await response.json());
            // throw new Error(`HTTP error! status: ${response.status}`);
            return false;
        }

        const data = await response.json();
        return data.success;
    } catch (error) {
        console.error("Failed to report comment:", error);
        return false;
    }
}