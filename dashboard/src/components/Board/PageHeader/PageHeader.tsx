import { ReactElement } from 'react';
import { Button, ButtonType } from '@juspay/blend-design-system';

interface PageHeaderProps {
  title: string;
  subtitle: string;
  actionButtonText: string;
  onActionClick: () => void;
}

export const PageHeader = ({
  title,
  subtitle,
  actionButtonText,
  onActionClick,
}: PageHeaderProps): ReactElement => {
  return (
    <div className='flex items-center justify-between mb-8'>
      <div>
        <h1 className='text-3xl font-bold text-gray-900'>{title}</h1>
        <p className='text-gray-600 mt-2'>{subtitle}</p>
      </div>
      <Button buttonType={ButtonType.PRIMARY} text={actionButtonText} onClick={onActionClick} />
    </div>
  );
};
