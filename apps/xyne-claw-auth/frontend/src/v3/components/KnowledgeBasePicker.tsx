/**
 * KnowledgeBasePicker — hierarchical drill-down picker for spaces KB grants.
 *
 * Hierarchy (mirrors spaces' data model):
 *   Projects → Channels → Collections → sub-folders → files
 *
 * UI is a two-pane layout:
 *   • Left  — breadcrumb + current-level list. Single click drills in;
 *             checkbox grants a whole node (collection or sub-folder); files
 *             carry their own checkbox.
 *   • Right — sticky "Selected" panel showing every grant as a chip with an
 *             ✕ to remove.
 *
 * Selection is emitted to the parent as `KbSelection[]`:
 *   fileId === null  → whole collection (or sub-folder; the agent-side handler
 *                      walks ancestry to honour it)
 *   fileId !== null  → single-file grant
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Folder,
  FolderOpen,
  Hash,
  Library,
  FileText,
  ChevronRight,
  X,
} from "lucide-react";
import { listAccessibleKnowledgeBase, type KbCollectionNode, type KbFile } from "../../lib/api";

export interface KbSelection {
  collectionId: string;
  fileId: string | null;
}

interface Props {
  value: KbSelection[];
  onChange: (next: KbSelection[]) => void;
  tree?: KbCollectionNode[];
  onTreeLoaded?: (tree: KbCollectionNode[]) => void;
}

/* ── data helpers ──────────────────────────────────────────────────── */

interface ProjectBucket {
  projectId: string;
  projectName: string;
  channels: ChannelBucket[];
}

interface ChannelBucket {
  channelId: string;
  channelName: string;
  collections: KbCollectionNode[];
}

const UNGROUPED_PROJECT_ID = "__ungrouped__";
const UNGROUPED_PROJECT_NAME = "Other";
const UNGROUPED_CHANNEL_NAME = "(no channel)";

function bucketByProjectChannel(tree: KbCollectionNode[]): ProjectBucket[] {
  const byProject = new Map<string, Map<string, KbCollectionNode[]>>();
  const projectNames = new Map<string, string>();
  const channelNames = new Map<string, string>();

  for (const root of tree) {
    const pid = root.projectId || UNGROUPED_PROJECT_ID;
    const cid = root.scopeType === "CHANNEL" ? root.scopeId : `${pid}::no-channel`;
    projectNames.set(pid, root.projectName || (pid === UNGROUPED_PROJECT_ID ? UNGROUPED_PROJECT_NAME : pid));
    channelNames.set(cid, root.channelName || UNGROUPED_CHANNEL_NAME);

    let chanMap = byProject.get(pid);
    if (!chanMap) {
      chanMap = new Map();
      byProject.set(pid, chanMap);
    }
    const list = chanMap.get(cid) ?? [];
    list.push(root);
    chanMap.set(cid, list);
  }

  return [...byProject.entries()]
    .map(([pid, chanMap]) => ({
      projectId: pid,
      projectName: projectNames.get(pid) ?? pid,
      channels: [...chanMap.entries()]
        .map(([cid, collections]) => ({
          channelId: cid,
          channelName: channelNames.get(cid) ?? cid,
          collections,
        }))
        .sort((a, b) => a.channelName.localeCompare(b.channelName)),
    }))
    .sort((a, b) => a.projectName.localeCompare(b.projectName));
}

function countFiles(n: KbCollectionNode): number {
  let total = n.items?.length ?? 0;
  for (const c of n.children ?? []) total += countFiles(c);
  return total;
}

function flatten(n: KbCollectionNode, out: { collections: Set<string>; files: Set<string> }): void {
  out.collections.add(n.id);
  for (const f of n.items ?? []) out.files.add(f.id);
  for (const c of n.children ?? []) flatten(c, out);
}

function indexSelection(value: KbSelection[]): { wholeCollections: Set<string>; files: Set<string> } {
  const wholeCollections = new Set<string>();
  const files = new Set<string>();
  for (const v of value) {
    if (v.fileId) files.add(v.fileId);
    else wholeCollections.add(v.collectionId);
  }
  return { wholeCollections, files };
}

function findNodeInTree(tree: KbCollectionNode[], id: string): KbCollectionNode | undefined {
  for (const root of tree) {
    if (root.id === id) return root;
    const walk = (n: KbCollectionNode): KbCollectionNode | undefined => {
      if (n.id === id) return n;
      for (const c of n.children ?? []) {
        const hit = walk(c);
        if (hit) return hit;
      }
      return undefined;
    };
    const hit = walk(root);
    if (hit) return hit;
  }
  return undefined;
}

function findFileInTree(tree: KbCollectionNode[], fileId: string): { file: KbFile; parent: KbCollectionNode } | undefined {
  const walk = (n: KbCollectionNode): { file: KbFile; parent: KbCollectionNode } | undefined => {
    for (const f of n.items ?? []) if (f.id === fileId) return { file: f, parent: n };
    for (const c of n.children ?? []) {
      const hit = walk(c);
      if (hit) return hit;
    }
    return undefined;
  };
  for (const root of tree) {
    const hit = walk(root);
    if (hit) return hit;
  }
  return undefined;
}

function isCollectionCoveredByAncestor(
  tree: KbCollectionNode[],
  node: KbCollectionNode,
  whole: Set<string>,
): boolean {
  // walk upward via rootCollectionId — for root nodes parentId is null
  if (whole.has(node.id)) return true;
  if (!node.parentId) return false;
  const parent = findNodeInTree(tree, node.parentId);
  if (!parent) return false;
  return isCollectionCoveredByAncestor(tree, parent, whole);
}

/* ── navigation state ─────────────────────────────────────────────── */

type Crumb =
  | { kind: "root" }
  | { kind: "project"; projectId: string; projectName: string }
  | { kind: "channel"; projectId: string; projectName: string; channelId: string; channelName: string }
  | { kind: "collection"; projectId: string; projectName: string; channelId: string; channelName: string; node: KbCollectionNode };

function topCrumb(stack: Crumb[]): Crumb {
  return stack[stack.length - 1] ?? { kind: "root" };
}

/* ── component ────────────────────────────────────────────────────── */

export function KnowledgeBasePicker({ value, onChange, tree: pretree, onTreeLoaded }: Props) {
  const [tree, setTree] = useState<KbCollectionNode[]>(pretree ?? []);
  const [loading, setLoading] = useState<boolean>(pretree === undefined);
  const [noSpacesSession, setNoSpacesSession] = useState(false);
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ kind: "root" }]);

  useEffect(() => {
    if (pretree !== undefined) return;
    setLoading(true);
    listAccessibleKnowledgeBase()
      .then((r) => {
        setTree(r.collections);
        setNoSpacesSession(r.noSpacesSession);
        onTreeLoaded?.(r.collections);
      })
      .catch(() => setTree([]))
      .finally(() => setLoading(false));
  }, [pretree, onTreeLoaded]);

  const projects = useMemo(() => bucketByProjectChannel(tree), [tree]);
  const { wholeCollections, files } = useMemo(() => indexSelection(value), [value]);

  /* ── selection mutators ──────────────────────────────────────────── */

  const grantCollection = (node: KbCollectionNode) => {
    // Drop redundant child grants under this node.
    const descendants = { collections: new Set<string>(), files: new Set<string>() };
    flatten(node, descendants);
    const next = value.filter(v => {
      if (v.fileId === null && descendants.collections.has(v.collectionId)) return false;
      if (v.fileId !== null && descendants.files.has(v.fileId)) return false;
      return true;
    });
    next.push({ collectionId: node.id, fileId: null });
    onChange(next);
  };
  const revokeCollection = (collectionId: string) => {
    onChange(value.filter(v => !(v.collectionId === collectionId && v.fileId === null)));
  };
  const toggleCollection = (node: KbCollectionNode) => {
    if (wholeCollections.has(node.id)) revokeCollection(node.id);
    else grantCollection(node);
  };
  const grantFile = (parent: KbCollectionNode, file: KbFile) => {
    if (isCollectionCoveredByAncestor(tree, parent, wholeCollections)) return;
    onChange([...value, { collectionId: parent.id, fileId: file.id }]);
  };
  const revokeFile = (fileId: string) => {
    onChange(value.filter(v => v.fileId !== fileId));
  };
  const toggleFile = (parent: KbCollectionNode, file: KbFile) => {
    if (files.has(file.id)) revokeFile(file.id);
    else grantFile(parent, file);
  };

  /* ── render ─────────────────────────────────────────────────────── */

  if (loading) return <div className="text-[12px] text-xyne-fg-tertiary">Loading your Knowledge Base…</div>;
  if (noSpacesSession) {
    return (
      <div className="rounded-md border border-xyne-border bg-xyne-surface-subtle px-3 py-2 text-[12px] text-xyne-fg-secondary">
        Sign in to spaces to attach Knowledge Base documents to this agent.
      </div>
    );
  }
  if (tree.length === 0) {
    return (
      <div className="rounded-md border border-xyne-border bg-xyne-surface-subtle px-3 py-2 text-[12px] text-xyne-fg-secondary">
        You don't have access to any Knowledge Base collections yet. Create one in spaces, or ask a teammate to share theirs.
      </div>
    );
  }

  const here = topCrumb(crumbs);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px]">
      {/* ── browser pane ─────────────────────────────────────────── */}
      <div className="rounded-md border border-xyne-border bg-xyne-surface">
        <BreadcrumbBar crumbs={crumbs} onJump={(idx) => setCrumbs(crumbs.slice(0, idx + 1))} />
        <div className="max-h-[420px] overflow-y-auto p-2">
          {here.kind === "root" && (
            <ProjectsList
              projects={projects}
              onOpen={(p) =>
                setCrumbs([...crumbs, { kind: "project", projectId: p.projectId, projectName: p.projectName }])
              }
            />
          )}
          {here.kind === "project" && (
            <ChannelsList
              channels={projects.find((p) => p.projectId === here.projectId)?.channels ?? []}
              onOpen={(c) =>
                setCrumbs([
                  ...crumbs,
                  {
                    kind: "channel",
                    projectId: here.projectId,
                    projectName: here.projectName,
                    channelId: c.channelId,
                    channelName: c.channelName,
                  },
                ])
              }
            />
          )}
          {here.kind === "channel" && (
            <CollectionsList
              collections={
                projects
                  .find((p) => p.projectId === here.projectId)
                  ?.channels.find((c) => c.channelId === here.channelId)?.collections ?? []
              }
              wholeCollections={wholeCollections}
              files={files}
              onOpen={(node) =>
                setCrumbs([
                  ...crumbs,
                  {
                    kind: "collection",
                    projectId: here.projectId,
                    projectName: here.projectName,
                    channelId: here.channelId,
                    channelName: here.channelName,
                    node,
                  },
                ])
              }
              onToggle={toggleCollection}
            />
          )}
          {here.kind === "collection" && (
            <FolderContents
              node={here.node}
              tree={tree}
              wholeCollections={wholeCollections}
              files={files}
              onDrill={(child) =>
                setCrumbs([
                  ...crumbs,
                  {
                    kind: "collection",
                    projectId: here.projectId,
                    projectName: here.projectName,
                    channelId: here.channelId,
                    channelName: here.channelName,
                    node: child,
                  },
                ])
              }
              onToggleCollection={toggleCollection}
              onToggleFile={toggleFile}
            />
          )}
        </div>
      </div>

      {/* ── selected sidebar ─────────────────────────────────────── */}
      <SelectedPanel
        value={value}
        tree={tree}
        onRevokeCollection={revokeCollection}
        onRevokeFile={revokeFile}
      />
    </div>
  );
}

/* ── breadcrumb ──────────────────────────────────────────────────── */

function BreadcrumbBar({ crumbs, onJump }: { crumbs: Crumb[]; onJump: (idx: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-xyne-border-subtle bg-xyne-surface-subtle px-2 py-1.5 text-[12px] text-xyne-fg-secondary">
      {crumbs.map((c, idx) => {
        const label =
          c.kind === "root"
            ? "Projects"
            : c.kind === "project"
              ? c.projectName
              : c.kind === "channel"
                ? c.channelName
                : c.node.name;
        const crumbIcon =
          c.kind === "root" ? null
            : c.kind === "project" ? <Folder size={12} />
            : c.kind === "channel" ? <Hash size={12} />
            : <Library size={12} />;
        const isLast = idx === crumbs.length - 1;
        return (
          <span key={idx} className="flex items-center gap-1">
            {idx > 0 && <ChevronRight size={12} className="text-xyne-fg-tertiary" />}
            <button
              type="button"
              disabled={isLast}
              onClick={() => onJump(idx)}
              className={`flex items-center gap-1 truncate rounded px-1.5 py-0.5 transition ${
                isLast
                  ? "cursor-default font-medium text-xyne-fg-primary"
                  : "hover:bg-xyne-surface hover:text-xyne-fg-primary"
              }`}
            >
              {crumbIcon}
              {label}
            </button>
          </span>
        );
      })}
    </div>
  );
}

/* ── level views ─────────────────────────────────────────────────── */

function Row({
  icon,
  primary,
  secondary,
  hasMore,
  onClick,
  selected,
  rightAccessory,
}: {
  icon: ReactNode;
  primary: string;
  secondary?: string;
  /** Show a chevron at the end to indicate "drills deeper". */
  hasMore?: boolean;
  onClick?: () => void;
  selected?: boolean;
  rightAccessory?: ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 transition ${
        selected
          ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500/60 dark:bg-emerald-900/20"
          : "border-xyne-border-subtle bg-xyne-surface hover:border-xyne-border-strong hover:bg-xyne-surface-subtle"
      } ${onClick ? "cursor-pointer" : ""}`}
      onClick={onClick}
    >
      <span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center text-xyne-fg-secondary">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-xyne-fg-primary">{primary}</div>
        {secondary && <div className="truncate text-[11px] text-xyne-fg-tertiary">{secondary}</div>}
      </div>
      {rightAccessory}
      {hasMore && <ChevronRight size={14} className="text-xyne-fg-tertiary" />}
    </div>
  );
}

function ProjectsList({ projects, onOpen }: { projects: ProjectBucket[]; onOpen: (p: ProjectBucket) => void }) {
  return (
    <div className="space-y-1.5">
      {projects.map((p) => {
        const channelCount = p.channels.length;
        const collectionCount = p.channels.reduce((acc, c) => acc + c.collections.length, 0);
        return (
          <Row
            key={p.projectId}
            icon={<Folder size={14} />}
            primary={p.projectName}
            secondary={`${channelCount} channel${channelCount === 1 ? "" : "s"} • ${collectionCount} collection${collectionCount === 1 ? "" : "s"}`}
            hasMore
            onClick={() => onOpen(p)}
          />
        );
      })}
    </div>
  );
}

function ChannelsList({ channels, onOpen }: { channels: ChannelBucket[]; onOpen: (c: ChannelBucket) => void }) {
  return (
    <div className="space-y-1.5">
      {channels.map((c) => (
        <Row
          key={c.channelId}
          icon={<Hash size={14} />}
          primary={c.channelName}
          secondary={`${c.collections.length} collection${c.collections.length === 1 ? "" : "s"}`}
          hasMore
          onClick={() => onOpen(c)}
        />
      ))}
    </div>
  );
}

function CollectionsList({
  collections,
  wholeCollections,
  files,
  onOpen,
  onToggle,
}: {
  collections: KbCollectionNode[];
  wholeCollections: Set<string>;
  files: Set<string>;
  onOpen: (n: KbCollectionNode) => void;
  onToggle: (n: KbCollectionNode) => void;
}) {
  return (
    <div className="space-y-1.5">
      {collections.map((n) => {
        const fileTotal = countFiles(n);
        const checked = wholeCollections.has(n.id);
        const grantedHere = checked
          ? fileTotal
          : (n.items?.filter((f) => files.has(f.id)).length ?? 0) +
            countDescendantGrantedFiles(n, files, wholeCollections);
        return (
          <Row
            key={n.id}
            icon={<Library size={14} />}
            primary={n.name}
            secondary={`${fileTotal} file${fileTotal === 1 ? "" : "s"}${grantedHere > 0 ? ` • ${grantedHere} selected` : ""}`}
            hasMore
            onClick={() => onOpen(n)}
            selected={checked}
            rightAccessory={
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(n);
                }}
                className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition ${
                  checked
                    ? "border-emerald-500 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
                    : "border-xyne-border bg-xyne-surface text-xyne-fg-secondary hover:border-xyne-border-strong"
                }`}
              >
                {checked ? "Granted" : "Grant all"}
              </button>
            }
          />
        );
      })}
    </div>
  );
}

function countDescendantGrantedFiles(n: KbCollectionNode, files: Set<string>, whole: Set<string>): number {
  let total = 0;
  for (const c of n.children ?? []) {
    if (whole.has(c.id)) total += countFiles(c);
    else {
      for (const f of c.items ?? []) if (files.has(f.id)) total++;
      total += countDescendantGrantedFiles(c, files, whole);
    }
  }
  return total;
}

function FolderContents({
  node,
  tree,
  wholeCollections,
  files,
  onDrill,
  onToggleCollection,
  onToggleFile,
}: {
  node: KbCollectionNode;
  tree: KbCollectionNode[];
  wholeCollections: Set<string>;
  files: Set<string>;
  onDrill: (child: KbCollectionNode) => void;
  onToggleCollection: (n: KbCollectionNode) => void;
  onToggleFile: (parent: KbCollectionNode, file: KbFile) => void;
}) {
  const covered = isCollectionCoveredByAncestor(tree, node, wholeCollections);
  const subFolders = node.children ?? [];
  const items = node.items ?? [];

  return (
    <div className="space-y-1.5">
      {subFolders.length === 0 && items.length === 0 && (
        <div className="rounded-md border border-dashed border-xyne-border-subtle py-6 text-center text-[12px] text-xyne-fg-tertiary">
          This folder is empty.
        </div>
      )}
      {subFolders.map((c) => {
        const checked = wholeCollections.has(c.id) || covered;
        return (
          <Row
            key={c.id}
            icon={<FolderOpen size={14} />}
            primary={c.name}
            secondary={`${countFiles(c)} file(s)`}
            hasMore
            onClick={() => onDrill(c)}
            selected={checked}
            rightAccessory={
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!covered) onToggleCollection(c);
                }}
                disabled={covered}
                className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition ${
                  checked
                    ? "border-emerald-500 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
                    : "border-xyne-border bg-xyne-surface text-xyne-fg-secondary hover:border-xyne-border-strong"
                } ${covered ? "cursor-not-allowed opacity-60" : ""}`}
                title={covered ? "Covered by a parent grant" : undefined}
              >
                {checked ? "Granted" : "Grant"}
              </button>
            }
          />
        );
      })}
      {items.map((f) => {
        const checked = files.has(f.id) || covered;
        return (
          <Row
            key={f.id}
            icon={<FileText size={14} />}
            primary={f.name}
            secondary={f.ingestionStatus !== "NONE" ? f.ingestionStatus.toLowerCase() : undefined}
            selected={checked}
            // Whole-row click toggles the file. Files have nothing to drill
            // into, so the row's only action is select/deselect — easier to
            // hit the label than the 14px checkbox.
            onClick={covered ? undefined : () => onToggleFile(node, f)}
            rightAccessory={
              <input
                type="checkbox"
                checked={checked}
                disabled={covered}
                // Stop propagation so the row's onClick doesn't double-toggle.
                onClick={(e) => e.stopPropagation()}
                onChange={() => onToggleFile(node, f)}
                className="h-3.5 w-3.5 accent-emerald-500"
              />
            }
          />
        );
      })}
    </div>
  );
}

/* ── selected sidebar ────────────────────────────────────────────── */

function SelectedPanel({
  value,
  tree,
  onRevokeCollection,
  onRevokeFile,
}: {
  value: KbSelection[];
  tree: KbCollectionNode[];
  onRevokeCollection: (id: string) => void;
  onRevokeFile: (id: string) => void;
}) {
  // Resolve labels for each chip from the loaded tree.
  const items = value.map((v) => {
    if (v.fileId) {
      const hit = findFileInTree(tree, v.fileId);
      return {
        key: `f:${v.fileId}`,
        label: hit?.file.name ?? v.fileId,
        sublabel: hit?.parent.name ?? "",
        onRemove: () => onRevokeFile(v.fileId!),
        kind: "file" as const,
      };
    }
    const hit = findNodeInTree(tree, v.collectionId);
    return {
      key: `c:${v.collectionId}`,
      label: hit?.name ?? v.collectionId,
      sublabel: hit?.channelName ? `#${hit.channelName}` : "",
      onRemove: () => onRevokeCollection(v.collectionId),
      kind: "collection" as const,
    };
  });

  return (
    <div className="rounded-md border border-xyne-border bg-xyne-surface">
      <div className="flex items-center justify-between border-b border-xyne-border-subtle bg-xyne-surface-subtle px-2 py-1.5">
        <span className="text-[12px] font-medium text-xyne-fg-primary">Selected</span>
        <span className="rounded-full bg-xyne-surface px-1.5 py-0.5 text-[10px] text-xyne-fg-tertiary">
          {value.length}
        </span>
      </div>
      <div className="max-h-[420px] space-y-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed border-xyne-border-subtle py-6 text-center text-[11px] text-xyne-fg-tertiary">
            Nothing selected yet.
          </div>
        ) : (
          items.map((it) => (
            <div
              key={it.key}
              className="flex items-start gap-1.5 rounded-md border border-xyne-border-subtle bg-xyne-surface px-1.5 py-1"
            >
              <span aria-hidden className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center text-xyne-fg-secondary">
                {it.kind === "file" ? <FileText size={12} /> : <Library size={12} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] text-xyne-fg-primary">{it.label}</div>
                {it.sublabel && (
                  <div className="truncate text-[10px] text-xyne-fg-tertiary">{it.sublabel}</div>
                )}
              </div>
              <button
                type="button"
                onClick={it.onRemove}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-xyne-fg-tertiary transition hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
                aria-label="Remove"
                title="Remove"
              >
                <X size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
