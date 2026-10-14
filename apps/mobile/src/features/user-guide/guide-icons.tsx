import type { ComponentType, ReactElement } from 'react';
import type { SvgProps } from 'react-native-svg';
import {
  Activity,
  AlarmClock,
  Archive,
  AtSign,
  Bell,
  BellRing,
  Bookmark,
  CalendarClock,
  Camera,
  Check,
  ChevronRight,
  CirclePlay,
  CircleQuestionMark,
  Clock,
  Compass,
  Copy,
  FileText,
  Forward,
  Hand,
  Hash,
  Image,
  Info,
  LifeBuoy,
  LogIn,
  Mail,
  MessageCircle,
  MessagesSquare,
  Mic,
  MicOff,
  MousePointerClick,
  Palette,
  Paperclip,
  PenLine,
  Phone,
  PhoneIncoming,
  Pin,
  Plus,
  Presentation,
  QrCode,
  Reply,
  ScreenShare,
  Search,
  Send,
  Settings2,
  Share2,
  Siren,
  SmilePlus,
  Sparkles,
  Star,
  Sunrise,
  SwitchCamera,
  Ticket,
  Trash2,
  Type,
  UserCheck,
  UserRound,
  Users,
  Vibrate,
  Video,
  Volume2,
  type LucideProps,
} from 'lucide-react-native';

import {
  CallIcon,
  HuddleIcon,
  MentionIcon,
  SendToChannelIcon,
  StartThreadIcon,
} from '@/src/components/icons';

import type { GuideIconKey } from './types';

type LucideEntry = { kind: 'lucide'; Icon: ComponentType<LucideProps> };
type SvgEntry = { kind: 'svg'; Icon: ComponentType<SvgProps> };
type GuideIconEntry = LucideEntry | SvgEntry;

const lucide = (component: ComponentType<LucideProps>): LucideEntry => ({
  kind: 'lucide',
  Icon: component,
});
const svg = (component: ComponentType<SvgProps>): SvgEntry => ({ kind: 'svg', Icon: component });

/**
 * Every icon a guide may reference, by key. Lucide glyphs cover the generic
 * vocabulary; the app's own SVGs cover the buttons users actually see in the
 * message actions sheet and chat header, so a `[[StartThread]]` token shows the
 * exact glyph the step is pointing at.
 */
export const GUIDE_ICONS: Readonly<Record<GuideIconKey, GuideIconEntry>> = {
  Activity: lucide(Activity),
  AlarmClock: lucide(AlarmClock),
  Archive: lucide(Archive),
  AtSign: lucide(AtSign),
  Bell: lucide(Bell),
  BellRing: lucide(BellRing),
  Bookmark: lucide(Bookmark),
  Camera: lucide(Camera),
  CalendarClock: lucide(CalendarClock),
  Check: lucide(Check),
  ChevronRight: lucide(ChevronRight),
  CirclePlay: lucide(CirclePlay),
  CircleQuestionMark: lucide(CircleQuestionMark),
  Clock: lucide(Clock),
  Compass: lucide(Compass),
  Copy: lucide(Copy),
  FileText: lucide(FileText),
  Forward: lucide(Forward),
  Hand: lucide(Hand),
  Hash: lucide(Hash),
  Image: lucide(Image),
  Info: lucide(Info),
  LifeBuoy: lucide(LifeBuoy),
  LogIn: lucide(LogIn),
  Mail: lucide(Mail),
  MessageCircle: lucide(MessageCircle),
  MessagesSquare: lucide(MessagesSquare),
  Mic: lucide(Mic),
  MicOff: lucide(MicOff),
  MousePointerClick: lucide(MousePointerClick),
  Palette: lucide(Palette),
  Paperclip: lucide(Paperclip),
  PenLine: lucide(PenLine),
  Phone: lucide(Phone),
  PhoneIncoming: lucide(PhoneIncoming),
  Pin: lucide(Pin),
  Plus: lucide(Plus),
  Presentation: lucide(Presentation),
  QrCode: lucide(QrCode),
  Reply: lucide(Reply),
  ScreenShare: lucide(ScreenShare),
  Search: lucide(Search),
  Send: lucide(Send),
  Settings2: lucide(Settings2),
  Share2: lucide(Share2),
  Siren: lucide(Siren),
  SmilePlus: lucide(SmilePlus),
  Sparkles: lucide(Sparkles),
  Star: lucide(Star),
  Sunrise: lucide(Sunrise),
  SwitchCamera: lucide(SwitchCamera),
  Ticket: lucide(Ticket),
  Trash2: lucide(Trash2),
  Type: lucide(Type),
  UserCheck: lucide(UserCheck),
  UserRound: lucide(UserRound),
  Users: lucide(Users),
  Vibrate: lucide(Vibrate),
  Video: lucide(Video),
  Volume2: lucide(Volume2),
  StartThread: svg(StartThreadIcon),
  SendToChannel: svg(SendToChannelIcon),
  Mention: svg(MentionIcon),
  Huddle: svg(HuddleIcon),
  Call: svg(CallIcon),
};

export function isGuideIconKey(key: string): key is GuideIconKey {
  return Object.prototype.hasOwnProperty.call(GUIDE_ICONS, key);
}

type GuideIconProps = {
  name: GuideIconKey;
  size?: number;
  color: string;
  strokeWidth?: number;
};

/** Renders a catalog icon key, hiding the lucide-vs-SVG prop difference. */
export const GuideIcon = ({
  name,
  size = 20,
  color,
  strokeWidth = 2,
}: GuideIconProps): ReactElement => {
  const entry = GUIDE_ICONS[name];
  if (entry.kind === 'lucide') {
    const { Icon } = entry;
    return <Icon size={size} color={color} strokeWidth={strokeWidth} />;
  }
  const { Icon } = entry;
  return <Icon width={size} height={size} color={color} />;
};
