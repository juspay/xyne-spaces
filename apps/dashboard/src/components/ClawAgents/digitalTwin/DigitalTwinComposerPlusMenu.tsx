import { type KeyboardEvent, type ReactElement, type ReactNode, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Bot,
  ChevronRight,
  FocusTarget,
  Globe,
  GraduationHat,
  Notebook,
  PaperclipSlant,
  Plus,
  Search,
  Settings,
  Sparkles,
  Staroflife,
} from './icons';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { useClawAuthAgents } from '@/hooks/useClawAuthAgents';
import { useClawSkills } from '@/hooks/useClawSkills';
import { useClawKnowledgeBaseTree } from '@/hooks/useClawKnowledgeBaseTree';
import { useClawResearchAgentOptions } from '@/hooks/useClawResearchAgentOptions';
import {
  AGENT_CATEGORIES,
  getCategoryDefinition,
  groupAgentsByCategory,
  groupSkillsByCategory,
} from '@/services/claw/agentCategory';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { Skill } from '@/services/claw/clawSkillsTypes';
import type { KbCollectionNode } from '@/services/claw/clawKnowledgeBaseTypes';
import type { ResearchAgentOption } from '@/services/claw/clawToolsTypes';
import type { ComposerContext } from '@/components/AIScreen/composerContext';
import type { ResearchContext } from '@xyne/shared';

const MENU_ITEM = 'dt-filter-menu-item';
const MENU_LABEL = 'dt-filter-menu-item-label';
const SUB_CONTENT = 'dt-filter-menu-content dt-filter-menu-sub';
const SUBMENU_VIEWPORT_PADDING = 24;

const initials = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

const flattenCollections = (nodes: KbCollectionNode[]): { id: string; name: string }[] => {
  const out: { id: string; name: string }[] = [];
  const walk = (node: KbCollectionNode): void => {
    out.push({ id: node.id, name: node.name });
    node.children?.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
};

const stopMenuTypeahead = (event: KeyboardEvent): void => {
  event.stopPropagation();
};

const SearchRow = ({
  value,
  onChange,
  placeholder,
  trackName,
  trailing,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  trackName: string;
  trailing?: ReactNode;
}): ReactElement => (
  <div className='dt-filter-menu-search'>
    <Search aria-hidden />
    <input
      type='search'
      value={value}
      onChange={event => onChange(event.target.value)}
      onKeyDown={stopMenuTypeahead}
      placeholder={placeholder}
      aria-label={placeholder}
      data-track-category='Claw Agents'
      data-track-name={trackName}
    />
    {trailing}
  </div>
);

const EmptyRow = ({ children }: { children: ReactNode }): ReactElement => (
  <p className='dt-filter-menu-empty'>{children}</p>
);

export const DigitalTwinComposerPlusMenu = ({
  extras,
  onExtrasChange,
  onInsertSnippet,
  onUpload,
}: {
  extras: ComposerContext;
  onExtrasChange: (next: ComposerContext) => void;
  onInsertSnippet: (snippet: string) => void;
  onUpload: () => void;
}): ReactElement => {
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const prefixWs = (path: string): string => (workspaceId ? `/${workspaceId}${path}` : path);

  const [agentQuery, setAgentQuery] = useState('');
  const [skillQuery, setSkillQuery] = useState('');
  const [kbQuery, setKbQuery] = useState('');
  const [researchQuery, setResearchQuery] = useState('');

  const agentsQuery = useClawAuthAgents();
  const skillsQuery = useClawSkills();
  const kbQueryResult = useClawKnowledgeBaseTree();
  const researchOptions = useClawResearchAgentOptions();

  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const skills = useMemo(() => skillsQuery.data ?? [], [skillsQuery.data]);
  const collections = useMemo(
    () => flattenCollections(kbQueryResult.data?.collections ?? []),
    [kbQueryResult.data?.collections],
  );

  const filteredAgentGroups = useMemo(() => {
    const needle = agentQuery.trim().toLowerCase();
    const matched = needle
      ? agents.filter(agent =>
          `${agent.name} ${agent.description ?? ''}`.toLowerCase().includes(needle),
        )
      : agents;
    return groupAgentsByCategory(matched);
  }, [agentQuery, agents]);

  const filteredSkillGroups = useMemo(() => {
    const needle = skillQuery.trim().toLowerCase();
    const matched = needle
      ? skills.filter(skill =>
          `${skill.name} ${skill.slug} ${skill.description ?? ''}`.toLowerCase().includes(needle),
        )
      : skills;
    return groupSkillsByCategory(matched);
  }, [skillQuery, skills]);

  const filteredCollections = useMemo(() => {
    const needle = kbQuery.trim().toLowerCase();
    if (!needle) return collections;
    return collections.filter(collection => collection.name.toLowerCase().includes(needle));
  }, [collections, kbQuery]);

  const filteredProducts = useMemo(() => {
    const needle = researchQuery.trim().toLowerCase();
    if (!needle) return researchOptions.products;
    return researchOptions.products.filter(option => option.name.toLowerCase().includes(needle));
  }, [researchOptions.products, researchQuery]);

  const filteredRepositories = useMemo(() => {
    const needle = researchQuery.trim().toLowerCase();
    if (!needle) return researchOptions.repositories;
    return researchOptions.repositories.filter(option =>
      option.name.toLowerCase().includes(needle),
    );
  }, [researchOptions.repositories, researchQuery]);

  const go = (path: string): void => {
    void navigate(prefixWs(path));
  };

  const toggleCollection = (collection: { id: string; name: string }): void => {
    const selected = extras.collections.some(item => item.id === collection.id);
    onExtrasChange({
      ...extras,
      collections: selected
        ? extras.collections.filter(item => item.id !== collection.id)
        : [...extras.collections, collection],
    });
  };

  const selectResearch = (type: ResearchContext['type'], option: ResearchAgentOption): void => {
    const already = extras.research?.type === type && extras.research.id === option.id;
    onExtrasChange({
      ...extras,
      research: already ? null : { type, id: option.id, name: option.name },
    });
  };

  const insertNamed = (name: string): void => {
    onInsertSnippet(`@${name} `);
  };

  return (
    <DropdownMenuContent
      align='start'
      sideOffset={8}
      className='dt-filter-menu-content dt-filter-menu-wide dt-composer-plus-menu'
    >
      <DropdownMenuItem
        className={MENU_ITEM}
        onSelect={onUpload}
        data-track-category='Claw Agents'
        data-track-name='Digital Twin attach files'
      >
        <span className={MENU_LABEL}>
          <PaperclipSlant aria-hidden />
          <span>Attach files</span>
        </span>
      </DropdownMenuItem>

      <DropdownMenuSeparator className='dt-filter-menu-separator' />

      <DropdownMenuSub>
        <DropdownMenuSubTrigger className={MENU_ITEM}>
          <span className={MENU_LABEL}>
            <Bot aria-hidden />
            <span>Agent</span>
          </span>
          <ChevronRight aria-hidden />
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          sideOffset={8}
          collisionPadding={SUBMENU_VIEWPORT_PADDING}
          className={SUB_CONTENT}
        >
          <SearchRow
            value={agentQuery}
            onChange={setAgentQuery}
            placeholder='Search agents...'
            trackName='Digital Twin search agents'
            trailing={
              <button
                type='button'
                className='dt-filter-menu-icon-btn'
                aria-label='Open agent library'
                title='Open agent library'
                onClick={() => go('/ai/library?tab=agents')}
                data-track-category='Claw Agents'
                data-track-name='Digital Twin open agent library'
              >
                <Settings aria-hidden />
              </button>
            }
          />
          <DropdownMenuItem
            className={MENU_ITEM}
            onSelect={() => go('/ai/library/agent/create')}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin create agent'
          >
            <span className={MENU_LABEL}>
              <Plus aria-hidden />
              <span>Create Agent</span>
            </span>
          </DropdownMenuItem>
          {agentsQuery.isLoading ? (
            <EmptyRow>Loading agents…</EmptyRow>
          ) : agentsQuery.isError ? (
            <EmptyRow>Couldn&apos;t load agents.</EmptyRow>
          ) : agents.length === 0 ? (
            <EmptyRow>No agents yet.</EmptyRow>
          ) : (
            AGENT_CATEGORIES.map(category => {
              const group = filteredAgentGroups.get(category.id) ?? [];
              if (group.length === 0) return null;
              return (
                <AgentCategoryBlock
                  key={category.id}
                  label={getCategoryDefinition(category.id).label}
                  agents={group}
                  onSelect={insertNamed}
                />
              );
            })
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSub>
        <DropdownMenuSubTrigger className={MENU_ITEM}>
          <span className={MENU_LABEL}>
            <Staroflife aria-hidden />
            <span>Skill</span>
          </span>
          <ChevronRight aria-hidden />
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          sideOffset={8}
          collisionPadding={SUBMENU_VIEWPORT_PADDING}
          className={SUB_CONTENT}
        >
          <SearchRow
            value={skillQuery}
            onChange={setSkillQuery}
            placeholder='Search skills...'
            trackName='Digital Twin search skills'
          />
          <DropdownMenuItem
            className={MENU_ITEM}
            onSelect={() => go('/ai/library/skill/create')}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin create skill'
          >
            <span className={MENU_LABEL}>
              <Plus aria-hidden />
              <span>Create Skill</span>
            </span>
          </DropdownMenuItem>
          {skillsQuery.isLoading ? (
            <EmptyRow>Loading skills…</EmptyRow>
          ) : skillsQuery.isError ? (
            <EmptyRow>Couldn&apos;t load skills.</EmptyRow>
          ) : skills.length === 0 ? (
            <EmptyRow>No skills yet.</EmptyRow>
          ) : (
            AGENT_CATEGORIES.map(category => {
              const group = filteredSkillGroups.get(category.id) ?? [];
              if (group.length === 0) return null;
              return (
                <SkillCategoryBlock
                  key={category.id}
                  label={getCategoryDefinition(category.id).label}
                  skills={group}
                  onSelect={insertNamed}
                />
              );
            })
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSeparator className='dt-filter-menu-separator' />

      <DropdownMenuSub>
        <DropdownMenuSubTrigger className={MENU_ITEM}>
          <span className={MENU_LABEL}>
            <Notebook aria-hidden />
            <span>Knowledge Base</span>
          </span>
          <ChevronRight aria-hidden />
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          sideOffset={8}
          collisionPadding={SUBMENU_VIEWPORT_PADDING}
          className={SUB_CONTENT}
        >
          <SearchRow
            value={kbQuery}
            onChange={setKbQuery}
            placeholder='Search collections...'
            trackName='Digital Twin search knowledge base'
          />
          {kbQueryResult.isLoading ? (
            <EmptyRow>Loading Knowledge Base…</EmptyRow>
          ) : kbQueryResult.data?.noSpacesSession ? (
            <EmptyRow>Sign in to spaces to attach Knowledge Base collections.</EmptyRow>
          ) : kbQueryResult.isError ? (
            <EmptyRow>Couldn&apos;t load Knowledge Base.</EmptyRow>
          ) : filteredCollections.length === 0 ? (
            <EmptyRow>
              {collections.length === 0 ? 'No collections yet.' : 'No matching collections.'}
            </EmptyRow>
          ) : (
            filteredCollections.map(collection => {
              const selected = extras.collections.some(item => item.id === collection.id);
              return (
                <DropdownMenuItem
                  key={collection.id}
                  className={MENU_ITEM}
                  data-selected={selected}
                  onSelect={event => {
                    event.preventDefault();
                    toggleCollection(collection);
                  }}
                  data-track-category='Claw Agents'
                  data-track-name='Digital Twin attach knowledge base'
                >
                  <span className={MENU_LABEL}>
                    <Notebook aria-hidden />
                    <span>{collection.name}</span>
                  </span>
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSub>
        <DropdownMenuSubTrigger className={MENU_ITEM}>
          <span className={MENU_LABEL}>
            <FocusTarget aria-hidden />
            <span>Deep Research Target</span>
          </span>
          <ChevronRight aria-hidden />
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          sideOffset={8}
          collisionPadding={SUBMENU_VIEWPORT_PADDING}
          className={SUB_CONTENT}
        >
          <SearchRow
            value={researchQuery}
            onChange={setResearchQuery}
            placeholder='Search targets...'
            trackName='Digital Twin search research targets'
          />
          {researchOptions.isLoading ? (
            <EmptyRow>Loading research targets…</EmptyRow>
          ) : filteredProducts.length === 0 && filteredRepositories.length === 0 ? (
            <EmptyRow>No research targets available.</EmptyRow>
          ) : (
            <>
              {filteredProducts.length > 0 && (
                <>
                  <p className='dt-filter-menu-heading'>Products</p>
                  {filteredProducts.map(option => (
                    <ResearchOptionItem
                      key={`product-${option.id}`}
                      option={option}
                      selected={
                        extras.research?.type === 'product' && extras.research.id === option.id
                      }
                      onSelect={() => selectResearch('product', option)}
                    />
                  ))}
                </>
              )}
              {filteredRepositories.length > 0 && (
                <>
                  <p className='dt-filter-menu-heading'>Repositories</p>
                  {filteredRepositories.map(option => (
                    <ResearchOptionItem
                      key={`repository-${option.id}`}
                      option={option}
                      selected={
                        extras.research?.type === 'repository' && extras.research.id === option.id
                      }
                      onSelect={() => selectResearch('repository', option)}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSeparator className='dt-filter-menu-separator' />

      <DropdownMenuItem
        className={MENU_ITEM}
        data-selected={extras.webSearchEnabled}
        onSelect={event => {
          event.preventDefault();
          onExtrasChange({ ...extras, webSearchEnabled: !extras.webSearchEnabled });
        }}
        aria-label={extras.webSearchEnabled ? 'Disable web search' : 'Enable web search'}
        data-track-category='Claw Agents'
        data-track-name='Digital Twin toggle web search'
      >
        <span className={MENU_LABEL}>
          <Globe aria-hidden />
          <span>Web Search</span>
        </span>
      </DropdownMenuItem>

      <DropdownMenuItem
        className={MENU_ITEM}
        data-selected={extras.deepResearchEnabled}
        onSelect={event => {
          event.preventDefault();
          onExtrasChange({ ...extras, deepResearchEnabled: !extras.deepResearchEnabled });
        }}
        aria-label={extras.deepResearchEnabled ? 'Disable deep research' : 'Enable deep research'}
        data-track-category='Claw Agents'
        data-track-name='Digital Twin toggle deep research'
      >
        <span className={MENU_LABEL}>
          <GraduationHat aria-hidden />
          <span>Deep research</span>
        </span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
};

const AgentCategoryBlock = ({
  label,
  agents,
  onSelect,
}: {
  label: string;
  agents: Agent[];
  onSelect: (name: string) => void;
}): ReactElement => (
  <>
    <p className='dt-filter-menu-heading'>{label}</p>
    {agents.map(agent => (
      <DropdownMenuItem
        key={agent.id}
        className={MENU_ITEM}
        onSelect={() => onSelect(agent.name)}
        data-track-category='Claw Agents'
        data-track-name='Digital Twin mention agent'
      >
        <span className={MENU_LABEL}>
          <span
            className='dt-filter-menu-avatar'
            style={{ backgroundColor: agent.color || 'hsl(var(--foreground) / 0.35)' }}
            aria-hidden
          >
            {initials(agent.name)}
          </span>
          <span>{agent.name}</span>
        </span>
      </DropdownMenuItem>
    ))}
  </>
);

const SkillCategoryBlock = ({
  label,
  skills,
  onSelect,
}: {
  label: string;
  skills: Skill[];
  onSelect: (name: string) => void;
}): ReactElement => (
  <>
    <p className='dt-filter-menu-heading'>{label}</p>
    {skills.map(skill => (
      <DropdownMenuItem
        key={skill.id}
        className={MENU_ITEM}
        onSelect={() => onSelect(skill.name)}
        data-track-category='Claw Agents'
        data-track-name='Digital Twin mention skill'
      >
        <span className={MENU_LABEL}>
          <Sparkles aria-hidden />
          <span>{skill.name}</span>
        </span>
      </DropdownMenuItem>
    ))}
  </>
);

const ResearchOptionItem = ({
  option,
  selected,
  onSelect,
}: {
  option: ResearchAgentOption;
  selected: boolean;
  onSelect: () => void;
}): ReactElement => (
  <DropdownMenuItem
    className={MENU_ITEM}
    data-selected={selected}
    onSelect={event => {
      event.preventDefault();
      onSelect();
    }}
    data-track-category='Claw Agents'
    data-track-name='Digital Twin select research target'
  >
    <span className={MENU_LABEL}>
      <FocusTarget aria-hidden />
      <span>{option.name}</span>
    </span>
  </DropdownMenuItem>
);
