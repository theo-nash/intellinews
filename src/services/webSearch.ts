import {
    Service,
    type IAgentRuntime,
    ServiceType,
    elizaLogger
} from "@elizaos/core";
import { tavily } from "@tavily/core";

export interface IWebSearchService extends Service {
    search(
        query: string,
        options?: SearchOptions,
    ): Promise<SearchResponse>;
}

export type SearchResult = {
    title: string;
    url: string;
    content: string;
    rawContent?: string;
    score: number;
    publishedDate?: string;
    source?: string;
};

export type SearchImage = {
    url: string;
    description?: string;
};

export type SearchResponse = {
    answer?: string;
    query: string;
    responseTime: number;
    images: SearchImage[];
    results: SearchResult[];
};

export interface SearchOptions {
    limit?: number;
    type?: "news" | "general";
    includeAnswer?: boolean;
    searchDepth?: "basic" | "advanced";
    includeImages?: boolean;
    days?: number; // 1 means current day, 2 means last 2 days
}

export type TavilyClient = ReturnType<typeof tavily>; // declaring manually because original package does not export its types

export class WebSearchService extends Service implements IWebSearchService {
    public tavilyClient: TavilyClient;
    private runtime: IAgentRuntime;
    private initialized: boolean = false;

    async initialize(_runtime: IAgentRuntime): Promise<void> {
        if (this.initialized) return;

        this.runtime = _runtime;

        const apiKey = _runtime.getSetting("TAVILY_API_KEY") as string;
        if (!apiKey) {
            throw new Error("TAVILY_API_KEY is not set");
        }
        this.tavilyClient = tavily({ apiKey });
        this.initialized = true;
        elizaLogger.info("WebSearchService initialized successfully");
    }

    getInstance(): IWebSearchService {
        return WebSearchService.getInstance();
    }

    static get serviceType(): ServiceType {
        return "news-search" as ServiceType;
    }

    get serviceType(): ServiceType {
        return WebSearchService.serviceType;
    }

    async search(
        query: string,
        options?: SearchOptions,
    ): Promise<SearchResponse> {
        try {
            elizaLogger.debug(`[WebSearchService] Searching for: "${query}" with options: ${JSON.stringify(options)}`);

            // Configure search parameters based on Tavily API docs
            const searchParams = {
                search_depth: options.searchDepth || "basic",
                include_answer: options.includeAnswer ?? true,
                max_results: options.limit ?? 5, // Using max_results per the docs
                topic: options.type || "news",
                include_raw_content: true,
                include_images: options.includeImages ?? false,
                include_image_descriptions: options.includeImages ?? false,
                days: options.days ?? 3
            };

            const response = await this.tavilyClient.search(query, searchParams);

            elizaLogger.debug(`[WebSearchService] Search returned ${response.results?.length || 0} results`);
            return response;
        } catch (error) {
            elizaLogger.error("[WebSearchService] Web search error:", error);
            throw error;
        }
    }
}