
export const NAMESPACE = process.env.VESPA_NAMESPACE || "namespace"
export const CLUSTER = process.env.CLUSTER || "my_content"
export default {
  nativeRankThreshold: 0,
  vespaMaxRetryAttempts: 3,
  vespaRetryDelay: 1000, // 1 sec
  vespaBaseHost: "localhost",
  vespaMaxRetryDelay: 30000, // 30 sec
  vespaRetryJitter: 0.25,
  page: 8,
  isDebugMode: false,
  userQueryUpdateInterval: 60 * 1000, // 1 minute,
  namespace: NAMESPACE,
  cluster: CLUSTER,
  productionServerUrl: '',
  apiKey: '',
  // 8083, not 8080: y-sweet owns 8080 and MESSAGE_CLASSIFIER_URL uses 8082, so docker-compose.dev.yml publishes
  // Vespa's feed port on 8083 (container-internal port is still 8080).
  feedEndpoint: process.env.VESPA_FEED_URL || "http://127.0.0.1:8083",
  queryEndpoint: process.env.VESPA_QUERY_URL || "http://127.0.0.1:8081",
};
