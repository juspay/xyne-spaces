import { useMemo, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import {
  Bot,
  ChevronRight,
  Globe,
  GraduationHat,
  PaperclipSlant,
  SearchBig as Search,
  SparkleAi01 as Sparkles,
  Staroflife,
} from '@xyne/icons';
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
import {
  AGENT_CATEGORIES,
  getCategoryDefinition,
  groupAgentsByCategory,
  groupSkillsByCategory,
} from '@/services/claw/agentCategory';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { Skill } from '@/services/claw/clawSkillsTypes';
import type { DraftChatExtras } from '@/services/claw/draftChat';

const MENU_ITEM = 'dc-menu-item';
const MENU_LABEL = 'dc-menu-item-label';
const SUB_CONTENT = 'dc-menu-content dc-menu-sub';
const SUBMENU_VIEWPORT_PADDING = 24;

const initials = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

const stopMenuTypeahead = (event: KeyboardEvent): void => {
  event.stopPropagation();
};

const SearchRow = ({
  value,
  onChange,
  placeholder,
  trackName,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  trackName: string;
}): ReactElement => (
  <div className='dc-menu-search'>
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
  </div>
);

const EmptyRow = ({ children }: { children: ReactNode }): ReactElement => (
  <p className='dc-menu-empty'>{children}</p>
);

/**
 * The composer's "+" menu, from the Digital Twin ask bar. Knowledge Base and
 * Deep Research Target are left out: a draft run mounts neither.
 */
export function DraftChatPlusMenu({
  extras,
  onExtrasChange,
  onInsertSnippet,
  onAttach,
}: {
  extras: DraftChatExtras;
  onExtrasChange: (next: DraftChatExtras) => void;
  onInsertSnippet: (snippet: string) => void;
  onAttach: () => void;
}): ReactElement {
  const [agentQuery, setAgentQuery] = useState('');
  const [skillQuery, setSkillQuery] = useState('');
  const agentsQuery = useClawAuthAgents();
  const skillsQuery = useClawSkills();
  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const skills = useMemo(() => skillsQuery.data ?? [], [skillsQuery.data]);

  const agentGroups = useMemo(() => {
    const needle = agentQuery.trim().toLowerCase();
    const matched = needle
      ? agents.filter(agent =>
          `${agent.name} ${agent.description ?? ''}`.toLowerCase().includes(needle),
        )
      : agents;
    return groupAgentsByCategory(matched);
  }, [agentQuery, agents]);

  const skillGroups = useMemo(() => {
    const needle = skillQuery.trim().toLowerCase();
    const matched = needle
      ? skills.filter(skill =>
          `${skill.name} ${skill.slug} ${skill.description ?? ''}`.toLowerCase().includes(needle),
        )
      : skills;
    return groupSkillsByCategory(matched);
  }, [skillQuery, skills]);

  const insertNamed = (name: string): void => {
    onInsertSnippet(`@${name} `);
  };

  return (
    <DropdownMenuContent
      align='start'
      side='top'
      sideOffset={8}
      className='dc-menu-content dc-menu-plus'
    >
      <DropdownMenuItem
        className={MENU_ITEM}
        onSelect={onAttach}
        data-track-category='Claw Agents'
        data-track-name='Create agent: draft chat attach files'
      >
        <span className={MENU_LABEL}>
          <PaperclipSlant aria-hidden />
          <span>Attach files</span>
        </span>
      </DropdownMenuItem>

      <DropdownMenuSeparator className='dc-menu-separator' />

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
            trackName='Create agent: draft chat search agents'
          />
          {agentsQuery.isLoading ? (
            <EmptyRow>Loading agents…</EmptyRow>
          ) : agentsQuery.isError ? (
            <EmptyRow>Couldn&apos;t load agents.</EmptyRow>
          ) : agents.length === 0 ? (
            <EmptyRow>No agents yet.</EmptyRow>
          ) : (
            AGENT_CATEGORIES.map(category => {
              const group = agentGroups.get(category.id) ?? [];
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
            trackName='Create agent: draft chat search skills'
          />
          {skillsQuery.isLoading ? (
            <EmptyRow>Loading skills…</EmptyRow>
          ) : skillsQuery.isError ? (
            <EmptyRow>Couldn&apos;t load skills.</EmptyRow>
          ) : skills.length === 0 ? (
            <EmptyRow>No skills yet.</EmptyRow>
          ) : (
            AGENT_CATEGORIES.map(category => {
              const group = skillGroups.get(category.id) ?? [];
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

      <DropdownMenuSeparator className='dc-menu-separator' />

      <DropdownMenuItem
        className={MENU_ITEM}
        data-selected={extras.webSearchEnabled}
        onSelect={event => {
          event.preventDefault();
          onExtrasChange({ ...extras, webSearchEnabled: !extras.webSearchEnabled });
        }}
        aria-label={extras.webSearchEnabled ? 'Disable web search' : 'Enable web search'}
        data-track-category='Claw Agents'
        data-track-name='Create agent: draft chat toggle web search'
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
        data-track-name='Create agent: draft chat toggle deep research'
      >
        <span className={MENU_LABEL}>
          <GraduationHat aria-hidden />
          <span>Deep research</span>
        </span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

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
    <p className='dc-menu-heading'>{label}</p>
    {agents.map(agent => (
      <DropdownMenuItem
        key={agent.id}
        className={MENU_ITEM}
        onSelect={() => onSelect(agent.name)}
        data-track-category='Claw Agents'
        data-track-name='Create agent: draft chat mention agent'
      >
        <span className={MENU_LABEL}>
          <span
            className='dc-menu-avatar'
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
    <p className='dc-menu-heading'>{label}</p>
    {skills.map(skill => (
      <DropdownMenuItem
        key={skill.id}
        className={MENU_ITEM}
        onSelect={() => onSelect(skill.name)}
        data-track-category='Claw Agents'
        data-track-name='Create agent: draft chat mention skill'
      >
        <span className={MENU_LABEL}>
          <Sparkles aria-hidden />
          <span>{skill.name}</span>
        </span>
      </DropdownMenuItem>
    ))}
  </>
);
