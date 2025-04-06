import { Service, IAgentRuntime, elizaLogger, ServiceType, RAGKnowledgeItem } from "@elizaos/core";
import { WebSearchService } from "./webSearch.ts";
import { NewsKnowledgeManager } from "../managers/newsKnowledgeManager.ts";
import { NewsItem, NewsSearchOptions, TopicConfig } from "../types.ts";
import { NewsConfig, validateNewsConfig, DEFAULT_FETCH_INTERVAL, DEFAULT_TOPICS, DEFAULT_RETENTION_DAYS } from "../environment.ts";

export class NewsMemoryService extends Service {
    capabilityDescription = "Enables the agent to fetch, store, and recall news and current events";

    static get serviceType(): ServiceType {
        return "news-memory" as ServiceType;
    }

    get serviceType(): ServiceType {
        return NewsMemoryService.serviceType;
    }

    private webSearchService: WebSearchService;
    private newsKnowledgeManager: NewsKnowledgeManager;
    private fetchIntervals: Map<string, NodeJS.Timeout> = new Map();
    private topics: TopicConfig[] = [];
    private runtime: IAgentRuntime;
    private initialized: boolean = false;

    private async initializeTopics() {
        try {
            const config = await validateNewsConfig(this.runtime);

            // Use topics from config or default
            const topicNames = config.NEWS_TOPICS.length > 0
                ? config.NEWS_TOPICS
                : DEFAULT_TOPICS;

            // Set fetch interval from config
            const defaultInterval = config.NEWS_FETCH_INTERVAL_MINUTES || DEFAULT_FETCH_INTERVAL;

            // Create topic configs
            this.topics = topicNames.map(name => ({
                name,
                interval: defaultInterval
            }));

            elizaLogger.info(`Initialized ${this.topics.length} news topics with ${defaultInterval} minute fetch interval`);
        } catch (error) {
            elizaLogger.error("[NewsMemoryService] Failed to initialize topics:", error);
            // Fallback to defaults
            this.topics = DEFAULT_TOPICS.map(name => ({
                name,
                interval: DEFAULT_FETCH_INTERVAL
            }));
        }
    }

    async initialize(runtime: IAgentRuntime): Promise<void> {
        if (this.initialized) return;

        this.runtime = runtime;

        // Initialize web search service
        this.webSearchService = new WebSearchService();
        await this.webSearchService.initialize(runtime);

        // Initialize news knowledge manager
        this.newsKnowledgeManager = new NewsKnowledgeManager(runtime);

        // Initialize topics
        await this.initializeTopics();

        // Start fetch intervals
        this.startFetchIntervals();

        // Schedule daily cleanup of old news
        this.scheduleNewsCleanup();

        // Immediately fetch news for each topic
        await this.fetchNews();

        this.initialized = true;
        elizaLogger.info("[NewsMemoryService] NewsMemoryService initialized successfully");
    }

    private startFetchIntervals() {
        // Clear any existing intervals
        this.stopFetchIntervals();

        // Set up new intervals for each topic
        for (const topic of this.topics) {
            const intervalId = setInterval(
                () => this.fetchNewsForTopic(topic.name),
                topic.interval * 60 * 1000
            );

            this.fetchIntervals.set(topic.name, intervalId);
            elizaLogger.log(`Scheduled news fetch for '${topic.name}' every ${topic.interval} minutes`);
        }
    }

    private stopFetchIntervals() {
        // Clear all fetch intervals
        for (const [_, intervalId] of this.fetchIntervals) {
            clearInterval(intervalId);
        }
        this.fetchIntervals.clear();
    }

    private scheduleNewsCleanup() {
        // Run once a day
        const ONE_DAY = 24 * 60 * 60 * 1000;
        setInterval(() => this.purgeOldNews(), ONE_DAY);
    }

    async stop() {
        this.stopFetchIntervals();
    }

    async fetchNews(topic?: string | string[]): Promise<{ byTopic: Record<string, RAGKnowledgeItem[]>; allItems: RAGKnowledgeItem[] }> {
        try {
            if (!topic) {
                const topics = this.topics.map(t => t.name);
                elizaLogger.log("[NewsMemoryService] Fetching news for all topics");

                const results = await Promise.all(
                    topics.map(async (singleTopic) => {
                        try {
                            const items = await this.fetchNewsForTopic(singleTopic);
                            return {
                                topic: singleTopic,
                                items: items,
                                success: true
                            };
                        } catch (error) {
                            elizaLogger.error(`Error fetching news for topic ${singleTopic}:`, error);
                            return {
                                topic: singleTopic,
                                items: [],
                                success: false
                            };
                        }
                    })
                );

                // Convert array of results to an object mapping topics to items
                const resultsByTopic = results.reduce((acc, result) => {
                    acc[result.topic] = result.items;
                    return acc;
                }, {} as Record<string, RAGKnowledgeItem[]>);

                // Also create a flat array of all items for easier access
                const allItems = results.flatMap(result => result.items);

                return {
                    byTopic: resultsByTopic,
                    allItems: allItems
                };
            } else if (Array.isArray(topic)) {
                elizaLogger.log("[NewsMemoryService] Fetching news for specific topics: ", topic);

                const results = await Promise.all(
                    topic.map(async (singleTopic) => {
                        try {
                            const items = await this.fetchNewsForTopic(singleTopic);
                            return {
                                topic: singleTopic,
                                items: items,
                                success: true
                            };
                        } catch (error) {
                            elizaLogger.error(`Error fetching news for topic ${singleTopic}:`, error);
                            return {
                                topic: singleTopic,
                                items: [],
                                success: false
                            };
                        }
                    })
                );

                // Convert array of results to an object mapping topics to items
                const resultsByTopic = results.reduce((acc, result) => {
                    acc[result.topic] = result.items;
                    return acc;
                }, {} as Record<string, RAGKnowledgeItem[]>);

                // Also create a flat array of all items for easier access
                const allItems = results.flatMap(result => result.items);

                return {
                    byTopic: resultsByTopic,
                    allItems: allItems
                };
            } else {
                // Fetch news for a single topic
                const items = await this.fetchNewsForTopic(topic);
                return {
                    byTopic: { [topic]: items },
                    allItems: items
                };
            }
        } catch (error) {
            elizaLogger.error("[NewsMemoryService] Error fetching news:", error);
            return {
                byTopic: {},
                allItems: []
            };
        }
    }

    async fetchNewsForTopic(topic: string): Promise<RAGKnowledgeItem[]> {
        try {
            elizaLogger.log(`Fetching news for topic: ${topic}`);

            // Construct search query
            const searchQuery = `latest news about ${topic}`;

            // Execute search
            const searchResults = await this.webSearchService.search(searchQuery, {
                type: "news",
                limit: 5
            });

            // Process and store each result
            const storedItems = [];

            if (searchResults && Array.isArray(searchResults.results)) {
                for (const result of searchResults.results) {
                    // Skip results without content
                    if (!result.title || !result.content) continue;

                    let extractedDate: Date | null = null;
                    if (!result.publishedDate) {
                        try {
                            if (result.rawContent) {
                                extractedDate = extractDateFromContent(result.rawContent);
                                if (!extractedDate) {
                                    extractedDate = extractDateFromContent(result.content);
                                }
                                if (!extractedDate) {
                                    extractedDate = new Date();
                                }
                            }
                        }
                        catch (e) {
                            elizaLogger.debug("[NewsMemoryService] Error parsing published date:", e);
                            extractedDate = new Date();
                        }
                    } else {
                        extractedDate = new Date(result.publishedDate);
                    }

                    // Create a news item
                    const newsItem: NewsItem = {
                        title: result.title,
                        content: result.content || "",
                        source: result.source || (result.url ? new URL(result.url).hostname : "unknown"),
                        url: result.url,
                        publishedAt: extractedDate,
                        topics: [topic]
                    };

                    // Check for duplicates
                    const isDuplicate = await this.newsKnowledgeManager.checkForDuplicate(newsItem);
                    if (isDuplicate) {
                        elizaLogger.debug(`Skipping duplicate news item: ${newsItem.title}`);
                        continue;
                    }

                    // Store the item and collect the result
                    const storedItem = await this.newsKnowledgeManager.storeNewsItem(newsItem);
                    if (storedItem) {
                        storedItems.push(storedItem);
                    }
                }

                elizaLogger.log(`Fetched and stored ${storedItems.length} news items for topic: ${topic}`);
            }

            return storedItems;
        } catch (error) {
            elizaLogger.error(`Error fetching news for topic ${topic}:`, error);
            throw error;
        }
    }

    async searchNews(options: NewsSearchOptions = {}) {
        return this.newsKnowledgeManager.searchNews(options);
    }

    async purgeOldNews() {
        try {
            const config = await validateNewsConfig(this.runtime);
            const retentionDays = config.NEWS_RETENTION_DAYS || DEFAULT_RETENTION_DAYS;

            const purgedCount = await this.newsKnowledgeManager.purgeOldNews(retentionDays);
            return purgedCount;
        } catch (error) {
            elizaLogger.error("[NewsMemoryService] Error in purgeOldNews:", error);
            return 0;
        }
    }
}

function extractDateFromContent(content: string): Date | null {
    // Common date patterns in news articles
    const datePatterns = [
        /(\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,\s+\d{4}\b)/i,
        /(\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\b)/i,
        /(\b\d{4}-\d{2}-\d{2}\b)/,
        /(\b\d{2}\/\d{2}\/\d{4}\b)/,
        /(\b\d{1,2}\s+hours\s+ago\b)/i,
        /(\b\d{1,2}\s+days\s+ago\b)/i,
        /(\byesterday\b)/i,
        /(\btoday\b)/i
    ];

    // Check each pattern
    for (const pattern of datePatterns) {
        const match = content.match(pattern);
        if (match && match[1]) {
            const dateText = match[1];

            // Handle relative times
            if (/hours\s+ago/i.test(dateText)) {
                const hours = parseInt(dateText.match(/\d+/)[0]);
                const date = new Date();
                date.setHours(date.getHours() - hours);
                return date;
            } else if (/days\s+ago/i.test(dateText)) {
                const days = parseInt(dateText.match(/\d+/)[0]);
                const date = new Date();
                date.setDate(date.getDate() - days);
                return date;
            } else if (/yesterday/i.test(dateText)) {
                const date = new Date();
                date.setDate(date.getDate() - 1);
                return date;
            } else if (/today/i.test(dateText)) {
                return new Date();
            }

            // Try to parse absolute dates
            try {
                const parsedDate = new Date(dateText);
                if (!isNaN(parsedDate.getTime())) {
                    return parsedDate;
                }
            } catch (e) {
                // Ignore parsing errors and try next pattern
            }
        }
    }

    return null; // No date found
}