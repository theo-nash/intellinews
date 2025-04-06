import { Action, IAgentRuntime, Memory, State, HandlerCallback, ActionExample, elizaLogger } from "@elizaos/core";
import { NewsMemoryService } from "../services/newsMemoryService";
import { DEFAULT_SEARCH_LIMIT } from "../environment";

export const searchNewsAction: Action = {
    name: "SEARCH_NEWS",
    similes: ["FIND_NEWS", "QUERY_NEWS", "NEWS_LOOKUP"],
    description: "Searches for news articles in agent's memory based on the user's query.",
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        // Validate that this message is a request to search news
        const text = message.content?.text?.toLowerCase() || "";
        return text.includes("search news") ||
            text.includes("find news") ||
            text.includes("news about");
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

            // Extract search query from message
            const text = message.content?.text?.toLowerCase() || "";
            let query = "";

            // Extract query patterns
            if (text.includes("news about")) {
                const match = text.match(/news about\s+([^.,?]+)/i);
                if (match && match[1]) {
                    query = match[1].trim();
                }
            } else if (text.includes("search news")) {
                const match = text.match(/search news\s+(?:for|about)?\s*([^.,?]+)/i);
                if (match && match[1]) {
                    query = match[1].trim();
                }
            }

            // If no specific query pattern matched, use the whole message as context
            if (!query) {
                query = text;
            }

            // Search for news
            const results = await newsService.searchNews({
                query,
                limit: DEFAULT_SEARCH_LIMIT
            });

            if (results.length === 0) {
                if (callback) {
                    callback({
                        text: "I don't have any relevant news in my memory. Would you like me to fetch some recent news updates?"
                    });
                }
                return true;
            }

            // Format results - more detailed than just titles
            const formattedResults = results.map(result => {
                const metadata = result.content.metadata || {};
                const title = metadata.title as string || "Untitled";
                const source = metadata.source as string || "Unknown source";
                const publishedAt = metadata.publishedAt ? new Date(metadata.publishedAt as number) : new Date();
                const url = metadata.url as string || "";

                // Extract a brief snippet from the content
                const content = result.content.text || "";
                const snippetLength = 150;
                const contentSnippet = content.length > snippetLength
                    ? content.slice(0, snippetLength) + "..."
                    : content;

                return `## ${title}\n**Source:** ${source} | **Published:** ${formatDate(publishedAt)}\n${url ? `**Link:** ${url}\n` : ""}\n${contentSnippet}`;
            }).join("\n\n");

            if (callback) {
                callback({
                    text: `Here's what I found about "${query}":\n\n${formattedResults}`
                });
            }

            return true;
        } catch (error) {
            elizaLogger.warn("Error searching news:", error);

            if (callback) {
                callback({
                    text: "I encountered an error while searching for news. Please try again later."
                });
            }

            return false;
        }
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: { text: "What news do you know about <searchTerm>" }
            },
            {
                user: "{{user2}}",
                content: { text: "", action: "SEARCH_NEWS" }
            }
        ],

        [
            {
                user: "{{user3}}",
                content: { text: "What do you remember about news on <searchTerm>" }
            },
            {
                user: "{{user4}}",
                content: { text: "", action: "SEARCH_NEWS" }
            }
        ],
    ] as ActionExample[][],
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