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
    user?: any;
    status?: number;
}

export async function getComments(platform: string, videoId: string, commentLimit: number): Promise<Comment[]> {
    try {
        const url = `${API_BASE_URL}/getComments?platform=${platform}&videoId=${videoId}&limit=${commentLimit}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (data.success && Array.isArray(data.comments)) {
            return data.comments;
        }
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
                chrome.storage.local.remove("authToken");
            }
            throw new Error(`HTTP error! status: ${response.status}`);
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