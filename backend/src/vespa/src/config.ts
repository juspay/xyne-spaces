
export const NAMESPACE = process.env.VESPA_NAMESPACE || "namespace"
export const CLUSTER = process.env.CLUSTER || "my_content"
export default {
  nativeRankThreshold: 0.001,
  vespaMaxRetryAttempts: 3,
  vespaRetryDelay: 1000, // 1 sec
  vespaBaseHost: "localhost",
  page: 8,
  isDebugMode: false,
  userQueryUpdateInterval: 60 * 1000, // 1 minute,
  namespace: NAMESPACE,
  cluster: CLUSTER,
  productionServerUrl: '',
  apiKey: '',
  feedEndpoint: process.env.VESPA_FEED_URL || "http://127.0.0.1:8080",
  queryEndpoint: process.env.VESPA_QUERY_URL || "http://127.0.0.1:8081",
};
