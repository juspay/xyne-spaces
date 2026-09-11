import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { listSkills, type Skill } from "../../lib/api";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Viewer's id — without it the listing is global-scope only and the viewer's
   *  own personal skills are invisible here. */
  userId?: string;
  /** Currently-selected skill IDs (controlled). */
  selectedIds: string[];
  /** Called with the full new selection when the user clicks Apply. */
  onApply: (nextIds: string[]) => void;
}

export function SkillPickerDialog({ open, onOpenChange, userId, selectedIds, onApply }: Props) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setSelected(new Set(selectedIds));
  }, [open, selectedIds]);

  // Cache the listing per userId rather than "once ever": the previous guard
  // (skills.length > 0) meant a userId arriving after the first fetch could
  // never refresh the list, so the viewer's personal skills stayed missing for
  // the component's lifetime — the exact bug passing userId is meant to fix.
  const fetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const key = userId ?? "";
    if (fetchedFor.current === key) return;
    fetchedFor.current = key;
    setLoading(true);
    listSkills(userId)
      .then(setSkills)
      .catch(() => { fetchedFor.current = null; })
      .finally(() => setLoading(false));
  }, [open, userId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q),
    );
  }, [skills, search]);

  const hasChanges =
    selected.size !== selectedIds.length ||
    [...selected].some((id) => !selectedIds.includes(id));

  const handleApply = () => {
    onApply([...selected]);
    onOpenChange(false);
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add skills"
      description="Skills inject reusable knowledge or instructions into the agent's context."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleApply}
            disabled={!hasChanges}
          >
            Apply ({selected.size})
          </Button>
        </>
      }
    >
      <div className="relative">
        <MagnifyingGlassIcon
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xyne-fg-tertiary"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills…"
          className="w-full rounded-full border border-xyne-border bg-xyne-surface py-2 pl-9 pr-3 text-[14px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:shadow-[var(--comp-focus-ring)] focus:outline-none"
        />
      </div>

      <div className="space-y-2">
        {loading && (
          <p className="py-8 text-center text-[14px] text-xyne-fg-tertiary">Loading skills…</p>
        )}
        {!loading && filtered.length === 0 && (
          <p className="py-8 text-center text-[14px] text-xyne-fg-tertiary">
            {search.trim() ? `No skills match "${search}".` : "No skills available."}
          </p>
        )}
        {!loading && filtered.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {filtered.map((skill) => (
              <Badge
                key={skill.id}
                label={skill.name || skill.slug}
                selected={selected.has(skill.id)}
                variant="neutral"
                interactive
                onClick={() => toggle(skill.id)}
              />
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
