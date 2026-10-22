import { useMemo, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Check } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { useQuery } from '@/src/hooks/useQuery';
import { haptics } from '@/src/utils/haptics';
import { queries } from '@/src/zero/queries';

import {
  DEFAULT_SUMMARY_TEMPLATE_ID,
  DEFAULT_SUMMARY_TEMPLATE_NAME,
  getTemplateIcon,
} from '../utils/call-detail-format';

export interface TemplateOption {
  id: string;
  name: string;
  icon: string;
}

/**
 * The template the call's summary was written with, plus the menu of templates
 * the viewer can see — the dashboard's CallSummaryTemplatePicker data, minus
 * template authoring (which stays on the web).
 */
export function useSummaryTemplateOptions(
  selectedTemplateId: string | null,
  loadList: boolean,
): { options: TemplateOption[]; selected: TemplateOption; isLoading: boolean } {
  const storedId = selectedTemplateId ?? '';
  const shouldQueryStored = storedId.length > 0 && storedId !== DEFAULT_SUMMARY_TEMPLATE_ID;
  const [stored, storedDetails] = useQuery(queries.summaryTemplateById({ templateId: storedId }), {
    enabled: shouldQueryStored,
  });
  const [templates, templatesDetails] = useQuery(queries.summaryTemplates({}), {
    enabled: loadList,
  });

  return useMemo(() => {
    const defaultOption: TemplateOption = {
      id: DEFAULT_SUMMARY_TEMPLATE_ID,
      name: DEFAULT_SUMMARY_TEMPLATE_NAME,
      icon: getTemplateIcon(DEFAULT_SUMMARY_TEMPLATE_NAME),
    };
    const options: TemplateOption[] = [
      defaultOption,
      ...(templates ?? [])
        .filter(template => template.id !== DEFAULT_SUMMARY_TEMPLATE_ID)
        .map(template => ({
          id: template.id,
          name: template.name,
          icon: getTemplateIcon(template.name),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    ];
    const storedOption =
      stored && stored.id === selectedTemplateId
        ? { id: stored.id, name: stored.name, icon: getTemplateIcon(stored.name) }
        : undefined;
    const isDenied = shouldQueryStored && storedDetails.type === 'complete' && !stored;
    const selected =
      options.find(option => option.id === selectedTemplateId) ??
      storedOption ??
      (isDenied ? { id: '', name: 'Private template', icon: '🔒' } : defaultOption);
    return {
      options,
      selected,
      isLoading: loadList && templatesDetails.type !== 'complete' && !templates?.length,
    };
  }, [
    templates,
    templatesDetails.type,
    stored,
    storedDetails.type,
    selectedTemplateId,
    shouldQueryStored,
    loadList,
  ]);
}

export function TemplatePickerSheet({
  isOpen,
  onClose,
  options,
  selectedId,
  isLoading,
  isGenerating,
  generatingTemplateId,
  onPick,
}: {
  isOpen: boolean;
  onClose: () => void;
  options: TemplateOption[];
  selectedId: string;
  isLoading: boolean;
  isGenerating: boolean;
  generatingTemplateId: string | undefined;
  onPick: (option: TemplateOption) => void;
}): ReactElement {
  const foreground = useCSSVariable('--color-foreground') as string;
  const action = useCSSVariable('--color-action-primary') as string;

  return (
    <AppBottomSheet isOpen={isOpen} onOpenChange={open => !open && onClose()} mode='dynamic'>
      <BottomSheetScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View className='px-5 pt-1 pb-3'>
          <Text className='text-lg font-semibold text-foreground'>Summary template</Text>
          <Text className='text-[13px] leading-[18px] text-secondary-foreground mt-0.5'>
            {isGenerating
              ? 'A summary is being generated. You can pick another template once it finishes.'
              : 'Pick a template to rewrite this call’s detailed summary.'}
          </Text>
        </View>
        {isLoading ? (
          <View className='py-6 items-center'>
            <ActivityIndicator />
          </View>
        ) : (
          options.map(option => {
            const isSelected = option.id === selectedId;
            const isRunning = isGenerating && generatingTemplateId === option.id;
            return (
              <Pressable
                key={option.id}
                disabled={isGenerating}
                onPress={(): void => {
                  void haptics.selection();
                  onPick(option);
                }}
                accessibilityRole='button'
                accessibilityState={{ selected: isSelected, disabled: isGenerating }}
                className='flex-row items-center gap-3 px-5 py-3 active:bg-secondary'
                style={{ opacity: isGenerating && !isRunning && !isSelected ? 0.5 : 1 }}
              >
                <View className='h-8 w-8 items-center justify-center rounded-lg bg-secondary'>
                  <Text className='text-[14px] font-semibold text-foreground'>{option.icon}</Text>
                </View>
                <Text className='flex-1 text-[15px] text-foreground' numberOfLines={1}>
                  {option.name}
                </Text>
                {isRunning ? (
                  <ActivityIndicator size='small' color={foreground} />
                ) : isSelected ? (
                  <Check size={18} color={action || foreground} />
                ) : null}
              </Pressable>
            );
          })
        )}
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
}
