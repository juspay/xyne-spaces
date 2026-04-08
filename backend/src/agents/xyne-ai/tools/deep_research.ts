import { z } from 'zod';
import { type Tool } from '@xynehq/jaf';
import { config } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import type { XyneAIAgentContext } from './types.js';
import { createCreateCanvasTool } from './create_canvas.js';

const RESEARCH_CONFIG = {
    max_concurrent_research_units: 1,
    max_researcher_iterations:     1,
    max_react_tool_calls:          2,
    allow_clarification:           false,
};

const NODE_PROGRESS: Record<string, string> = {
    clarify_with_user:       'Clarifying research scope…',
    write_research_brief:    'Writing research brief…',
    research_supervisor:     'Planning research tasks…',
    supervisor:              'Delegating to research agents…',
    researcher:              'Researching web sources…',
    compress_research:       'Compressing research notes…',
    final_report_generation: 'Writing final report…',
};

export function createDeepResearchTool(): Tool<{ topic: string }, XyneAIAgentContext> {
    if (!config.xyneAiExtended.url) {
        return {
            schema: {
                name: 'deep_research',
                description: 'Deep research is not configured. Contact administrator to enable.',
                parameters: z.object({ topic: z.string().describe('The research topic') }),
            },
            execute: async () => 'Error: Deep research is not configured. Please set XYNE_AI_EXTENDED_URL environment variable.',
        };
    }

    return {
        schema: {
            name: 'deep_research',
            description:
                'Performs comprehensive multi-step deep research on a topic: generates sub-queries, runs parallel web searches, synthesizes a report, and saves it to a canvas. Use for complex research questions. Takes 1–10 minutes.',
            parameters: z.object({
                topic: z.string()
                    .min(1, 'Research topic cannot be empty')
                    .max(2000, 'Research topic too long')
                    .describe('The research topic or question to investigate in depth'),
            }),
        },
        execute: async (args, context) => {
            const { topic } = args;
            const { sessionId, onStreamEvent } = context;
            const xyneAiExtendedUrl = config.xyneAiExtended.url;

            logger.info(`[Tool] [${sessionId}] deep_research: Starting, topic_length=${topic.length}`);
            onStreamEvent?.({ type: 'deep_research_start', toolName: 'deep_research', topic });

            let threadId: string | null = null;
            let runId: string | null = null;

            try {
                // Create LangGraph thread
                const createRes = await fetch(`${xyneAiExtendedUrl}/deep_research/threads`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                    signal: AbortSignal.timeout(30_000),
                });
                if (!createRes.ok) return `Error: Failed to create research thread (HTTP ${createRes.status}).`;

                ({ thread_id: threadId } = await createRes.json() as { thread_id: string });
                if (!threadId) return 'Error: No thread_id returned from deep research service.';

                logger.info(`[Tool] [${sessionId}] deep_research: Thread created ${threadId}`);

                // Start streaming run
                const streamRes = await fetch(
                    `${xyneAiExtendedUrl}/deep_research/threads/${threadId}/runs/stream`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            assistant_id: 'Deep Researcher',
                            stream_mode: ['events'],
                            config: { configurable: RESEARCH_CONFIG },
                            input: { messages: [{ role: 'human', content: topic }] },
                        }),
                    },
                );
                if (!streamRes.ok || !streamRes.body) {
                    return `Error: Failed to start research stream (HTTP ${streamRes.status}).`;
                }

                // Consume SSE stream: capture run_id + emit progress events
                const reader = streamRes.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let currentSseEvent = '';

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() ?? '';

                        for (const line of lines) {
                            if (line.startsWith('event: ')) {
                                currentSseEvent = line.slice(7).trim();
                                continue;
                            }
                            if (!line.startsWith('data: ')) continue;

                            const rawData = line.slice(6).trim();
                            if (!rawData || rawData === '[DONE]') continue;

                            try {
                                const parsed = JSON.parse(rawData) as Record<string, unknown>;

                                if (currentSseEvent === 'metadata' && typeof parsed.run_id === 'string') {
                                    runId = parsed.run_id;
                                    continue;
                                }
                                if (currentSseEvent !== 'events') continue;

                                const lcEvent = parsed.event as string | undefined;
                                const lcName  = parsed.name  as string | undefined;

                                if (lcEvent === 'on_chain_start' && lcName && onStreamEvent) {
                                    const label = NODE_PROGRESS[lcName];
                                    if (label) onStreamEvent({ type: 'deep_research_progress', toolName: 'deep_research', step: label });
                                }
                            } catch { /* non-JSON SSE line, skip */ }
                        }
                    }
                } finally {
                    reader.releaseLock();
                }

                // Fetch final report from settled thread state
                const stateRes = await fetch(`${xyneAiExtendedUrl}/deep_research/threads/${threadId}/state`);
                const finalReport = stateRes.ok
                    ? ((await stateRes.json() as { values?: { final_report?: string } }).values?.final_report ?? '')
                    : '';

                logger.info(`[Tool] [${sessionId}] deep_research: Done, has_report=${finalReport.length > 0}`);

                if (!finalReport) {
                    return 'DEEP_RESEARCH_DONE. No report was generated — do not retry this tool.';
                }

                // Save to canvas
                const canvasTitle = topic.length > 80 ? topic.slice(0, 80) + '…' : topic;
                const canvasResult = await createCreateCanvasTool().execute({ markdown: finalReport, title: canvasTitle }, context);
                const canvasUrl = (typeof canvasResult === 'string' ? canvasResult : '').match(/URL: (.+)/)?.[1]?.trim() ?? null;

                onStreamEvent?.({ type: 'deep_research_complete', toolName: 'deep_research', hasCanvas: !!canvasUrl, canvasUrl: canvasUrl ?? undefined });

                return canvasUrl
                    ? `DEEP_RESEARCH_DONE. Canvas URL: ${canvasUrl}`
                    : `DEEP_RESEARCH_DONE. Canvas creation failed — do not call create_canvas.`;

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                logger.error(`[Tool] [${sessionId}] deep_research error:`, error);
                onStreamEvent?.({ type: 'deep_research_error', toolName: 'deep_research', error: errorMessage });

                // Cancel orphan run on user cancel or any mid-stream error
                if (threadId && runId) {
                    fetch(`${xyneAiExtendedUrl}/deep_research/threads/${threadId}/runs/${runId}/cancel`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ wait: false }),
                    }).catch(err => logger.warn(`[Tool] deep_research: Cancel failed for run ${runId}:`, err));
                }

                return `Error: ${errorMessage}`;
            }
        },
    };
}
