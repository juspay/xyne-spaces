/**
 * Allowlist of Vespa `file` fields the dashboard Vespa inspector may see.
 * Anything not listed (permissions, ownerId, channelPermissions, workspaceId,
 * chunk_embeddings, image_chunk_embeddings, ...) is dropped.
 */
export const INSPECTABLE_VESPA_FILE_FIELDS: ReadonlyArray<string> = [
    'fileName',
    'mimeType',
    'fileSize',
    'description',
    'ai_summary',
    'metadata',
    'chunks',
    'chunks_summary',
    'chunks_pos',
    'chunks_pos_summary',
    'chunks_map',
    'image_chunks',
    'image_chunks_summary',
    'image_chunks_pos',
    'image_chunks_pos_summary',
    'image_chunks_map',
    'toc_chunks',
    'toc_chunks_summary',
    'headings',
    'block_labels',
    'entities_involved',
    'referenced_ids',
    'bboxes_json',
    'createdAt',
    'updatedAt',
];

export const pickInspectableVespaFields = (fields: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const key of INSPECTABLE_VESPA_FILE_FIELDS) {
        if (fields[key] !== undefined) out[key] = fields[key];
    }
    return out;
};
