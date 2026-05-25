import { ReactElement } from 'react';
import { AutomationApprovalsList } from '../../components/Automation/AutomationApprovalsList/AutomationApprovalsList';

export default function AutomationApprovalsScreen(): ReactElement {
  return (
    <div className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md'>
      <AutomationApprovalsList />
    </div>
  );
}
