import { Action, IAgentRuntime, Memory, State, HandlerCallback, ActionExample, elizaLogger } from "@elizaos/core";
import { NewsMemoryService } from "../services/newsMemoryService";
import { validateNewsConfig } from "../environment";

export const fetchNewsAction: Action = {
    name: "FETCH_NEWS",
    description: "Fetches the latest news and updates the agent's knowledge base.",
    similes: ["GET_NEWS", "UPDATE_NEWS", "REFRESH_NEWS"],
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        // Validate that this message is a request to fetch news
        const text = message.content?.text?.toLowerCase() || "";
        return text.includes("fetch news") ||
            text.includes("get news") ||
            text.includes("update news");
    },
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        options: { [key: string]: unknown },
        callback?: HandlerCallback,
    ): Promise<boolean> => {
        try {
            // Get the news memory service
            const newsService = runtime.getService<NewsMemoryService>(NewsMemoryService.serviceType);
            if (!newsService) {
                elizaLogger.warn("News memory service not found");
                return false;
            }

            // Extract topic from message if specified
            const text = message.content?.text?.toLowerCase() || "";
            let topic = "";

            // Check for "about [topic]" pattern
            const aboutMatch = text.match(/about\s+([^.,]+)/i);
            if (aboutMatch && aboutMatch[1]) {
                topic = aboutMatch[1].trim();
            }

            // Initial callback to inform user we're fetching
            if (callback) {
                const fetchMessage = topic
                    ? `I'm fetching the latest news about ${topic}. This might take a moment...`
                    : "I'm fetching the latest news across all topics. This might take a moment...";

                callback({
                    text: fetchMessage
                });
            }

            // Fetch the news
            const fetchResult = topic
                ? await newsService.fetchNews(topic)
                : await newsService.fetchNews();

            // Format and display the results
            const allItems = fetchResult.allItems;

            if (allItems.length === 0) {
                if (callback) {
                    const noResultsMessage = topic
                        ? `I couldn't find any recent news about ${topic}.`
                        : "I couldn't find any recent news updates.";

                    callback({
                        text: noResultsMessage
                    });
                }
                return true;
            }

            // Format the news items for display - show the most recent first
            const sortedItems = [...allItems].sort((a, b) => {
                const dateA = a.content.metadata?.publishedAt as number || 0;
                const dateB = b.content.metadata?.publishedAt as number || 0;
                return dateB - dateA; // Descending order (newest first)
            });

            // Display a limited number (up to 5) of the most recent items
            const displayItems = sortedItems.slice(0, 5);

            const formattedNews = displayItems.map(item => {
                const metadata = item.content.metadata || {};
                const title = metadata.title as string || "Untitled";
                const source = metadata.source as string || "Unknown source";
                // Use a fallback date if publishedAt is not available or invalid
                const publishedAtValue = metadata.publishedAt as number;
                const publishedAt = typeof publishedAtValue === 'number' ? new Date(publishedAtValue) : new Date();
                const url = metadata.url as string || "";

                return `## ${title}\n**Source:** ${source} | **Published:** ${formatDate(publishedAt)}\n${url ? `**Link:** ${url}\n` : ""}`;
            }).join("\n\n");

            if (callback) {
                const successMessage = topic
                    ? `Here's the latest news I found about ${topic}:\n\n${formattedNews}\n\nI've added ${allItems.length} news items to my knowledge base.`
                    : `Here's the latest news I found:\n\n${formattedNews}\n\nI've added ${allItems.length} news items to my knowledge base.`;

                callback({
                    text: successMessage
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error("Error fetching news:", error);

            if (callback) {
                callback({
                    text: "I encountered an error while trying to fetch the latest news. Please try again later."
                });
            }

            return false;
        }
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: { text: "what's the latest news about AI?" },
            },
            {
                user: "{{user2}}",
                content: { text: "", action: "FETCH_NEWS" },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "can you update your knowledge with recent news?" },
            },
            {
                user: "{{user2}}",
                content: { text: "", action: "FETCH_NEWS" },
            },
        ],
    ]
};

// Helper function to format dates
function formatDate(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    if (diffMinutes < 60) {
        return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    }

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
        return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) {
        return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    }

    return date.toLocaleDateString();
}