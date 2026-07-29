import * as Dialog from "@radix-ui/react-dialog";
import { type FormEvent } from "react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (externalUserId: string, userId: string) => void;
  currentUserId: string;
}

export function LinkIdentityDialog({ open, onOpenChange, onSubmit, currentUserId }: Props) {
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const externalUserId = (form.get("externalUserId") as string | null)?.trim() ?? "";
    const userId = (form.get("userId") as string | null)?.trim() ?? "";
    if (!externalUserId || !userId) return;
    onSubmit(externalUserId, userId);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <Dialog.Title className="text-lg font-semibold text-zinc-100">
            Link External User
          </Dialog.Title>
          <p className="mt-1 text-sm text-zinc-400">
            Map an external user ID (e.g., Slack user) to a Xyne Spaces account.
          </p>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label htmlFor="externalUserId" className="mb-1 block text-sm font-medium text-zinc-300">
                External User ID
              </label>
              <input
                id="externalUserId"
                name="externalUserId"
                type="text"
                required
                placeholder="e.g. U04ABC123 (Slack user ID)"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label htmlFor="userId" className="mb-1 block text-sm font-medium text-zinc-300">
                Xyne Spaces User ID
              </label>
              <input
                id="userId"
                name="userId"
                type="text"
                required
                defaultValue={currentUserId}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
              />
              <p className="mt-1 text-xs text-zinc-500">Pre-filled with your ID. Change to link a different user.</p>
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
                Link
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
