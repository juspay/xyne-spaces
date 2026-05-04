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
import { queryRoutingAdapter } from "./adapters/query-routing.js";
import { hubspotAdapter } from "./adapters/hubspot.js";
import { mixpanelAdapter } from "./adapters/mixpanel.js";
import { amplitudeAdapter } from "./adapters/amplitude.js";

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
  "query-routing": queryRoutingAdapter,
  hubspot: hubspotAdapter,
  mixpanel: mixpanelAdapter,
  amplitude: amplitudeAdapter,
};
