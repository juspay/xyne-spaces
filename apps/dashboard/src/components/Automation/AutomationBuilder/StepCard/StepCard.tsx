import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Box,
  ChevronDown,
  ChevronRight,
  Loader2,
  MoreVertical,
  Trash2,
} from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import { Popover } from '../../../ui/Popover/Popover';
import { resolveSchema } from '../SchemaForm/SchemaForm.utils';
import type { JsonSchema } from '../../Automation.types';
import { SchemaForm } from '../SchemaForm/SchemaForm';
import {
  buildOutputSchemaFromRunAgentConfig,
  buildOutputSchemaFromWebhookConfig,
} from '../AutomationBuilder.utils';
import { WebhookStepForm } from './WebhookStepForm';
import { RunAgentStepForm } from './RunAgentStepForm';
import { SendMessageStepForm } from './SendMessageStepForm';
import { MakeCallStepForm } from './MakeCallStepForm';
import { CreateEmailDraftStepForm } from './CreateEmailDraftStepForm';
import { ReplyOnMessageStepForm } from './ReplyOnMessageStepForm';
import { NotifyStepForm } from './NotifyStepForm';
import { ApplyConversationLabelStepForm } from './ApplyConversationLabelStepForm';
import type { StepCardProps } from './StepCard.types';

export function StepCard({
  step,
  catalogItem,
  schema,
  schemaLoading,
  index,
  total,
  variableSources,
  onConfigChange,
  onMoveUp,
  onMoveDown,
  onDelete,
  issues,
  pathPrefix,
  readOnly = false,
}: StepCardProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [peekOpen, setPeekOpen] = useState(false);

  const heading = catalogItem?.name ?? step.type;
  const description = catalogItem?.description;

  return (
    <div
      data-slot='automation-step-card'
      className='flex flex-col gap-4 rounded-md border border-border bg-background p-5'
    >
      <div className='flex items-start justify-between gap-3'>
        <button
          type='button'
          aria-expanded={!collapsed}
          aria-label={`Step ${index} — ${heading}. ${collapsed ? 'Expand' : 'Collapse'} configuration.`}
          data-track-category='automation-builder'
          data-track-name='step-card-toggle-collapse'
          className={cn(
            'flex flex-1 items-start gap-3 rounded-md text-left',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
          )}
          onClick={() => setCollapsed(prev => !prev)}
        >
          <div
            aria-hidden='true'
            className='flex size-8 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400'
          >
            <Box className='size-4' />
          </div>
          <div className='flex flex-col'>
            <span className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
              Step {index} {catalogItem ? `· ${catalogItem.category}` : ''}
            </span>
            <span className='text-sm font-medium text-foreground'>{heading}</span>
            {description && (
              <span className='mt-1 text-xs text-muted-foreground'>{description}</span>
            )}
          </div>
          <div className='ml-auto pt-1 text-muted-foreground' aria-hidden='true'>
            {collapsed ? <ChevronRight className='size-4' /> : <ChevronDown className='size-4' />}
          </div>
        </button>

        <div className='flex items-center gap-1'>
          <button
            type='button'
            onClick={onMoveUp}
            disabled={index === 1}
            aria-label={`Move step ${index} up`}
            data-track-category='automation-builder'
            data-track-name='step-card-move-up'
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
              index === 1
                ? 'opacity-40 cursor-not-allowed'
                : 'hover:text-foreground hover:bg-accent/40',
            )}
          >
            <ArrowUp className='size-4' aria-hidden='true' />
          </button>
          <button
            type='button'
            onClick={onMoveDown}
            disabled={index === total}
            aria-label={`Move step ${index} down`}
            data-track-category='automation-builder'
            data-track-name='step-card-move-down'
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
              index === total
                ? 'opacity-40 cursor-not-allowed'
                : 'hover:text-foreground hover:bg-accent/40',
            )}
          >
            <ArrowDown className='size-4' aria-hidden='true' />
          </button>
          <Popover
            open={menuOpen}
            onOpenChange={setMenuOpen}
            align='end'
            side='bottom'
            sideOffset={4}
            className='w-[160px] rounded-md p-1'
            trigger={
              <button
                type='button'
                aria-label={`Actions for step ${index}`}
                aria-haspopup='menu'
                aria-expanded={menuOpen}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground',
                  'hover:text-foreground hover:bg-accent/40',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
                )}
              >
                <MoreVertical className='size-4' aria-hidden='true' />
              </button>
            }
          >
            <button
              type='button'
              onClick={() => {
                onDelete();
                setMenuOpen(false);
              }}
              data-track-category='automation-builder'
              data-track-name='step-card-delete'
              className='flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-500/10'
            >
              <Trash2 className='size-4' />
              Delete step
            </button>
          </Popover>
        </div>
      </div>

      {!collapsed && (
        <div className='border-t border-border pt-4'>
          {schemaLoading ? (
            <div className='flex items-center gap-2 text-xs text-muted-foreground'>
              <Loader2 className='size-4 animate-spin' />
              Loading step fields…
            </div>
          ) : !schema ? (
            <div className='text-xs text-muted-foreground italic'>
              Schema unavailable for this step type.
            </div>
          ) : (
            <div className='flex flex-col gap-3'>
              <SchemaPeek
                open={peekOpen}
                onToggle={() => setPeekOpen(prev => !prev)}
                configSchema={schema.configSchema}
                outputSchema={
                  step.type === 'RUN_AGENT'
                    ? buildOutputSchemaFromRunAgentConfig(step.config)
                    : step.type === 'TRIGGER_WEBHOOK'
                      ? buildOutputSchemaFromWebhookConfig(step.config)
                      : schema.outputSchema
                }
              />
              {step.type === 'TRIGGER_WEBHOOK' ? (
                <WebhookStepForm
                  value={step.config}
                  onChange={onConfigChange}
                  issues={issues ?? null}
                  pathPrefix={pathPrefix}
                  variableSources={variableSources}
                  readOnly={readOnly}
                />
              ) : step.type === 'RUN_AGENT' ? (
                <RunAgentStepForm
                  value={step.config}
                  onChange={onConfigChange}
                  issues={issues ?? null}
                  pathPrefix={pathPrefix}
                  variableSources={variableSources}
                  readOnly={readOnly}
                />
              ) : step.type === 'SEND_MESSAGE' ? (
                <SendMessageStepForm
                  stepId={step.id}
                  value={step.config}
                  onChange={onConfigChange}
                  issues={issues ?? null}
                  pathPrefix={pathPrefix}
                  variableSources={variableSources}
                  readOnly={readOnly}
                />
              ) : step.type === 'MAKE_CALL' ? (
                <MakeCallStepForm
                  value={step.config}
                  onChange={onConfigChange}
                  issues={issues ?? null}
                  pathPrefix={pathPrefix}
                  variableSources={variableSources}
                />
              ) : step.type === 'CREATE_EMAIL_DRAFT' ? (
                <CreateEmailDraftStepForm
                  value={step.config}
                  onChange={onConfigChange}
                  issues={issues ?? null}
                  pathPrefix={pathPrefix}
                  variableSources={variableSources}
                />
              ) : step.type === 'REPLY_ON_MESSAGE' ? (
                <ReplyOnMessageStepForm
                  value={step.config}
                  onChange={onConfigChange}
                  issues={issues ?? null}
                  pathPrefix={pathPrefix}
                  variableSources={variableSources}
                />
              ) : step.type === 'NOTIFY_USER' ||
                step.type === 'NOTIFY_USER_SOS' ||
                step.type === 'NOTIFY_GROUP' ? (
                <NotifyStepForm
                  recipient={step.type === 'NOTIFY_GROUP' ? 'group' : 'user'}
                  value={step.config}
                  onChange={onConfigChange}
                  issues={issues ?? null}
                  pathPrefix={pathPrefix}
                  variableSources={variableSources}
                />
              ) : step.type === 'APPLY_CONVERSATION_LABEL' ? (
                <ApplyConversationLabelStepForm
                  value={step.config}
                  onChange={onConfigChange}
                  issues={issues ?? null}
                  pathPrefix={pathPrefix}
                  variableSources={variableSources}
                />
              ) : (
                <SchemaForm
                  schema={schema.configSchema}
                  value={step.config}
                  onChange={onConfigChange}
                  issues={issues ?? null}
                  pathPrefix={pathPrefix}
                  variableSources={variableSources}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface SchemaPeekProps {
  open: boolean;
  onToggle: () => void;
  configSchema: JsonSchema;
  outputSchema: JsonSchema;
}

function SchemaPeek({
  open,
  onToggle,
  configSchema,
  outputSchema,
}: SchemaPeekProps): React.ReactElement {
  const inputLeaves = open ? flattenLeaves(configSchema) : [];
  const outputLeaves = open ? flattenLeaves(outputSchema) : [];

  return (
    <div className='rounded-md border border-border bg-muted/30'>
      <button
        type='button'
        onClick={onToggle}
        data-track-category='automation-builder'
        data-track-name='step-card-schema-peek-toggle'
        className='flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground hover:bg-accent/40'
      >
        {open ? <ChevronDown className='size-3' /> : <ChevronRight className='size-3' />}
        Input / output peek
      </button>
      {open && (
        <div className='grid grid-cols-1 gap-3 border-t border-border px-3 py-2 sm:grid-cols-2'>
          <PeekColumn title='Input' leaves={inputLeaves} emptyText='(no input)' />
          <PeekColumn title='Output' leaves={outputLeaves} emptyText='(no output)' />
        </div>
      )}
    </div>
  );
}

function PeekColumn({
  title,
  leaves,
  emptyText,
}: {
  title: string;
  leaves: { path: string; type: string }[];
  emptyText: string;
}): React.ReactElement {
  return (
    <div className='flex flex-col gap-1'>
      <div className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
        {title}
      </div>
      {leaves.length === 0 ? (
        <span className='text-[11px] italic text-muted-foreground'>{emptyText}</span>
      ) : (
        <ul className='flex flex-col gap-0.5'>
          {leaves.map(l => (
            <li
              key={l.path}
              className='flex items-center justify-between gap-2 text-[11px] text-foreground'
            >
              <span className='truncate font-mono'>{l.path}</span>
              <span className='flex-shrink-0 rounded border border-border px-1 py-0 text-[10px] font-mono text-muted-foreground'>
                {l.type}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function flattenLeaves(schema: JsonSchema): { path: string; type: string }[] {
  const root = resolveSchema(schema);
  const out: { path: string; type: string }[] = [];
  const walk = (s: JsonSchema, prefix: string): void => {
    const resolved = resolveSchema(s);
    if (resolved.type === 'object' && resolved.properties) {
      for (const [key, child] of Object.entries(resolved.properties)) {
        walk(child, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }
    if (!prefix) return;
    out.push({ path: prefix, type: leafType(resolved) });
  };
  walk(root, '');
  return out;
}

function leafType(schema: JsonSchema): string {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return 'enum';
  if (schema.type === 'array') return 'array';
  if (schema.type) return schema.type;
  if (schema.anyOf && schema.anyOf.length > 0) {
    return schema.anyOf
      .map(s => s.type ?? 'any')
      .filter(t => t !== 'null')
      .join(' | ');
  }
  return 'any';
}
