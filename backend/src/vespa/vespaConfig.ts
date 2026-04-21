
export const NAMESPACE = process.env.VESPA_NAMESPACE || "namespace"
export const CLUSTER = process.env.CLUSTER || "my_content"

export default {
    VespaPageSize: parseInt(process.env.VESPA_PAGE_SIZE || "10", 10),
    isDebugMode: process.env.VESPA_DEBUG_MODE === "true",
    vespaMaxRetryAttempts: parseInt(process.env.VESPA_MAX_RETRY_ATTEMPTS || "3", 10),
    vespaRetryDelay: parseInt(process.env.VESPA_RETRY_DELAY || "1000", 10),
    vespaEndpoint: {
        feedEndpoint: process.env.VESPA_FEED_URL || "http://127.0.0.1:8080",
        queryEndpoint: process.env.VESPA_QUERY_URL || "http://127.0.0.1:8081",
    }
}