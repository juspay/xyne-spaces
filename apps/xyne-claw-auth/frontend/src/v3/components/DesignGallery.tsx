import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  chatAttachmentDownloadUrl,
  pollChatMessages,
  type ConversationSummary,
} from "../../lib/api";

export type DesignGalleryConversation = ConversationSummary & { agentSlug: string };

interface DesignGalleryProps {
  conversations: DesignGalleryConversation[];
  userId: string;
  onSelectConversation: (conversation: DesignGalleryConversation) => void;
  onUseTemplate: (prompt: string) => void;
}

type ThumbnailResult = { html: string | null };

const thumbnailCache = new Map<string, Promise<ThumbnailResult>>();
const thumbnailQueue: Array<() => void> = [];
let activeThumbnailLoads = 0;
const MAX_THUMBNAIL_LOADS = 4;

function scheduleThumbnailLoad<T>(load: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeThumbnailLoads += 1;
      load()
        .then(resolve, reject)
        .finally(() => {
          activeThumbnailLoads -= 1;
          thumbnailQueue.shift()?.();
        });
    };

    if (activeThumbnailLoads < MAX_THUMBNAIL_LOADS) run();
    else thumbnailQueue.push(run);
  });
}

function isHtmlAttachment(attachment: { mimeType: string; originalFilename: string }): boolean {
  return attachment.mimeType.toLowerCase().includes("html") || attachment.originalFilename.toLowerCase().endsWith(".html");
}

function loadDesignThumbnail(
  conversation: DesignGalleryConversation,
  userId: string,
): Promise<ThumbnailResult> {
  const cached = thumbnailCache.get(conversation.conversationId);
  if (cached) return cached;

  const request = scheduleThumbnailLoad(async () => {
    const { messages } = await pollChatMessages(
      conversation.agentSlug,
      conversation.conversationId,
    );
    const attachment = [...messages]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .find((message) => message.role === "assistant" && message.attachments?.some(isHtmlAttachment))
      ?.attachments?.find(isHtmlAttachment);

    if (!attachment) return { html: null };

    const response = await fetch(chatAttachmentDownloadUrl(attachment.id), {
      credentials: "include",
      headers: { "x-user-id": userId },
    });
    if (!response.ok) throw new Error(`Thumbnail download failed: HTTP ${response.status}`);
    return { html: await response.text() };
  }).catch(() => ({ html: null }));

  thumbnailCache.set(conversation.conversationId, request);
  return request;
}

function relativeTime(iso: string): string {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "";

  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return formatter.format(months, "month");
  return formatter.format(Math.round(months / 12), "year");
}

function staticThumbnailDocument(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  document
    .querySelectorAll("script, iframe, frame, object, embed, base, meta[http-equiv='refresh']")
    .forEach((node) => node.remove());

  const policy = document.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = "default-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; media-src 'none'; img-src data: blob:; font-src data:; style-src 'unsafe-inline'";
  document.head.prepend(policy);
  return `<!doctype html>${document.documentElement.outerHTML}`;
}

function Thumbnail({ conversation, userId }: { conversation: DesignGalleryConversation; userId: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<ThumbnailResult | null>(null);
  const thumbnailHtml = useMemo(
    () => result?.html ? staticThumbnailDocument(result.html) : null,
    [result?.html],
  );

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    loadDesignThumbnail(conversation, userId).then((next) => {
      if (!cancelled) setResult(next);
    });
    return () => { cancelled = true; };
  }, [conversation, userId, visible]);

  return (
    <div ref={rootRef} className="relative aspect-[16/10] overflow-hidden bg-xyne-surface-subtle">
      {thumbnailHtml ? (
        <iframe
          title={`Preview of ${conversation.title || "Untitled design"}`}
          srcDoc={thumbnailHtml}
          sandbox=""
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 h-[400%] w-[400%] origin-top-left scale-25 border-0 bg-white"
        />
      ) : result ? (
        <div className="flex h-full items-center justify-center text-[11px] text-xyne-fg-tertiary">
          No preview available
        </div>
      ) : (
        <div className="absolute inset-0 animate-pulse bg-xyne-surface" />
      )}
    </div>
  );
}

type Template = {
  name: string;
  description: string;
  prompt: string;
  glyph: ReactNode;
};

const glyphClass = "h-6 w-6";
const templates: Template[] = [
  {
    name: "Dashboard",
    description: "A polished analytics workspace",
    prompt: "Design a polished, responsive analytics dashboard with a clear sidebar, KPI cards, trend charts, recent activity, and thoughtful empty and loading states. Use a cohesive visual system and realistic sample data.",
    glyph: <svg viewBox="0 0 24 24" fill="none" className={glyphClass} aria-hidden="true"><rect x="3" y="3" width="7" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="14" y="3" width="7" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="14" y="12" width="7" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="3" y="15" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.7"/></svg>,
  },
  {
    name: "Landing page",
    description: "A high-converting product story",
    prompt: "Create a premium responsive SaaS landing page with a compelling hero, social proof, feature storytelling, an interactive product preview, testimonials, FAQ, and a strong final call to action. Make the visual hierarchy memorable and conversion-focused.",
    glyph: <svg viewBox="0 0 24 24" fill="none" className={glyphClass} aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.7"/><path d="M3 8h18M7 6h.01M10 6h.01M7 12h7M7 15h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>,
  },
  {
    name: "Pricing page",
    description: "Plans that are easy to compare",
    prompt: "Design a responsive pricing page with three clearly differentiated plans, a monthly/annual toggle, an emphasized recommended tier, a detailed feature comparison, trust cues, and concise FAQ. Keep pricing decisions effortless to scan.",
    glyph: <svg viewBox="0 0 24 24" fill="none" className={glyphClass} aria-hidden="true"><path d="M12 3v18M16 7.5c0-1.4-1.8-2.5-4-2.5S8 6.1 8 7.5 9.8 10 12 10s4 1.1 4 2.5S14.2 15 12 15s-4-1.1-4-2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>,
  },
  {
    name: "Email",
    description: "A crisp campaign template",
    prompt: "Create a responsive marketing email for a product launch with a strong subject-line concept, concise hero message, product imagery placeholders, benefit sections, one primary CTA, social proof, and a clean footer. Optimize it for common email-client constraints.",
    glyph: <svg viewBox="0 0 24 24" fill="none" className={glyphClass} aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.7"/><path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>,
  },
  {
    name: "Signup form",
    description: "A welcoming onboarding flow",
    prompt: "Design a friendly, accessible signup experience with a focused form, useful validation states, password guidance, social sign-in options, privacy reassurance, and a complementary brand panel. Make the responsive mobile state especially strong.",
    glyph: <svg viewBox="0 0 24 24" fill="none" className={glyphClass} aria-hidden="true"><circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.7"/><path d="M3.5 19c.5-3.3 2.3-5 5.5-5s5 1.7 5.5 5M18 8v6M15 11h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>,
  },
  {
    name: "Data report",
    description: "Insights in an editorial layout",
    prompt: "Create an executive data report with an editorial cover, concise summary, KPI highlights, well-labeled charts, key findings, recommendations, and methodology notes. Use realistic data and make the report feel presentation-ready and easy to scan.",
    glyph: <svg viewBox="0 0 24 24" fill="none" className={glyphClass} aria-hidden="true"><path d="M6 3h9l4 4v14H6z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M15 3v5h4M9 17v-3M12.5 17v-6M16 17v-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>,
  },
];

export function DesignGallery({
  conversations,
  userId,
  onSelectConversation,
  onUseTemplate,
}: DesignGalleryProps) {
  return (
    <div data-id="design-gallery" className="flex-1 overflow-y-auto p-4 sm:p-5">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-7">
        <section aria-labelledby="design-templates-heading">
          <div className="mb-3">
            <h2 id="design-templates-heading" className="text-[15px] font-semibold text-xyne-fg-primary">
              Start from a template
            </h2>
            <p className="mt-0.5 text-[12px] text-xyne-fg-muted">Choose a starting point, then tailor the prompt before sending.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            {templates.map((template) => (
              <button
                key={template.name}
                type="button"
                data-id={`design-template-${template.name.toLowerCase().replaceAll(" ", "-")}`}
                onClick={() => onUseTemplate(template.prompt)}
                className="group flex min-h-24 flex-col items-start rounded-xl border border-xyne-border-subtle bg-xyne-surface p-3 text-left transition hover:border-xyne-brand/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-xyne-brand/40"
              >
                <span className="mb-2 text-xyne-brand transition-transform group-hover:-translate-y-0.5">{template.glyph}</span>
                <span className="text-[12px] font-semibold text-xyne-fg-primary">{template.name}</span>
                <span className="mt-0.5 text-[11px] leading-4 text-xyne-fg-muted">{template.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="your-designs-heading">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="your-designs-heading" className="text-[15px] font-semibold text-xyne-fg-primary">Your designs</h2>
            {conversations.length > 0 && <span className="text-[11px] text-xyne-fg-tertiary">{conversations.length} total</span>}
          </div>
          {conversations.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {conversations.map((conversation) => (
                <button
                  key={conversation.conversationId}
                  type="button"
                  data-id={`design-card-${conversation.conversationId}`}
                  onClick={() => onSelectConversation(conversation)}
                  className="group min-w-0 overflow-hidden rounded-xl border border-xyne-border-subtle bg-xyne-surface text-left transition hover:-translate-y-0.5 hover:border-xyne-brand/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-xyne-brand/40"
                >
                  <Thumbnail conversation={conversation} userId={userId} />
                  <span className="block border-t border-xyne-border-subtle px-3 py-2.5">
                    <span className="block truncate text-[12px] font-semibold text-xyne-fg-primary">
                      {conversation.title || "Untitled design"}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-xyne-fg-muted">{relativeTime(conversation.lastMessageAt)}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-xyne-border bg-xyne-surface/60 px-5 py-8 text-center">
              <p className="text-[13px] font-medium text-xyne-fg-secondary">Your designs will appear here</p>
              <p className="mt-1 text-[11px] text-xyne-fg-muted">Pick a template or describe what you want to create.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
