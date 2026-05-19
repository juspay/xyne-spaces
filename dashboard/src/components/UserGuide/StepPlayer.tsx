import type { ReactElement, ComponentType } from 'react';
import {
  Activity,
  AppWindow,
  ArrowLeft,
  ArrowRightLeft,
  Bell,
  Bookmark,
  BookmarkMinus,
  BookmarkPlus,
  BookOpen,
  Brain,
  CalendarClock,
  ChartSpline,
  Check,
  Circle,
  CircleUser,
  Clipboard,
  ClipboardCheck,
  Clock,
  Copy,
  EllipsisVertical,
  Filter,
  FolderKanban,
  Forward,
  Globe,
  Headphones,
  Headset,
  Inbox,
  LifeBuoy,
  Lightbulb,
  Link,
  Mail,
  MessageCircleMore,
  Mic,
  Monitor,
  MoreVertical,
  PanelsTopLeft,
  PenBox,
  Phone,
  PhoneOff,
  PieChart,
  Pin,
  Plus,
  Search,
  SearchCode,
  Settings,
  ShieldUser,
  SlidersHorizontal,
  SmilePlus,
  Sparkles,
  SquarePen,
  Star,
  Ticket,
  Trash2,
  User,
  Users,
  UsersIcon,
  Video,
  X,
} from 'lucide-react';
import { ChatHistory, XyneAIStar } from '../icons/xyne-ai';
import { StopIcon } from '../Chat/XyneAISidebar/components/StopIcon';

const INLINE_ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  Activity,
  AppWindow,
  ArrowLeft,
  ArrowRightLeft,
  Bell,
  Bookmark,
  BookmarkMinus,
  BookmarkPlus,
  BookOpen,
  Brain,
  CalendarClock,
  ChartSpline,
  ChatHistory,
  Check,
  Circle,
  CircleUser,
  Clipboard,
  ClipboardCheck,
  Clock,
  Copy,
  EllipsisVertical,
  Filter,
  FolderKanban,
  Forward,
  Globe,
  Headphones,
  Headset,
  Inbox,
  LifeBuoy,
  Lightbulb,
  Link,
  Mail,
  MessageCircleMore,
  Mic,
  Monitor,
  MoreVertical,
  PanelsTopLeft,
  PenBox,
  Phone,
  PhoneOff,
  PieChart,
  Pin,
  Plus,
  Search,
  SearchCode,
  Settings,
  ShieldUser,
  SlidersHorizontal,
  SmilePlus,
  Sparkles,
  SquarePen,
  Star,
  StopIcon,
  Ticket,
  Trash2,
  User,
  Users,
  UsersIcon,
  Video,
  X,
  XyneAIStar,
};

export function parseStep(text: string): ReactElement {
  const parts = text.split(/(\[\[[^\]]+\]\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\[\[([^\]]+)\]\]$/);
        if (match) {
          const iconName = match[1] as string;
          const IconComponent = INLINE_ICONS[iconName];
          if (IconComponent) {
            return (
              <span
                key={i}
                className='inline-flex items-center justify-center align-middle mx-0.5 px-1 py-0.5 rounded bg-muted border border-border'
              >
                <IconComponent size={11} />
              </span>
            );
          }
          return <span key={i}>{part}</span>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

interface StepGuideProps {
  steps: string[];
}

export const StepGuide = ({ steps }: StepGuideProps): ReactElement => {
  return (
    <ol className='mt-3 space-y-2.5'>
      {steps.map((step, i) => {
        const stepKey = step.slice(0, 40);
        return (
          <li key={stepKey} className='flex items-start gap-3'>
            <span className='shrink-0 mt-0.5 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold leading-none'>
              {i + 1}
            </span>
            <span className='text-sm leading-relaxed text-foreground'>{parseStep(step)}</span>
          </li>
        );
      })}
    </ol>
  );
};
