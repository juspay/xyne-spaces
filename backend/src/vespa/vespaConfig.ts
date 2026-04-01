
export const NAMESPACE = process.env.VESPA_NAMESPACE || "namespace"
export const CLUSTER = process.env.CLUSTER || "my_content"
export const vespaBaseHost = process.env.VESPA_BASE_HOST || "0.0.0.0"
let vespaFeedPort = parseInt(process.env.VESPA_FEED_PORT || "8080", 10)
let vespaQueryPort = parseInt(process.env.VESPA_QUERY_PORT || "8081", 10)

export default {
    VespaPageSize: parseInt(process.env.VESPA_PAGE_SIZE || "10", 10),
    isDebugMode: process.env.VESPA_DEBUG_MODE === "true",
    vespaMaxRetryAttempts: parseInt(process.env.VESPA_MAX_RETRY_ATTEMPTS || "3", 10),
    vespaRetryDelay: parseInt(process.env.VESPA_RETRY_DELAY || "1000", 10),
    vespaEndpoint: {
        feedEndpoint: `http://${vespaBaseHost}:${vespaFeedPort}`,
        queryEndpoint: `http://${vespaBaseHost}:${vespaQueryPort}`,
    }
}
