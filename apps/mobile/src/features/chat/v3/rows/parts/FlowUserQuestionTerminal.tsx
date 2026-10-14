import { type ReactElement } from 'react';
import { Text, View } from 'react-native';

import Avatar from '@/src/components/ui/avatar';
import { useUserSnapshot } from '@/src/components/ui/avatar/avatar.utils';
import {
  formatQuestionAnswerSummary,
  type UserQuestionViewModel,
} from '@/src/utils/flowUserQuestionUtils';

export const FlowUserQuestionTerminal = ({
  viewModel,
}: {
  viewModel: UserQuestionViewModel;
}): ReactElement => {
  const submitterUserId = viewModel.submitterUserId;
  const submitter = useUserSnapshot(submitterUserId ?? '');
  const submitterName =
    submitter?.displayName?.trim() ||
    submitter?.name?.trim() ||
    viewModel.submitterNameFallback?.trim() ||
    (submitterUserId ? 'You' : undefined);

  return (
    <>
      <View style={{ gap: 10 }}>
        {viewModel.questions.map(question => (
          <View key={question.id} style={{ gap: 4, minWidth: 0 }}>
            <Text className='text-sm font-semibold text-foreground'>{question.question}</Text>
            <Text className='text-sm text-foreground'>
              {formatQuestionAnswerSummary(
                question,
                viewModel.persistedAnswers,
                viewModel.persistedNotes,
                viewModel.phase,
              )}
            </Text>
          </View>
        ))}
      </View>
      {viewModel.submitterLabel ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Text className='text-xs font-semibold text-gray-500'>{viewModel.submitterLabel}</Text>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}
          >
            {submitterUserId ? (
              <Avatar userIds={[submitterUserId]} size={18} rounded={false} />
            ) : null}
            {submitterName ? (
              <Text className='shrink text-xs font-semibold text-foreground' numberOfLines={1}>
                {submitterName}
              </Text>
            ) : null}
          </View>
        </View>
      ) : viewModel.auditLine ? (
        <Text className='text-sm text-foreground'>{viewModel.auditLine}</Text>
      ) : null}
    </>
  );
};
