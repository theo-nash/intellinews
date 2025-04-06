import { Provider, IAgentRuntime, Memory, State, elizaLogger } from "@elizaos/core";
import { NewsMemoryService } from "../services/newsMemoryService";

export const newsContextProvider: Provider = {
    get: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
        try {
            // If the message doesn't have content, we can't provide context
            if (!message.content?.text) {
                return "";
            }

            // Get the news memory service
            const newsService = runtime.getService<NewsMemoryService>(NewsMemoryService.serviceType);
            if (!newsService) {
                elizaLogger.warn("[NewsContextProvider] News memory service not found");
                return "";
            }

            // Use the message content to find relevant news
            const relevantNews = await newsService.searchNews({
                query: message.content.text,
                limit: 3
            });

            if (relevantNews.length === 0) {
                return ""; // No relevant news found
            }

            // Format relevant news as context
            const formattedNews = relevantNews.map(item => {
                const metadata = item.content.metadata || {};
                const dateStr = new Date(metadata.publishedAt as number).toLocaleDateString();
                return `[${dateStr}] ${metadata.title as string}\nSource: ${metadata.source as string}`;
            }).join("\n\n");

            return `# Relevant News Context\n${formattedNews}`;
        } catch (error) {
            elizaLogger.error("[NewsContextProvider] Error in news context provider:", error);
            return "";
        }
    }
};