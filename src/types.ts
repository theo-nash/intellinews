export interface NewsItem {
    title: string;
    content: string;
    source: string;
    url: string;
    publishedAt: Date;
    topics: string[];
    rawContent?: string;
}

export interface NewsSearchOptions {
    query?: string;
    conversationContext?: string;
    limit?: number;
    fromDate?: Date;
    toDate?: Date;
    sources?: string[];
    topics?: string[];
}

export interface TopicConfig {
    name: string;
    interval: number; // in minutes
}