/**
 * Where a person connects their messenger number to their Xyne account.
 *
 * There is only one direction now: you come here, type your number, and it is
 * yours. Nothing is issued to a phone and nothing waits on an admin — everyone
 * who can talk to a Claw agent already has a Spaces login, so there is nobody
 * who needs vouching for.
 */
import { useSearchParams } from "react-router-dom";
import { LinkNumberPanel } from "./LinkNumberPanel";
import type { MessagingChannelKey } from "../../lib/api";

const CHANNEL_NAMES: Record<string, string> = {
  "whatsapp-cloud": "WhatsApp",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
};

export function LinkChannelPage({ userEmail }: { userEmail: string }) {
  const [params] = useSearchParams();
  const requested = (params.get("channel") ?? "").trim();
  // The org-level business number is what people link themselves to; a
  // personal WhatsApp is connected by scanning a QR, not by typing a number.
  const channel = (requested || "whatsapp-cloud") as MessagingChannelKey;

  return (
    <div className="mx-auto max-w-md py-10">
      <LinkNumberPanel channel={channel} channelName={CHANNEL_NAMES[channel] ?? "WhatsApp"} userEmail={userEmail} />
    </div>
  );
}
