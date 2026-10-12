/**
 * The question form as a WhatsApp Flow.
 *
 * One Flow, published once per business account, renders ANY question set: it
 * has a fixed number of slots, and each send turns slots on or off and fills
 * them through `flow_action_payload.data` (the "navigate" action, so Meta
 * never calls an endpoint of ours). Field names are the contract with
 * messaging/questions.ts, which builds that data (`formDataFor`) and reads the
 * submission back (`answersFromForm`).
 *
 * Published Flows are immutable. Changing anything below means publishing a
 * new Flow and pointing the account's `questionFormId` at it.
 */
import { fetch as httpFetch } from "undici";
import { FORM_SCREEN, MAX_FORM_QUESTIONS } from "../messaging/questions.js";
import { GRAPH_ORIGIN, GRAPH_VERSION } from "./schema.js";

export const QUESTION_FORM_NAME = "xyne_claw_questions_v1";
const FLOW_JSON_VERSION = "7.3";

function slotData(i: number): Record<string, unknown> {
  const flag = (example: boolean) => ({ type: "boolean", __example__: example });
  return {
    [`q${i}_show`]: flag(i === 0),
    [`q${i}_text`]: { type: "string", __example__: i === 0 ? "Which environment should I deploy to?" : "-" },
    [`q${i}_single`]: flag(i === 0),
    [`q${i}_multi`]: flag(false),
    [`q${i}_open`]: flag(false),
    [`q${i}_single_req`]: flag(i === 0),
    [`q${i}_multi_req`]: flag(false),
    [`q${i}_open_req`]: flag(false),
    [`q${i}_options`]: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, title: { type: "string" }, description: { type: "string" } },
      },
      __example__: [
        { id: "0", title: "Staging" },
        { id: "1", title: "Production" },
      ],
    },
  };
}

function slotComponents(i: number): Array<Record<string, unknown>> {
  return [
    { type: "TextBody", text: `\${data.q${i}_text}`, visible: `\${data.q${i}_show}` },
    {
      type: "RadioButtonsGroup",
      name: `q${i}_one`,
      label: "Pick one",
      "data-source": `\${data.q${i}_options}`,
      required: `\${data.q${i}_single_req}`,
      visible: `\${data.q${i}_single}`,
    },
    {
      type: "CheckboxGroup",
      name: `q${i}_many`,
      label: "Pick any",
      "data-source": `\${data.q${i}_options}`,
      required: `\${data.q${i}_multi_req}`,
      visible: `\${data.q${i}_multi}`,
    },
    {
      type: "TextArea",
      name: `q${i}_open_ans`,
      label: "Your answer",
      required: `\${data.q${i}_open_req}`,
      visible: `\${data.q${i}_open}`,
    },
  ];
}

/** The Flow JSON to publish. */
export function questionFormFlowJson(): Record<string, unknown> {
  const slots = Array.from({ length: MAX_FORM_QUESTIONS }, (_, i) => i);
  const payload: Record<string, string> = {};
  for (const i of slots) {
    payload[`q${i}_one`] = `\${form.q${i}_one}`;
    payload[`q${i}_many`] = `\${form.q${i}_many}`;
    payload[`q${i}_open_ans`] = `\${form.q${i}_open_ans}`;
  }
  return {
    version: FLOW_JSON_VERSION,
    screens: [
      {
        id: FORM_SCREEN,
        title: "Quick questions",
        terminal: true,
        success: true,
        data: {
          heading: { type: "string", __example__: "2 quick questions" },
          ...Object.assign({}, ...slots.map(slotData)),
        },
        layout: {
          type: "SingleColumnLayout",
          children: [
            { type: "TextHeading", text: "${data.heading}" },
            {
              type: "Form",
              name: "form",
              children: [
                ...slots.flatMap(slotComponents),
                { type: "Footer", label: "Send", "on-click-action": { name: "complete", payload } },
              ],
            },
          ],
        },
      },
    ],
  };
}

/**
 * Create and publish the form in a WhatsApp Business Account. Needs a token
 * with whatsapp_business_management; the messaging-only token most accounts
 * are connected with gets a permissions error, which is reported verbatim.
 */
export async function publishQuestionForm(accessToken: string, wabaId: string): Promise<string> {
  const response = await httpFetch(`${GRAPH_ORIGIN}/${GRAPH_VERSION}/${encodeURIComponent(wabaId)}/flows`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      name: QUESTION_FORM_NAME,
      categories: ["OTHER"],
      flow_json: JSON.stringify(questionFormFlowJson()),
      publish: true,
    }),
  });
  const payload = (await response.json().catch(() => null)) as {
    id?: string;
    error?: { message?: string };
    validation_errors?: Array<{ message?: string; error?: string }>;
  } | null;
  if (!response.ok || !payload?.id) {
    const validation = payload?.validation_errors?.map((e) => e.message ?? e.error).filter(Boolean).join("; ");
    throw new Error(`Could not publish the question form: ${validation || payload?.error?.message || `HTTP ${response.status}`}`);
  }
  if (payload.validation_errors?.length) {
    // Created but left as a draft: a draft cannot be sent to real users.
    throw new Error(`The question form was created as a draft (${payload.id}) but not published: ${payload.validation_errors.map((e) => e.message ?? e.error).join("; ")}`);
  }
  return payload.id;
}
