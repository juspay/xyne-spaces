
export const NAMESPACE = process.env.VESPA_NAMESPACE || "namespace"
export const CLUSTER = process.env.CLUSTER || "my_content"
export const vespaBaseHost = process.env.VESPA_BASE_HOST || "0.0.0.0"
const vespaFeedPort = parseInt(process.env.VESPA_FEED_PORT || "8080", 10)
const vespaQueryPort = parseInt(process.env.VESPA_QUERY_PORT || "8081", 10)
export default {
  nativeRankThreshold: 0.001,
  vespaMaxRetryAttempts: 3,
  vespaRetryDelay: 1000, // 1 sec
  vespaBaseHost: vespaBaseHost,
  page: 8,
  isDebugMode: false,
  userQueryUpdateInterval: 60 * 1000, // 1 minute,
  namespace: NAMESPACE,
  cluster: CLUSTER,
  productionServerUrl: '',
  apiKey: '',
  feedEndpoint: `http://${vespaBaseHost}:${vespaFeedPort}`,
  queryEndpoint: `http://${vespaBaseHost}:${vespaQueryPort}`,
};
