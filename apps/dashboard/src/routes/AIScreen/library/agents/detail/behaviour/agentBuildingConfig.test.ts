import { describe, expect, it } from 'vitest';
import {
  applyAgentBuildingTool,
  CREATE_AGENT_TOOL,
  readAgentBuilding,
  UPDATE_AGENT_TOOL,
} from './agentBuildingConfig';

describe('readAgentBuilding', () => {
  it('reads each tool from the custom selection', () => {
    const config = { tools: { custom: ['web-search', CREATE_AGENT_TOOL] } };

    expect(readAgentBuilding(config, 'standard')).toEqual({
      create: true,
      update: false,
      allTools: false,
    });
  });

  it('is off for an agent with no tools config', () => {
    expect(readAgentBuilding(undefined, undefined)).toEqual({
      create: false,
      update: false,
      allTools: false,
    });
  });

  it('marks an orchestrator with nothing selected as having every tool', () => {
    expect(readAgentBuilding({ tools: { custom: [] } }, 'orchestrator')).toEqual({
      create: true,
      update: true,
      allTools: true,
    });
  });

  it('reads an orchestrator with a selection like any other agent', () => {
    expect(readAgentBuilding({ tools: { custom: [UPDATE_AGENT_TOOL] } }, 'orchestrator')).toEqual({
      create: false,
      update: true,
      allTools: false,
    });
    expect(readAgentBuilding({ tools: { openPalette: 'all' } }, 'orchestrator').allTools).toBe(
      false,
    );
  });
});

describe('applyAgentBuildingTool', () => {
  it('adds the tool and keeps the rest of the config untouched', () => {
    const config = {
      verifyResponses: true,
      tools: { subagents: ['github'], custom: ['web-search'], openPalette: 'read' },
    };

    expect(applyAgentBuildingTool(config, CREATE_AGENT_TOOL, true)).toEqual({
      verifyResponses: true,
      tools: {
        subagents: ['github'],
        custom: ['web-search', CREATE_AGENT_TOOL],
        openPalette: 'read',
      },
    });
  });

  it('removes only the given tool', () => {
    const config = { tools: { custom: [CREATE_AGENT_TOOL, UPDATE_AGENT_TOOL, 'web-search'] } };

    expect(applyAgentBuildingTool(config, CREATE_AGENT_TOOL, false)).toEqual({
      tools: { custom: [UPDATE_AGENT_TOOL, 'web-search'] },
    });
  });

  it('never lists a tool twice', () => {
    const config = { tools: { custom: [UPDATE_AGENT_TOOL] } };

    expect(applyAgentBuildingTool(config, UPDATE_AGENT_TOOL, true)).toEqual({
      tools: { custom: [UPDATE_AGENT_TOOL] },
    });
  });

  it('creates the selection when the agent has none', () => {
    expect(applyAgentBuildingTool(undefined, UPDATE_AGENT_TOOL, true)).toEqual({
      tools: { custom: [UPDATE_AGENT_TOOL] },
    });
  });
});
