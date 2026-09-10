import { useState, type ReactElement, type CSSProperties } from 'react';
import type { FSNode } from './FilesystemBlock.types';
import { getPaletteEntry } from './FilesystemBlock.utils';

function palette(i: number) {
  const e = getPaletteEntry(i);
  return { bg: e.fill, border: e.stroke, text: e.text };
}

// ─── Leaf card at top level (white box, non-drillable) ────────────────────────

function LeafCard({ node }: { node: FSNode }): ReactElement {
  const style: CSSProperties = {
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: 10,
    padding: '14px 16px',
    minWidth: 110,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  };

  return (
    <div style={style}>
      <span
        style={{
          fontSize: 13,
          color: '#1E293B',
          fontFamily: 'Inter, ui-sans-serif, sans-serif',
          textAlign: 'center',
          wordBreak: 'break-word',
          fontWeight: 500,
        }}
      >
        {node.name}
      </span>
      {(node.size ?? node.meta) && (
        <span
          style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'Inter, ui-sans-serif, sans-serif' }}
        >
          {node.size ?? node.meta}
        </span>
      )}
    </div>
  );
}

// ─── Container card (colored box, drillable) ──────────────────────────────────

interface ContainerCardProps {
  node: FSNode;
  colorIndex: number;
  onDrillIn: (node: FSNode) => void;
}

function ContainerCard({ node, colorIndex, onDrillIn }: ContainerCardProps): ReactElement {
  const [hovered, setHovered] = useState(false);
  const c = palette(colorIndex);

  const cardStyle: CSSProperties = {
    background: c.bg,
    border: `2px solid ${c.border}`,
    borderRadius: 12,
    padding: '14px 16px 28px',
    minWidth: 180,
    flex: '1 1 200px',
    maxWidth: 340,
    cursor: 'pointer',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    boxShadow: hovered ? `0 6px 20px ${c.border}33` : '0 1px 4px rgba(0,0,0,0.07)',
    filter: hovered ? 'brightness(0.97)' : 'none',
    transition: 'box-shadow 0.15s, filter 0.15s',
    userSelect: 'none',
  };

  return (
    <div
      style={cardStyle}
      onClick={() => onDrillIn(node)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role='button'
      tabIndex={0}
      aria-label={`Open ${node.name}`}
      data-track-category='filesystem_graph'
      data-track-name='drill_in_container'
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onDrillIn(node);
        }
      }}
    >
      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: c.text,
          fontFamily: 'Inter, ui-sans-serif, sans-serif',
          letterSpacing: '0.01em',
        }}
      >
        {node.name}
      </span>

      <span
        style={{
          position: 'absolute',
          bottom: 7,
          right: 12,
          fontSize: 10,
          color: c.border,
          fontFamily: 'Inter, ui-sans-serif, sans-serif',
          opacity: 0.8,
        }}
      >
        click to explore ›
      </span>
    </div>
  );
}

// ─── Main graph ───────────────────────────────────────────────────────────────

export interface FilesystemGraphProps {
  root: FSNode;
  onDrillIn: (node: FSNode) => void;
}

export function FilesystemGraph({ root, onDrillIn }: FilesystemGraphProps): ReactElement {
  const children = root.children ?? [];
  const containers = children.filter(c => (c.children?.length ?? 0) > 0);
  const leaves = children.filter(c => !c.children?.length);

  if (children.length === 0) {
    return (
      <p
        style={{
          fontSize: 13,
          color: '#94A3B8',
          fontFamily: 'Inter, ui-sans-serif, sans-serif',
          margin: 0,
        }}
      >
        Empty
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
      {containers.map((child, i) => (
        <ContainerCard
          key={`${child.name}-${i}`}
          node={child}
          colorIndex={i}
          onDrillIn={onDrillIn}
        />
      ))}
      {leaves.map((child, i) => (
        <LeafCard key={`${child.name}-${i}`} node={child} />
      ))}
    </div>
  );
}
