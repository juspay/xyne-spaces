import * as Dialog from "@radix-ui/react-dialog";
import { type FormEvent } from "react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (type: string, name: string) => void;
}

export function AddGatewayDialog({ open, onOpenChange, onSubmit }: Props) {
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const type = (form.get("type") as string | null)?.trim() ?? "";
    const name = (form.get("name") as string | null)?.trim() ?? "";
    if (!type || !name) return;
    onSubmit(type, name);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <Dialog.Title className="text-lg font-semibold text-zinc-100">
            Add Gateway
          </Dialog.Title>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label htmlFor="gw-type" className="mb-1 block text-sm font-medium text-zinc-300">
                Type
              </label>
              <input
                id="gw-type"
                name="type"
                type="text"
                required
                placeholder="e.g. slack, telegram"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label htmlFor="gw-name" className="mb-1 block text-sm font-medium text-zinc-300">
                Display Name
              </label>
              <input
                id="gw-name"
                name="name"
                type="text"
                required
                placeholder="e.g. Slack, Telegram"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
              />
            </div>
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
                className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-300"
              >
                Create
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
