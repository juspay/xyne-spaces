/** A FlowJSON envelope embedded in message HTML (`data-flow-json="…"`). */
const FLOW_JSON_ATTRIBUTE = /data-flow-json="[^"]+"/i;
/** A bot's raw FlowJSON marker before it is rendered (`flowjson|<bot>@{…}`). */
const FLOW_JSON_BOT_MARKER = /flowjson\|[^@]+@\{/;

/** Whether the message carries FlowJSON (a card, a plan, a slash-command artifact), in either stored form. */
export function extractFlowJsonPresent(text: string): boolean {
  return FLOW_JSON_ATTRIBUTE.test(text) || FLOW_JSON_BOT_MARKER.test(text);
}
