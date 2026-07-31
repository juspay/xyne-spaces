import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { callLobbyService } from "@/services/Call/callLobbyService";

/**
 * Resolves the unified invite before the guest lobby performs any work. The
 * public lobby is the safe fallback when detection is disabled or fails.
 */
export function useUnifiedCallInviteRouting(externalId?: string): {
  canLoadGuestLobby: boolean;
} {
  const detectionQuery = useQuery({
    queryKey: ["call-detect-internal", externalId],
    queryFn: () => callLobbyService.detectInternal(externalId!),
    enabled: !!externalId,
    retry: false,
    staleTime: 0,
  });

  useEffect(() => {
    if (detectionQuery.data?.result === "internal") {
      window.location.replace(detectionQuery.data.redirectUrl);
    }
  }, [detectionQuery.data]);

  const canLoadGuestLobby =
    !!externalId &&
    (detectionQuery.data?.result === "external" || detectionQuery.isError);

  return { canLoadGuestLobby };
}
