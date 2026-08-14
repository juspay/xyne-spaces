/** Provider-neutral PR FlowUI card built by Claw Auth from a PR UiWidget. */
import { FlowBuilder, type FlowComponent, type FlowDefinition } from "./builder.js";

export type PrProvider = "github" | "bitbucket" | "gitlab" | "other";
export type PrStatus = "created" | "merged" | "reverted" | "deleted" | "declined";

export const PR_COMPONENT_ID = "pr";

export interface PrCardInput {
  provider: PrProvider;
  status: PrStatus;
  title: string;
  url?: string;
  ticketId?: string;
  desc?: string;
  detailsUrl?: string;
}

export interface PrIdentity {
  provider?: PrProvider;
  repo?: string;
  number?: number | string;
  url?: string;
}

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Stable identity used for post-once/update-in-place PR cards. */
export function prScreenId(identity: PrIdentity): string {
  const { provider, repo, number, url } = identity;
  const parts: string[] = [];
  if (provider) parts.push(provider);
  if (repo) parts.push(slug(repo));
  if (number !== undefined && number !== null && `${number}`.length > 0) parts.push(`${number}`);
  if (parts.length >= 2) return `agent-pr-${parts.join("-")}`;
  if (url) {
    const fromUrl = slug(url.replace(/^https?:\/\//, ""));
    if (fromUrl) return `agent-pr-${fromUrl}`;
  }
  return parts.length ? `agent-pr-${parts.join("-")}` : "agent-pr";
}

export function buildPrFlow(
  pr: PrCardInput,
  opts?: {
    screenId?: string;
    identity?: Omit<PrIdentity, "provider">;
    title?: string;
    data?: Record<string, unknown>;
  },
): FlowDefinition {
  const identity: PrIdentity = { provider: pr.provider, ...(opts?.identity ?? {}) };
  if (identity.url === undefined && pr.url !== undefined) identity.url = pr.url;

  const props: Record<string, unknown> = {
    status: pr.status,
    provider: pr.provider,
    title: pr.title,
    ...(pr.ticketId ? { ticketId: pr.ticketId } : {}),
    ...(pr.desc ? { desc: pr.desc } : {}),
    ...(pr.detailsUrl ? { detailsUrl: pr.detailsUrl } : {}),
    ...(pr.url ? { url: pr.url } : {}),
  };
  const component: FlowComponent = { id: PR_COMPONENT_ID, type: "pr", props };

  return new FlowBuilder(opts?.screenId ?? prScreenId(identity))
    .setTitle(opts?.title ?? "Pull Request")
    .addComponent(component)
    .setData({ kind: "pr", fallbackText: `PR ${pr.status} · ${pr.title}`, ...(opts?.data ?? {}) })
    .build();
}
