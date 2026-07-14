import { useMemo, useState } from "react";
import { CheckCircle, TerminalWindow, WarningCircle } from "@phosphor-icons/react";
import { approveCliLogin, ApiError } from "../../lib/api";

type Status = "idle" | "submitting" | "success" | "error";

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function CliLoginPageV3() {
  const params = new URLSearchParams(window.location.search);
  const code = useMemo(() => normalizeCode(params.get("code") ?? ""), [params]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const onAuthorize = async () => {
    if (!code || status === "submitting") return;
    setStatus("submitting");
    setError(null);
    try {
      await approveCliLogin(code);
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(err instanceof ApiError ? err.message : "Could not authorize this CLI login.");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-xyne-surface-subtle px-4 py-10 text-xyne-fg-primary">
      <section className="w-full max-w-[440px] rounded-lg border border-xyne-border bg-xyne-surface p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-xyne-surface-sunken text-xyne-fg-primary">
            <TerminalWindow size={22} />
          </div>
          <div>
            <h1 className="text-[20px] font-semibold">Authorize Xyne CLI</h1>
            <p className="mt-1 text-[13px] text-xyne-fg-muted">Requesting client: xyne-cli</p>
          </div>
        </div>

        <div className="mb-5 rounded-md border border-xyne-border bg-xyne-surface-sunken px-4 py-3">
          <div className="text-[12px] font-medium uppercase text-xyne-fg-muted">Pairing code</div>
          <div className="mt-2 font-mono text-[28px] font-semibold tracking-normal text-xyne-fg-primary">
            {code || "Missing code"}
          </div>
        </div>

        {status === "success" ? (
          <div className="flex items-start gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-700 dark:text-emerald-300">
            <CheckCircle className="mt-0.5 shrink-0" size={20} weight="fill" />
            <p className="text-[14px] font-medium">You can return to your terminal.</p>
          </div>
        ) : (
          <>
            {status === "error" && (
              <div className="mb-4 flex items-start gap-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-red-700 dark:text-red-300">
                <WarningCircle className="mt-0.5 shrink-0" size={18} weight="fill" />
                <p className="text-[13px]">{error}</p>
              </div>
            )}
            <button
              type="button"
              disabled={!code || status === "submitting"}
              onClick={onAuthorize}
              className="flex h-11 w-full items-center justify-center rounded-md bg-xyne-fg-primary px-4 text-[14px] font-medium text-xyne-fg-inverse transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "submitting" ? "Authorizing..." : "Authorize"}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
