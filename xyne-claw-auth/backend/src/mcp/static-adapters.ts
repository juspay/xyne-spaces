import type { McpAdapter } from "./types.js";
import { grafanaAdapter } from "./adapters/grafana.js";
import { bitbucketAdapter } from "./adapters/bitbucket.js";
import { kibanaAdapter } from "./adapters/kibana.js";
import { xyneSpacesAdapter } from "./adapters/xyne-spaces.js";
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

export const STATIC_ADAPTERS: Record<string, McpAdapter> = {
  grafana: grafanaAdapter,
  bitbucket: bitbucketAdapter,
  kibana: kibanaAdapter,
  "xyne-spaces": xyneSpacesAdapter,
  figma: figmaAdapter,
  "ardra-finops": ardraFinopsAdapter,
  sequentialthinking: sequencethinkingAdapter,
  github: githubAdapter,
  "juspay-internal-tools": juspayInternalToolsAdapter,
  "xyne-spaces-app-tools": xyneSpacesAppToolsAdapter,
  "query-routing": queryRoutingAdapter,
  hubspot: hubspotAdapter,
  mixpanel: mixpanelAdapter,
  amplitude: amplitudeAdapter,
  bigquery: bigqueryAdapter,
  databricks: databricksAdapter,
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
};
