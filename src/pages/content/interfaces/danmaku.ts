import { ScrollMode, FontSize } from "./enum";

/**
 * Represents a raw comment structure, as it would be stored in your database.
 * The backend will use this, along with other data like 'likes', to generate the plan.
 */
export interface RawComment {
    id: number;
    content: string;
    time: number; // The original timestamp in ms
    color: string;
    userId: number;
    scrollMode: ScrollMode;
    fontSize: FontSize;
    likes?: number; // Optional: for backend prioritization
}


/**
 * Represents a comment after it has been processed by the offline algorithm.
 * It contains all the necessary information for the client to render it without
 * any further calculation.
 */
export interface PlannedComment {
    id: number;
    content: string;
    time: number; // The exact, final emission timestamp (in ms) after temporal spreading
    color: string;
    userId: number;
    scrollMode: ScrollMode;
    fontSize: FontSize;

    // --- Pre-calculated layout properties ---
    lane: number;          // The vertical lane this comment will appear in
    duration: number;      // The time (in ms) it will take to cross the screen
    width: number;         // The pre-calculated width of the comment text in pixels
}

/**
 * The complete, pre-processed layout plan for a single video.
 * This is the data structure the client will fetch from the API.
 */
export interface DisplayPlan {
    comments: PlannedComment[];
    // // Optional metadata about the plan
    // metadata: {
    //     totalComments: number;
    //     culledComments: number; // Number of comments dropped due to density
    //     processingTime: number; // Time taken to generate the plan
    // };
}
