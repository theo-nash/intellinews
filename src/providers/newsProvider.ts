import { Provider, IAgentRuntime, Memory, State, elizaLogger } from "@elizaos/core";
import { NewsMemoryService } from "../services/newsMemoryService";

export const newsProvider: Provider = {
    get: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
        try {
            // Get the news memory service
            const newsService = runtime.getService<NewsMemoryService>(NewsMemoryService.serviceType);
            if (!newsService) {
                elizaLogger.warn("[NewsProvider] News memory service not found");
                return "";
            }

            // Get recent news
            const recentNews = await newsService.searchNews({
                limit: 5,
                // Get news from the last 24 hours
                fromDate: new Date(Date.now() - 24 * 60 * 60 * 1000)
            });

            if (recentNews.length === 0) {
                return ""; // No recent news to provide
            }

            // Format recent news as context
            const formattedNews = recentNews.map(item => {
                const metadata = item.content.metadata || {};
                const date = new Date(metadata.publishedAt as number);
                return `[${getRelativeTimeString(date)}] ${metadata.title as string} (${metadata.source as string})`;
            }).join("\n");

            return `# Recent News\n${formattedNews}`;
        } catch (error) {
            elizaLogger.warn("[NewsProvider] Error in news provider:", error);
            return "";
        }
    }
};

function getRelativeTimeString(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffHours < 1) {
        return "Just now";
    } else if (diffHours < 24) {
        return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else {
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }
}