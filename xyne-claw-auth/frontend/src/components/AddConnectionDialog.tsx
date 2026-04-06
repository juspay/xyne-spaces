import * as Dialog from "@radix-ui/react-dialog";
import { useState, useEffect, type FormEvent } from "react";
import type { McpServer, CredentialField } from "../lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (mcpServerId: string, credentials: Record<string, string>) => void;
  servers: McpServer[];
  credentialFields: Record<string, CredentialField[]>;
  editServerId?: string | undefined;
}

export function AddConnectionDialog({ open, onOpenChange, onSubmit, servers, credentialFields, editServerId }: Props) {
  const [selectedServerId, setSelectedServerId] = useState("");

  useEffect(() => {
    if (open && editServerId) {
      setSelectedServerId(editServerId);
    }
  }, [open, editServerId]);

  const isEditMode = !!editServerId;
  const selectedServer = servers.find((s) => s.id === selectedServerId);
  const fields = selectedServer ? (credentialFields[selectedServer.type] ?? []) : [];

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedServerId || !selectedServer) return;
    const form = new FormData(e.currentTarget);
    const credentials: Record<string, string> = {};
    for (const field of fields) {
      const val = (form.get(field.name) as string | null)?.trim() ?? "";
      if (!val && !field.optional) return;
      if (val) credentials[field.name] = val;
    }
    onSubmit(selectedServerId, credentials);
    setSelectedServerId("");
  };

  const handleOpenChange = (val: boolean) => {
    if (!val) setSelectedServerId("");
    onOpenChange(val);
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <Dialog.Title className="text-lg font-semibold text-zinc-100">
            {isEditMode ? "Update MCP Connection" : "Connect to MCP Server"}
          </Dialog.Title>
          {servers.length === 0 ? (
            <div className="mt-4 rounded-lg border border-zinc-700 bg-zinc-800 p-4 text-center text-sm text-zinc-400">
              No MCP servers available.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="mcpServerId" className="mb-1 block text-sm font-medium text-zinc-300">
                  MCP Server
                </label>
                <select
                  id="mcpServerId"
                  name="mcpServerId"
                  required
                  value={selectedServerId}
                  onChange={(e) => setSelectedServerId(e.target.value)}
                  disabled={isEditMode}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
                >
                  <option value="">Select a server…</option>
                  {servers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedServer && (
                <>
                  {selectedServer.description && (
                    <p className="text-xs text-zinc-500">{selectedServer.description}</p>
                  )}
                  {fields.map((field) => (
                    <div key={field.name}>
                      <label
                        htmlFor={field.name}
                        className="mb-1 block text-sm font-medium text-zinc-300"
                      >
                        {field.label}
                        {field.optional && <span className="ml-1 text-xs text-zinc-500">(optional)</span>}
                      </label>
                      <input
                        id={field.name}
                        name={field.name}
                        type={field.type}
                        required={!field.optional}
                        placeholder={field.placeholder}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
                      />
                    </div>
                  ))}
                </>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={!selectedServerId}
                  className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isEditMode ? "Update" : "Connect"}
                </button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
