import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftIcon,
  SparkleIcon,
  FloppyDiskIcon,
  TrashIcon,
  SpinnerGapIcon,
  CheckCircleIcon,
} from "@phosphor-icons/react";
import {
  listDigitalTwinMemoryFiles,
  saveDigitalTwinMemoryFile,
  setDigitalTwinMemoryFileLoad,
  deleteDigitalTwinMemoryFile,
  synthesizeDigitalTwin,
  type DigitalTwinMemoryFile,
} from "../../../lib/api";

const SERIF = { fontFamily: "var(--comp-font-serif)" } as const;

interface Props {
  userId: string;
  onBack: () => void;
}

/**
 * Persona / memory-files editor. The deterministic file layer (soul.md, …) the
 * Twin always reads. Edit content, and toggle up to `maxLoaded` files into the
 * system prompt. "Rebuild" recompiles them from your approved memories.
 */
export function DigitalTwinFilesTab({ userId, onBack }: Props) {
  const [files, setFiles] = useState<DigitalTwinMemoryFile[]>([]);
  const [maxLoaded, setMaxLoaded] = useState(3);
  const [maxChars, setMaxChars] = useState(20_000);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(
    async (keepSelection = true) => {
      try {
        const res = await listDigitalTwinMemoryFiles(userId);
        setFiles(res.files);
        setMaxLoaded(res.maxLoaded);
        setMaxChars(res.maxChars);
        setSelected((cur) => {
          if (keepSelection && cur && res.files.some((f) => f.name === cur)) return cur;
          return res.files[0]?.name ?? null;
        });
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load files");
      } finally {
        setLoading(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const current = useMemo(() => files.find((f) => f.name === selected) ?? null, [files, selected]);
  const loadedCount = files.filter((f) => f.loadInPrompt).length;

  // Sync the editor draft when the selected file changes.
  useEffect(() => {
    setDraft(current?.content ?? "");
    setSavedFlash(false);
  }, [current?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = current != null && draft !== current.content;

  const onSave = async () => {
    if (!current || !dirty) return;
    setSaving(true);
    setErr(null);
    try {
      const { file } = await saveDigitalTwinMemoryFile(userId, current.name, draft);
      setFiles((fs) => fs.map((f) => (f.name === file.name ? file : f)));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1600);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onToggleLoad = async (file: DigitalTwinMemoryFile) => {
    setErr(null);
    try {
      const { file: updated } = await setDigitalTwinMemoryFileLoad(userId, file.name, !file.loadInPrompt);
      setFiles((fs) => fs.map((f) => (f.name === updated.name ? updated : f)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not change load state");
    }
  };

  const onDelete = async (file: DigitalTwinMemoryFile) => {
    if (!window.confirm(`Delete ${file.name}? This can't be undone.`)) return;
    setErr(null);
    try {
      await deleteDigitalTwinMemoryFile(userId, file.name);
      await load(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const onRebuild = async () => {
    setRebuilding(true);
    setErr(null);
    try {
      await synthesizeDigitalTwin(userId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start rebuild");
      setRebuilding(false);
      return;
    }
    // Background job (~30-60s). Poll a few times so files refresh as they land.
    let ticks = 0;
    const iv = setInterval(async () => {
      ticks += 1;
      await load(true);
      if (ticks >= 9) {
        clearInterval(iv);
        setRebuilding(false);
      }
    }, 5000);
  };

  const overCap = draft.length > maxChars;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-xyne-surface">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-[14px] border-b border-xyne-border px-[24px] py-[14px]">
        <button
          onClick={onBack}
          className="flex items-center gap-[6px] rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[6px] text-[12px] font-medium text-xyne-fg-secondary transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
        >
          <ArrowLeftIcon size={14} />
          Overview
        </button>
        <div className="min-w-0">
          <h1 className="text-[19px] leading-tight text-xyne-fg-primary" style={SERIF}>
            Persona
          </h1>
          <p className="text-[12px] text-xyne-fg-secondary">
            The files your Twin always reads. Toggle up to {maxLoaded} into its prompt so it speaks as you with no lookups.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-[10px]">
          <span className="font-mono text-[11px] text-xyne-fg-tertiary">
            {loadedCount}/{maxLoaded} loaded
          </span>
          <button
            onClick={onRebuild}
            disabled={rebuilding}
            className="flex items-center gap-[6px] rounded-lg border border-xyne-border bg-xyne-surface px-[11px] py-[6px] text-[12px] font-medium text-xyne-fg-secondary shadow-sm transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary disabled:opacity-60"
            title="Recompile these files from the memories you've approved"
          >
            {rebuilding ? <SpinnerGapIcon size={14} className="animate-spin" /> : <SparkleIcon size={14} weight="duotone" />}
            {rebuilding ? "Rebuilding…" : "Rebuild from memories"}
          </button>
        </div>
      </div>

      {err && (
        <div className="shrink-0 border-b border-xyne-border bg-xyne-error-bg px-[24px] py-[8px] text-[12px] text-xyne-error-fg">
          {err}
        </div>
      )}

      {/* Body: file list + editor */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* File list */}
        <aside className="w-[264px] shrink-0 overflow-y-auto border-r border-xyne-border">
          {loading ? (
            <div className="flex items-center gap-[8px] p-[20px] text-[12px] text-xyne-fg-muted">
              <SpinnerGapIcon size={14} className="animate-spin" /> Loading…
            </div>
          ) : files.length === 0 ? (
            <p className="p-[20px] text-[12px] text-xyne-fg-muted">No files yet.</p>
          ) : (
            files.map((f) => {
              const active = f.name === selected;
              return (
                <button
                  key={f.name}
                  onClick={() => setSelected(f.name)}
                  className={`flex w-full flex-col gap-[3px] border-b border-xyne-border px-[16px] py-[11px] text-left transition ${
                    active ? "bg-xyne-surface-sunken" : "hover:bg-xyne-surface-sunken/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-[8px]">
                    <span className="truncate font-mono text-[12.5px] text-xyne-fg-primary">{f.name}</span>
                    {f.loadInPrompt && (
                      <span className="flex items-center gap-[3px] rounded-full bg-xyne-success-fg/12 px-[6px] py-[1px] text-[9px] font-semibold uppercase tracking-wide text-xyne-success-fg">
                        <CheckCircleIcon size={10} weight="fill" /> loaded
                      </span>
                    )}
                  </div>
                  <span className="text-[10.5px] text-xyne-fg-tertiary">
                    {f.content.length.toLocaleString()} chars
                    {f.updatedBy ? ` · ${f.updatedBy}` : ""}
                  </span>
                </button>
              );
            })
          )}
        </aside>

        {/* Editor */}
        {current ? (
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-[12px] border-b border-xyne-border px-[20px] py-[10px]">
              <span className="font-mono text-[13px] text-xyne-fg-primary">{current.name}</span>

              {/* Load-into-prompt toggle */}
              <button
                onClick={() => onToggleLoad(current)}
                className={`flex items-center gap-[6px] rounded-full border px-[10px] py-[3px] text-[11px] font-medium transition ${
                  current.loadInPrompt
                    ? "border-xyne-success-fg/40 bg-xyne-success-fg/10 text-xyne-success-fg"
                    : "border-xyne-border bg-xyne-surface text-xyne-fg-secondary hover:bg-xyne-surface-sunken"
                }`}
                title={
                  current.loadInPrompt
                    ? "Loaded into the Twin's system prompt"
                    : loadedCount >= maxLoaded
                      ? `You already load ${maxLoaded} files — unload one first`
                      : "Load this file into the Twin's system prompt"
                }
              >
                <span
                  className={`inline-block h-[7px] w-[7px] rounded-full ${
                    current.loadInPrompt ? "bg-xyne-success-fg" : "bg-xyne-fg-muted"
                  }`}
                />
                {current.loadInPrompt ? "Loaded in prompt" : "Load in prompt"}
              </button>

              <div className="ml-auto flex items-center gap-[8px]">
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    overCap ? "text-xyne-error-fg" : draft.length > maxChars * 0.9 ? "text-xyne-warning-fg" : "text-xyne-fg-tertiary"
                  }`}
                >
                  {draft.length.toLocaleString()} / {maxChars.toLocaleString()}
                </span>
                <button
                  onClick={() => onDelete(current)}
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-lg border border-xyne-border text-xyne-fg-tertiary transition hover:border-xyne-error-fg/40 hover:text-xyne-error-fg"
                  title="Delete file"
                >
                  <TrashIcon size={14} />
                </button>
                <button
                  onClick={onSave}
                  disabled={!dirty || saving}
                  className={`flex items-center gap-[6px] rounded-lg px-[12px] py-[6px] text-[12px] font-semibold transition ${
                    dirty && !saving
                      ? "bg-xyne-fg-primary text-white hover:opacity-90"
                      : "cursor-default bg-xyne-surface-sunken text-xyne-fg-muted"
                  }`}
                >
                  {saving ? (
                    <SpinnerGapIcon size={13} className="animate-spin" />
                  ) : savedFlash ? (
                    <CheckCircleIcon size={13} weight="fill" />
                  ) : (
                    <FloppyDiskIcon size={13} />
                  )}
                  {savedFlash ? "Saved" : "Save"}
                </button>
              </div>
            </div>

            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              placeholder="Write this persona file in markdown…"
              className="min-h-0 flex-1 resize-none bg-xyne-surface px-[24px] py-[18px] font-mono text-[13px] leading-relaxed text-xyne-fg-primary outline-none placeholder:text-xyne-fg-muted"
            />
          </main>
        ) : (
          !loading && (
            <div className="flex flex-1 items-center justify-center text-[13px] text-xyne-fg-muted">
              Select a file to edit
            </div>
          )
        )}
      </div>
    </div>
  );
}
