import { config } from '@/config/env';

export const NAMESPACE = config.vespa.namespace || "namespace"
export const CLUSTER = config.vespa.cluster || "my_content"

export default {
    VespaPageSize: config.vespa.pageSize,
    isDebugMode: config.vespa.debugMode,
    vespaMaxRetryAttempts: config.vespa.maxRetryAttempts,
    vespaRetryDelay: config.vespa.retryDelay,
    vespaEndpoint: {
        // 8083, not 8080: y-sweet owns 8080 and MESSAGE_CLASSIFIER_URL uses 8082, so docker-compose.dev.yml
        // publishes Vespa's feed port on 8083 (container port is still 8080).
        feedEndpoint: config.vespa.feedUrl || "http://127.0.0.1:8083",
        queryEndpoint: config.vespa.queryUrl || "http://127.0.0.1:8081",
    }
}