import type { McpAdapter } from "./types.js";
import { grafanaAdapter } from "./adapters/grafana.js";
import { bitbucketAdapter } from "./adapters/bitbucket.js";
import { kibanaAdapter } from "./adapters/kibana.js";
import { xyneSpacesAdapter } from "./adapters/xyne-spaces.js";
import { xyneDashboardAdapter } from "./adapters/xyne-dashboard.js";
import { figmaAdapter } from "./adapters/figma.js";
import { ardraFinopsAdapter } from "./adapters/ardra-finops.js";
import { sequencethinkingAdapter } from "./adapters/sequentialthinking.js";
import { githubAdapter } from "./adapters/github.js";
import { juspayInternalToolsAdapter } from "./adapters/juspay-internal-tools.js";
import { xyneSpacesAppToolsAdapter } from "./adapters/xyne-spaces-app-tools.js";
import { queryRoutingAdapter } from "./adapters/query-routing.js";
import { hubspotAdapter } from "./adapters/hubspot.js";
import { mixpanelAdapter } from "./adapters/mixpanel.js";
import { amplitudeAdapter } from "./adapters/amplitude.js";
import { bigqueryAdapter } from "./adapters/bigquery.js";
import { databricksAdapter } from "./adapters/databricks.js";
import { slackAdapter } from "./adapters/slack.js";
import { shopifyAdapter } from "./adapters/shopify.js";
import { intercomAdapter } from "./adapters/intercom.js";
import { asanaAdapter } from "./adapters/asana.js";
import { salesforceAdapter } from "./adapters/salesforce.js";
import { calendlyAdapter } from "./adapters/calendly.js";
import { jotformAdapter } from "./adapters/jotform.js";
import { docusignAdapter } from "./adapters/docusign.js";
import { egnyteAdapter } from "./adapters/egnyte.js";
import { miroAdapter } from "./adapters/miro.js";
import { webflowAdapter } from "./adapters/webflow.js";
import { wixAdapter } from "./adapters/wix.js";
import { mailerliteAdapter } from "./adapters/mailerlite.js";
import { attioAdapter } from "./adapters/attio.js";
import { honeycombAdapter } from "./adapters/honeycomb.js";
import { customerioAdapter } from "./adapters/customerio.js";
import { rapidApiLinkedInAdapter } from "./adapters/rapidapi-linkedin.js";
import { bitbotAdapter } from "./adapters/bitbot.js";
import { researchAgentMcpAdapter } from "./adapters/research-agent-mcp.js";
import { neo4jHttpAdapter } from "./adapters/neo4j-http.js";
import { clickhouseAdapter } from "./adapters/clickhouse.js";
import { excalidrawAdapter } from "./adapters/excalidraw.js";
import { mongodbAdapter } from "./adapters/mongodb.js";
import { sentryAdapter } from "./adapters/sentry.js";
import { notionAdapter } from "./adapters/notion.js";
import { googleAdapter } from "./adapters/google.js";
import { microsoftAdapter } from "./adapters/microsoft.js";
import { twitterAdapter } from "./adapters/twitter.js";
import { redditAdapter } from "./adapters/reddit.js";
import { xNewsAdapter } from "./adapters/x-news.js";
import { jusbizMcpAdapter } from "./adapters/jusbiz-mcp.js";
import { heisenbergAdapter } from "./adapters/heisenberg.js";
import { jenkinsAdapter } from "./adapters/jenkins.js";

export const STATIC_ADAPTERS: Record<string, McpAdapter> = {
  grafana: grafanaAdapter,
  jenkins: jenkinsAdapter,
  bitbucket: bitbucketAdapter,
  kibana: kibanaAdapter,
  "xyne-spaces": xyneSpacesAdapter,
  "xyne-dashboard": xyneDashboardAdapter,
  google: googleAdapter,
  microsoft: microsoftAdapter,
  figma: figmaAdapter,
  "ardra-finops": ardraFinopsAdapter,
  sequentialthinking: sequencethinkingAdapter,
  github: githubAdapter,
  // Alias for the legacy self-serve duplicate `github-mcp-npx`. Identical to the
  // vetted github adapter: same `npx @modelcontextprotocol/server-github`, same
  // `token` credential, same GITHUB_TOKEN/GITHUB_PERSONAL_ACCESS_TOKEN env — so
  // existing connections keep working with their stored creds. Added after the
  // stdio-launchConfig lockdown left these connections unresolved (prod: 4 users).
  "github-mcp-npx": githubAdapter,
  "juspay-internal-tools": juspayInternalToolsAdapter,
  "xyne-spaces-app-tools": xyneSpacesAppToolsAdapter,
  "query-routing": queryRoutingAdapter,
  hubspot: hubspotAdapter,
  mixpanel: mixpanelAdapter,
  amplitude: amplitudeAdapter,
  bigquery: bigqueryAdapter,
  databricks: databricksAdapter,
  // Alias for the legacy self-serve duplicate `databricks-mcp`. Identical to the
  // vetted databricks adapter: same `uvx databricks-mcp-server`, same host/token
  // credentials → DATABRICKS_HOST/DATABRICKS_TOKEN. Existing connections keep
  // working with stored creds (prod: 1 user + 1 agent).
  "databricks-mcp": databricksAdapter,
  slack: slackAdapter,
  shopify: shopifyAdapter,
  intercom: intercomAdapter,
  asana: asanaAdapter,
  salesforce: salesforceAdapter,
  calendly: calendlyAdapter,
  jotform: jotformAdapter,
  docusign: docusignAdapter,
  egnyte: egnyteAdapter,
  miro: miroAdapter,
  webflow: webflowAdapter,
  wix: wixAdapter,
  mailerlite: mailerliteAdapter,
  attio: attioAdapter,
  honeycomb: honeycombAdapter,
  customerio: customerioAdapter,
  "rapidapi-linkedin": rapidApiLinkedInAdapter,
  bitbot: bitbotAdapter,
  "research-agent-mcp": researchAgentMcpAdapter,
  "neo4j-http": neo4jHttpAdapter,
  // Adapters added to restore legacy self-serve stdio connectors after the
  // launchConfig lockdown. cmd/args/env + credential keys mirror what those
  // connections already stored, so existing creds keep working (except `notion`,
  // whose legacy config was broken — those users must reconnect).
  clickhouse: clickhouseAdapter,
  excalidraw: excalidrawAdapter,
  mongodb: mongodbAdapter,
  notion: notionAdapter,
  sentry: sentryAdapter,
  "sentry-mcp": sentryAdapter,
  twitter: twitterAdapter,
  reddit: redditAdapter,
  "x-news": xNewsAdapter,
  "jusbiz-mcp": jusbizMcpAdapter,
  heisenberg: heisenbergAdapter,
};
