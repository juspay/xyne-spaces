import type { LucideIcon } from 'lucide-react';
import { ReactElement } from 'react';

interface SectionHeaderProps {
  title: string;
  icon: LucideIcon;
}

const SectionHeader = ({ title, icon: IconComponent }: SectionHeaderProps): ReactElement => {
  return (
    <div className='flex items-center gap-3'>
      <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10'>
        <IconComponent className='h-4 w-4 text-primary' />
      </div>
      <h3 className='text-lg font-semibold text-foreground'>{title}</h3>
    </div>
  );
};

export default SectionHeader;
