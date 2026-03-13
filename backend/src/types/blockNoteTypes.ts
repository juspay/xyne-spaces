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


export type BlockNoteInlineContent = BlockNoteTextInline | BlockNoteMentionInline | BlockNoteLinkContent;

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
