import {
    elizaLogger,
    type IAgentRuntime,
} from "@elizaos/core";
import { z, ZodError } from "zod";

export const DEFAULT_SEARCH_LIMIT = 10;
export const DEFAULT_FETCH_INTERVAL = 60; // minutes
export const DEFAULT_RETENTION_DAYS = 30;
export const NEWS_KNOWLEDGE_NAME = "news_knowledge";
export const DEFAULT_TOPICS = ["world news", "technology", "science"];

/**
 * This schema defines all required/optional environment settings,
 * including new fields like TWITTER_SPACES_ENABLE.
 */
export const newsEnvSchema = z.object({
    NEWS_FETCH_INTERVAL_MINUTES: z.number().int().default(DEFAULT_FETCH_INTERVAL),
    NEWS_TOPICS: z.array(z.string()),
    NEWS_RETENTION_DAYS: z.number().int().default(DEFAULT_RETENTION_DAYS),
    NEWS_SEARCH_LIMIT: z
        .number()
        .int()
        .default(DEFAULT_SEARCH_LIMIT)
});

export type NewsConfig = z.infer<typeof newsEnvSchema>;

/**
 * Helper to parse a comma-separated list of news topics
 * (updated to handle array of strings).
 */
function parseTopics(topicsStr?: string | null): string[] {
    if (!topicsStr?.trim()) {
        return [];
    }
    return topicsStr
        .split(",")
        .map((topic) => topic.trim())
        .filter(Boolean);
}

function safeParseInt(
    value: string | undefined | null,
    defaultValue: number
): number {
    if (!value) return defaultValue;
    const parsed = Number.parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : Math.max(1, parsed);
}

/**
 * Validates or constructs a TwitterConfig object using zod,
 * taking values from the IAgentRuntime or process.env as needed.
 */
// This also is organized to serve as a point of documentation for the client
// most of the inputs from the framework (env/character)

// we also do a lot of typing/parsing here
// so we can do it once and only once per character
export async function validateNewsConfig(
    runtime: IAgentRuntime
): Promise<NewsConfig> {
    try {
        const newsConfig = {
            // comma separated string
            NEWS_TOPICS: parseTopics(
                runtime.getSetting("NEWS_TOPICS") ||
                process.env.NEWS_TOPICS
            ),

            NEWS_RETENTION_DAYS: safeParseInt(
                runtime.getSetting("NEWS_RETENTION_DAYS") ||
                process.env.NEWS_RETENTION_DAYS,
                DEFAULT_RETENTION_DAYS
            ),
            NEWS_FETCH_INTERVAL_MINUTES: safeParseInt(
                runtime.getSetting("NEWS_FETCH_INTERVAL_MINUTES") ||
                process.env.NEWS_FETCH_INTERVAL_MINUTES,
                DEFAULT_FETCH_INTERVAL
            ),
            NEWS_SEARCH_LIMIT: safeParseInt(
                runtime.getSetting("NEWS_SEARCH_LIMIT") ||
                process.env.NEWS_SEARCH_LIMIT,
                DEFAULT_SEARCH_LIMIT
            ),
        };

        return newsEnvSchema.parse(newsConfig);
    } catch (error) {
        elizaLogger.error("News configuration validation failed:", error);
        // Return default config on error
        return {
            NEWS_TOPICS: DEFAULT_TOPICS,
            NEWS_RETENTION_DAYS: DEFAULT_RETENTION_DAYS,
            NEWS_FETCH_INTERVAL_MINUTES: DEFAULT_FETCH_INTERVAL,
            NEWS_SEARCH_LIMIT: DEFAULT_SEARCH_LIMIT
        };
    }
}
