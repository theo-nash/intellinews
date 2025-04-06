import { Plugin } from "@elizaos/core";
import { NewsMemoryService } from "./services/newsMemoryService";
import { fetchNewsAction } from "./actions/fetchNews";
import { searchNewsAction } from "./actions/searchNews";
import { newsProvider } from "./providers/newsProvider";
import { newsContextProvider } from "./providers/newsContextProvider";

// Main plugin export
const newsMemoryPlugin: Plugin = {
    name: "news-memory",
    description: "Fetches and retains memory about current events, news, and topical research",
    services: [new NewsMemoryService()],
    actions: [fetchNewsAction, searchNewsAction],
    providers: [newsProvider, newsContextProvider]
};

export default newsMemoryPlugin;
export { NewsMemoryService };