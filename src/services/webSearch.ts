import {
    Service,
    type IAgentRuntime,
    ServiceType,
    elizaLogger,
    CacheManager
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

    // Default TTL for search results (in seconds)
    private static readonly DEFAULT_TTL = 1800; // 30 minutes

    // Shorter TTL for news-related searches (in seconds)
    private static readonly NEWS_TTL = 900; // 15 minutes

    // Maximum age for cached results with days=1 (very recent) in seconds
    private static readonly RECENT_NEWS_TTL = 300; // 5 minutes

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

    // Generate a deterministic cache key based on search parameters
    private generateCacheKey(query: string, searchParams: any): string {
        // Create a deterministic string representation of search parameters
        // Sort keys to ensure consistent order regardless of how options were provided
        const paramString = JSON.stringify(
            searchParams,
            Object.keys(searchParams).sort()
        );

        // Create a key with a prefix for namespacing
        return `websearch:${query}:${paramString}`;
    }

    // Determine appropriate TTL based on search parameters
    private determineTTL(searchParams: any): number {
        // Very recent news searches get shortest TTL
        if (searchParams.topic === 'news' && searchParams.days <= 1) {
            return WebSearchService.RECENT_NEWS_TTL;
        }

        // News searches get shorter TTL
        if (searchParams.topic === 'news') {
            return WebSearchService.NEWS_TTL;
        }

        // Default TTL for other searches (general searches, etc.)
        return WebSearchService.DEFAULT_TTL;
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

            // Generate cache key
            const cacheKey = this.generateCacheKey(query, searchParams);

            // Try to get from cache first
            if (this.runtime.cacheManager) {
                try {
                    const cachedResult = await this.runtime.cacheManager.get<SearchResponse>(cacheKey);
                    if (cachedResult) {
                        elizaLogger.debug(`[WebSearchService] Cache hit for: "${query}"`);
                        return cachedResult;
                    }
                } catch (cacheError) {
                    // Log cache error but continue with API call
                    elizaLogger.warn(`[WebSearchService] Cache retrieval error: ${cacheError.message}`);
                }
            }

            const response = await this.tavilyClient.search(query, searchParams);

            // Store in cache with appropriate TTL if cache is available
            if (this.runtime.cacheManager) {
                try {
                    const ttl = this.determineTTL(searchParams);
                    await this.runtime.cacheManager.set(cacheKey, response, { expires: Date.now() + ttl * 1e3 });
                    elizaLogger.debug(`[WebSearchService] Cached response for "${query}" with TTL: ${ttl}s`);
                } catch (cacheError) {
                    // Log cache error but still return the response
                    elizaLogger.warn(`[WebSearchService] Cache storage error: ${cacheError.message}`);
                }
            }

            elizaLogger.debug(`[WebSearchService] Search returned ${response.results?.length || 0} results`);
            return response;
        } catch (error) {
            elizaLogger.error("[WebSearchService] Web search error:", error);
            throw error;
        }
    }
}