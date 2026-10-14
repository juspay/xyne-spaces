import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react-native';

import { Button } from '@/src/components/ui/button';
import { HOSTED_PROVIDERS, providerDisplayName } from '@/src/utils/flowAgentEditor';

import type { DraftAgentEditor } from './utils/useDraftAgentEditor';
import type { AgentPreviewPanel } from './flow-agent-preview-parts';
import { DetailCard, EmptyLine } from './flow-agent-preview-parts';

type ModelOption = { value: string; label: string };

type AgentPreviewSettingsProps = {
  panel: AgentPreviewPanel;
  models: { options: ModelOption[] };
  editor: DraftAgentEditor;
  setPanel: (panel: AgentPreviewPanel) => void;
  providerDraft: string[];
  setProviderDraft: (next: string[]) => void;
  muted: string;
};

export const AgentPreviewSettings = ({
  panel,
  models,
  editor,
  setPanel,
  providerDraft,
  setProviderDraft,
  muted,
}: AgentPreviewSettingsProps): ReactElement => (
  <>
    {panel === 'model' ? (
      <DetailCard>
        {models.options.map((option, index) => (
          <Pressable
            key={`${option.value || 'default'}-${index}`}
            accessibilityRole='button'
            onPress={() => {
              editor.setModelId(option.value);
              setPanel('main');
            }}
            {...(index === models.options.length - 1
              ? {}
              : { className: 'border-b border-border' })}
            style={{ paddingHorizontal: 12, paddingVertical: 12 }}
          >
            <Text className='text-sm font-semibold text-foreground'>{option.label}</Text>
          </Pressable>
        ))}
      </DetailCard>
    ) : null}

    {panel === 'providers' ? (
      <View style={{ gap: 16 }}>
        <Text className='text-sm text-flow-card-header-title'>
          Runs use the first provider and fall through the rest on quota limits.
        </Text>
        {providerDraft.length === 0 ? (
          <EmptyLine label='No providers chosen — runs use the Spaces platform model.' />
        ) : (
          <DetailCard>
            {providerDraft.map((provider, index) => (
              <View
                key={provider}
                {...(index === providerDraft.length - 1
                  ? {}
                  : { className: 'border-b border-border' })}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  gap: 8,
                }}
              >
                <Text className='w-4 text-xs text-flow-card-header-title'>{index + 1}</Text>
                <Text className='flex-1 text-sm font-semibold text-foreground'>
                  {providerDisplayName(provider)}
                </Text>
                <Pressable
                  accessibilityRole='button'
                  accessibilityLabel={`Move ${provider} up`}
                  disabled={index === 0}
                  onPress={() => {
                    if (index === 0) return;
                    const next = [...providerDraft];
                    const [moved] = next.splice(index, 1);
                    if (moved) next.splice(index - 1, 0, moved);
                    setProviderDraft(next);
                  }}
                >
                  <ChevronUp size={16} color={muted} />
                </Pressable>
                <Pressable
                  accessibilityRole='button'
                  accessibilityLabel={`Move ${provider} down`}
                  disabled={index === providerDraft.length - 1}
                  onPress={() => {
                    if (index === providerDraft.length - 1) return;
                    const next = [...providerDraft];
                    const [moved] = next.splice(index, 1);
                    if (moved) next.splice(index + 1, 0, moved);
                    setProviderDraft(next);
                  }}
                >
                  <ChevronDown size={16} color={muted} />
                </Pressable>
                <Pressable
                  accessibilityRole='button'
                  accessibilityLabel={`Remove ${provider}`}
                  onPress={() =>
                    setProviderDraft(providerDraft.filter(entry => entry !== provider))
                  }
                >
                  <X size={16} color={muted} />
                </Pressable>
              </View>
            ))}
          </DetailCard>
        )}
        <View style={{ gap: 8 }}>
          <Text className='text-sm font-semibold text-foreground'>Add</Text>
          {HOSTED_PROVIDERS.filter(provider => !providerDraft.includes(provider)).map(provider => (
            <Pressable
              key={provider}
              accessibilityRole='button'
              onPress={() => setProviderDraft([...providerDraft, provider])}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <Plus size={14} color={muted} />
              <Text className='text-sm text-foreground'>{providerDisplayName(provider)}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          <Button size='xs' label='Cancel' variant='secondary' onPress={() => setPanel('main')} />
          <Button
            size='xs'
            label='Save'
            variant='primary'
            onPress={() => {
              editor.setProviderOrder(providerDraft);
              setPanel('main');
            }}
          />
        </View>
      </View>
    ) : null}
  </>
);
