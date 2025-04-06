import {
    IAgentRuntime,
    RAGKnowledgeManager,
    RAGKnowledgeItem,
    UUID,
    elizaLogger
} from "@elizaos/core";
import { stringToUuid } from "@elizaos/core";
import { NewsItem, NewsSearchOptions } from "../types";
import { NEWS_KNOWLEDGE_NAME } from "../environment";

/**
 * Specialized knowledge manager for news items
 * Uses RAGKnowledgeManager but with a dedicated table and news-specific handling
 */
export class NewsKnowledgeManager {
    private ragKnowledgeManager: RAGKnowledgeManager;
    private runtime: IAgentRuntime;
    private newsCache: Map<string, {
        timestamp: number,
        results: RAGKnowledgeItem[]
    }> = new Map();

    private CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;

        // Create a dedicated RAGKnowledgeManager with a news-specific table
        this.ragKnowledgeManager = new RAGKnowledgeManager({
            tableName: NEWS_KNOWLEDGE_NAME,
            runtime: runtime,
            knowledgeRoot: "data/knowledge" // May need adjustment based on ElizaOS setup
        });

        // Initialize the cache
        this.newsCache = new Map();
    }

    /**
     * Store a news item in the specialized knowledge store
     */
    async storeNewsItem(newsItem: NewsItem, type?: string): Promise<RAGKnowledgeItem | null> {
        try {
            // Generate a stable ID based on URL or content hash to avoid duplicates
            const idBase = newsItem.url || `${newsItem.title}-${newsItem.source}`;
            const id = stringToUuid(idBase) as UUID;

            // Create properly formatted knowledge item
            const knowledgeItem: RAGKnowledgeItem = {
                id,
                agentId: this.runtime.agentId,
                content: {
                    text: `${newsItem.title}\n\n${newsItem.content}`,
                    metadata: {
                        title: newsItem.title,
                        source: newsItem.source,
                        url: newsItem.url,
                        publishedAt: newsItem.publishedAt.getTime(),
                        type: type || "news",
                        topics: newsItem.topics,
                        // Required fields for RAGKnowledgeItem
                        isMain: true,
                        isShared: false
                    }
                },
                createdAt: Date.now()
            };

            // Store the item
            await this.ragKnowledgeManager.createKnowledge(knowledgeItem);
            return knowledgeItem;
        } catch (error) {
            elizaLogger.error("Error storing news item:", error);
            return null;
        }
    }

    /**
     * Check if a very similar news item already exists to avoid duplicates
     */
    async checkForDuplicate(newsItem: NewsItem): Promise<boolean> {
        try {
            // Try to find by URL first (exact match)
            if (newsItem.url) {
                const results = await this.searchNewsByMetadata({
                    key: "url",
                    value: newsItem.url
                });

                if (results.length > 0) {
                    return true;
                }
            }

            // Then try by title (semantic search)
            const results = await this.ragKnowledgeManager.getKnowledge({
                query: newsItem.title,
                limit: 5,
                agentId: this.runtime.agentId
            });

            // Check if any result is very similar by title
            return results.some(item => {
                const metadata = item.content.metadata || {};
                const itemTitle = metadata.title as string || "";

                // Simple fuzzy matching - either exact match or very high similarity
                return itemTitle.toLowerCase() === newsItem.title.toLowerCase() ||
                    (item.similarity && item.similarity > 0.95);
            });
        } catch (error) {
            elizaLogger.error("Error checking for duplicates:", error);
            return false; // If error, assume not duplicate to be safe
        }
    }

    /**
     * Generate a cache key based on search options
     */
    private generateCacheKey(options: NewsSearchOptions): string {
        const { query, fromDate, toDate, sources, topics } = options;
        return JSON.stringify({
            query,
            fromDate: fromDate?.toISOString(),
            toDate: toDate?.toISOString(),
            sources,
            topics
        });
    }

    async getCachedNews(options: NewsSearchOptions): Promise<RAGKnowledgeItem[] | null> {
        const cacheKey = this.generateCacheKey(options);
        const cachedItem = this.newsCache.get(cacheKey);

        if (cachedItem && (Date.now() - cachedItem.timestamp) < this.CACHE_TTL) {
            return cachedItem.results;
        }

        return null;
    }

    setCachedNews(options: NewsSearchOptions, results: RAGKnowledgeItem[]): void {
        const cacheKey = this.generateCacheKey(options);
        this.newsCache.set(cacheKey, {
            timestamp: Date.now(),
            results
        });

        // Clean expired cache items
        this.cleanExpiredCache();
    }

    private cleanExpiredCache(): void {
        const now = Date.now();
        for (const [key, item] of this.newsCache.entries()) {
            if ((now - item.timestamp) > this.CACHE_TTL) {
                this.newsCache.delete(key);
            }
        }
    }

    /**
     * Search for news items by query
     */
    async searchNews(options: NewsSearchOptions = {}): Promise<RAGKnowledgeItem[]> {
        try {
            const cachedNews = await this.getCachedNews(options);

            if (cachedNews) {
                elizaLogger.debug("Returning cached news results");
                return cachedNews;
            }

            const desiredCount = options.limit || 10;

            // Get all news if no query or context
            if (!options.query && !options.conversationContext) {
                elizaLogger.debug("No query or context provided, returning all news");
                const allItems = await this.ragKnowledgeManager.listAllKnowledge(this.runtime.agentId);

                const results = this.filterNewsResults(allItems, options);

                const _r = results
                    .sort((a, b) => {
                        const dateA = a.content.metadata?.publishedAt as number || 0;
                        const dateB = b.content.metadata?.publishedAt as number || 0;
                        return dateB - dateA; // Newest first
                    }).slice(0, desiredCount);
                this.setCachedNews(options, _r); // Cache the results
                return _r;
            }

            const complexity = this.estimateFilterComplexity(options);
            const adjustedCount = desiredCount * complexity;

            // Get a batch of knowledge items
            const result = await this.ragKnowledgeManager.getKnowledge({
                query: options.query || "",
                limit: adjustedCount,
                agentId: this.runtime.agentId,
                conversationContext: options.conversationContext
            });

            // If no results, end
            if (result.length === 0) {
                elizaLogger.debug("No more results found");
                return [];
            };

            // Filter this batch
            const matchingResults = this.filterNewsResults(result, options);

            // If insufficient results, try again with a larger batch
            if (matchingResults.length < desiredCount) {
                elizaLogger.debug(`[NewsKnowledgeManager] Insufficient results (${matchingResults.length}), trying again with a larger batch`);
                const largerBatch = await this.ragKnowledgeManager.getKnowledge({
                    query: options.query || "",
                    limit: adjustedCount * 10,
                    agentId: this.runtime.agentId,
                    conversationContext: options.conversationContext
                });

                const largerResults = this.filterNewsResults(largerBatch, options);
                matchingResults.push(...largerResults);
            }

            elizaLogger.info(`[NewsKnowledgeManager] Found ${matchingResults.length} matching news items out of ${desiredCount} requested`);

            // Return only the requested number, sorted by recency
            const _r = matchingResults
                .sort((a, b) => {
                    const dateA = a.content.metadata?.publishedAt as number || 0;
                    const dateB = b.content.metadata?.publishedAt as number || 0;
                    return dateB - dateA; // Newest first
                })
                .slice(0, desiredCount);

            this.setCachedNews(options, _r); // Cache the results


            return _r
        } catch (error) {
            elizaLogger.error("Error in paginated news search:", error);
            return [];
        }
    }

    private estimateFilterComplexity(options: NewsSearchOptions): number {
        let complexity = 1; // Base multiplier

        // More specific date ranges mean fewer results
        if (options.fromDate && options.toDate) {
            const daysBetween = (options.toDate.getTime() - options.fromDate.getTime()) / (1000 * 60 * 60 * 24);
            if (daysBetween < 7) complexity += 5;
            else if (daysBetween < 30) complexity += 4;
            else complexity += 3;
        } else if (options.fromDate || options.toDate) {
            complexity += 2;
        }

        // Topic and source filters add complexity
        if (options.topics && options.topics.length > 0) complexity += 1;
        if (options.sources && options.sources.length > 0) complexity += 1;

        return complexity;
    }

    /**
     * Search news by specific metadata field
     */
    async searchNewsByMetadata(
        filter: { key: string; value: any },
        limit: number = 10
    ): Promise<RAGKnowledgeItem[]> {
        try {
            // Use RAGKnowledgeManager to get all knowledge (limited by the tableName)
            const results = await this.ragKnowledgeManager.getKnowledge({
                limit: limit * 10, // Get more results to filter from
                agentId: this.runtime.agentId
            });

            // Filter by metadata field
            return results.filter(item => {
                const metadata = item.content.metadata || {};
                return metadata[filter.key] === filter.value;
            }).slice(0, limit);
        } catch (error) {
            elizaLogger.error(`[NewsKnowledgeManager] Error searching news by ${filter.key}:`, error);
            return [];
        }
    }

    /**
     * Filter news results based on search options
     */
    private filterNewsResults(
        results: RAGKnowledgeItem[],
        options: NewsSearchOptions
    ): RAGKnowledgeItem[] {
        return results.filter(item => {
            try {
                const metadata = item.content.metadata || {};

                // Only include news items
                if (metadata.type !== "news") return false;

                // Filter by date with proper type checking
                const publishedAt = metadata.publishedAt as number;
                if (options.fromDate && typeof publishedAt === 'number') {
                    if (publishedAt < options.fromDate.getTime()) return false;
                }

                if (options.toDate && typeof publishedAt === 'number') {
                    if (publishedAt > options.toDate.getTime()) return false;
                }

                // Filter by source with type safety
                if (options.sources && options.sources.length > 0) {
                    const source = metadata.source as string;
                    if (!source || !options.sources.includes(source)) return false;
                }

                // Filter by topic with type safety
                if (options.topics && options.topics.length > 0) {
                    const topics = metadata.topics as string[] || [];
                    if (!topics.length || !topics.some(topic => options.topics.includes(topic))) {
                        return false;
                    }
                }

                return true;
            } catch (error) {
                // Log but don't crash if there's an issue with a specific item
                elizaLogger.warn(`[NewsKnowledgeManager] Error filtering news item: ${error}`);
                return false;
            }
        });
    }

    /**
     * Delete news items older than the retention period
     */
    async purgeOldNews(retentionDays: number): Promise<number> {
        try {
            // Calculate cutoff date
            const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

            // Get all knowledge (limited by the tableName)
            const allItems = await this.ragKnowledgeManager.getKnowledge({
                limit: 1000, // We might need pagination for very large collections
                agentId: this.runtime.agentId
            });

            // Find expired items with proper type checking
            const expiredItems = allItems.filter(item => {
                const metadata = item.content.metadata || {};
                const publishedAt = metadata.publishedAt as number;
                return (
                    metadata.type === "news" &&
                    typeof publishedAt === 'number' &&
                    publishedAt < cutoffTime
                );
            });

            // Delete each expired item
            let deletedCount = 0;
            for (const item of expiredItems) {
                await this.ragKnowledgeManager.removeKnowledge(item.id);
                deletedCount++;
            }

            elizaLogger.info(`[NewsKnowledgeManager] Purged ${deletedCount} expired news items`);
            return deletedCount;
        } catch (error) {
            elizaLogger.error("Error purging old news:", error);
            return 0;
        }
    }
}