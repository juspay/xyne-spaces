/**
 * Shared BlockNote type definitions
 * Used by canvasService.ts, callDocumentService.ts and any future services
 * that build BlockNote-compatible JSON content.
 */

// ---------------------------------------------------------------------------
// Inline content
// ---------------------------------------------------------------------------

export interface BlockNoteTextInline {
    type: 'text';
    text: string;
    styles?: {
        bold?: boolean;
        italic?: boolean;
        code?: boolean;
    };
}

export interface BlockNoteMentionInline {
    type: 'mention';
    props: {
        userId: string;
        username: string;
        userEmail: string;
        userPicture: string;
        groupId?: string;
        groupName?: string;
    };
}
interface BlockNoteLinkContent {
    type: 'link';
    href: string;
    content: BlockNoteTextInline[];
}

/**
 * Inline citation chip in a call-summary canvas. Emitted by callDocumentService
 * from `[clf-<n>]` tokens the summariser LLM writes; each maps to one transcript
 * segment. Props are self-contained so the citation survives canvas regeneration
 * (no external map to keep in sync) — mirrors how mentions carry their own props.
 * The frontend CanvasCitationSpec renders these as a clickable chip that opens
 * the transcript at `timestamp`. Prop keys MUST match the frontend + server specs.
 */
export interface BlockNoteCitationInline {
    type: 'citation';
    props: {
        /** Call externalId — tells the chip which transcript to open. */
        callId: string;
        /** 1-based transcript segment number (display + ordering). */
        segment: string;
        /** Segment start time as "MM:SS" / "HH:MM:SS" — the transcript deep-link target. */
        timestamp: string;
        /** Speaker name for the cited segment. */
        speaker: string;
        /** Resolved participant userId for the speaker (best-effort; '' if unmatched) → real avatar. */
        speakerId: string;
        /** Short excerpt of the cited segment text (hover preview). */
        snippet: string;
        /** JSON array of ALL segments in this (possibly grouped) citation:
         *  `[{n,timestamp,speaker,speakerId,snippet}]`. Length 1 for a single citation. */
        segments: string;
    };
}

export type BlockNoteInlineContent = BlockNoteTextInline | BlockNoteMentionInline | BlockNoteLinkContent | BlockNoteCitationInline;

// ---------------------------------------------------------------------------
// Block types
// ---------------------------------------------------------------------------

export interface BlockNoteTextBlock {
    id: string;
    type: 'paragraph' | 'heading';
    props?: {
        level?: 1 | 2 | 3;
        textColor?: string;
        backgroundColor?: string;
        textAlignment?: 'left' | 'center' | 'right';
    };
    content: BlockNoteInlineContent[];
    children?: BlockNoteBlock[];
}

export interface BlockNoteCodeBlock {
    id: string;
    type: 'codeBlock';
    props?: {
        language?: string;
    };
    content: Array<{
        type: 'text';
        text: string;
        styles?: Record<string, never>;
    }>;
    children?: BlockNoteBlock[];
}

export interface BlockNoteBulletListBlock {
    id: string;
    type: 'bulletListItem' | 'numberedListItem';
    content: BlockNoteInlineContent[];
    children?: BlockNoteBlock[];
}

export interface BlockNoteDividerBlock {
    id: string;
    type: 'divider';
    props?: Record<string, never>;
    content: undefined;
    children?: BlockNoteBlock[];
}

export interface BlockNoteQuoteBlock {
    id: string;
    type: 'quote';
    props?: {
        textColor?: string;
        backgroundColor?: string;
    };
    content: BlockNoteInlineContent[];
    children?: BlockNoteBlock[];
}

// ---------------------------------------------------------------------------
// Table types
// ---------------------------------------------------------------------------

export interface BlockNoteTableCell {
    type: 'tableCell';
    content: BlockNoteInlineContent[];
}

export interface BlockNoteTableRow {
    cells: BlockNoteTableCell[];
}

export interface BlockNoteTableContent {
    type: 'tableContent';
    rows: BlockNoteTableRow[];
    columnWidths?: (number | undefined)[];
    headerRows?: number;
    headerCols?: number;
}

export interface BlockNoteTableBlock {
    id: string;
    type: 'table';
    props?: Record<string, unknown>;
    content: BlockNoteTableContent;
    children?: BlockNoteBlock[];
}

// ---------------------------------------------------------------------------
// Union of all block types
// ---------------------------------------------------------------------------

export type BlockNoteBlock =
    | BlockNoteTextBlock
    | BlockNoteCodeBlock
    | BlockNoteBulletListBlock
    | BlockNoteTableBlock
    | BlockNoteDividerBlock
    | BlockNoteQuoteBlock;
