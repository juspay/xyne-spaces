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
  const requested = (params.get("channel") ?? "").trim() as MessagingChannelKey;
  // Without an explicit channel, offer both WhatsApp transports: the person
  // arriving here was told to register a number and has no idea whether the
  // agent that messaged them runs on a business number or a colleague's own.
  const channels: MessagingChannelKey[] = requested ? [requested] : ["whatsapp-cloud", "whatsapp"];
  const name = (requested && CHANNEL_NAMES[requested]) || "WhatsApp";

  return (
    <div className="mx-auto max-w-md py-10">
      <LinkNumberPanel channel={channels} channelName={name} userEmail={userEmail} />
    </div>
  );
}
