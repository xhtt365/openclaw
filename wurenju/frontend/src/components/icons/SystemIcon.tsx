"use client";

import {
  Archive,
  BadgeCheck,
  BookOpen,
  Bot,
  Brain,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChartColumn,
  ChartLine,
  CircleCheckBig,
  ClipboardList,
  Clapperboard,
  Clock3,
  Coffee,
  Crown,
  FilePenLine,
  FileText,
  Flame,
  FlaskConical,
  Folder,
  FolderOpen,
  Gem,
  Handshake,
  Hammer,
  HardHat,
  HeartPulse,
  Lightbulb,
  Link2,
  Megaphone,
  MessageSquare,
  Microscope,
  Monitor,
  Package,
  Palette,
  PartyPopper,
  Pin,
  Puzzle,
  ReceiptText,
  RefreshCw,
  Rocket,
  Ruler,
  Search,
  Settings2,
  Shield,
  Smartphone,
  Sparkles,
  Target,
  Trash2,
  TriangleAlert,
  UsersRound,
  Wrench,
  Zap,
  type LucideProps,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SystemIconKey } from "@/utils/systemIcons";

type IconComponent = ComponentType<Omit<LucideProps, "ref">>;

const LobsterIcon = ({ className, ...props }: Omit<LucideProps, "ref">) => (
  <svg
    viewBox="0 0 120 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path
      d="M60 10C30 10 15 35 15 55C15 75 30 95 45 100V110H55V100C55 100 60 102 65 100V110H75V100C90 95 105 75 105 55C105 35 90 10 60 10Z"
      fill="currentColor"
      fillOpacity="0.92"
    />
    <path
      d="M20 45C5 40 0 50 5 60C10 70 20 65 25 55C28 48 25 45 20 45Z"
      fill="currentColor"
      fillOpacity="0.92"
    />
    <path
      d="M100 45C115 40 120 50 115 60C110 70 100 65 95 55C92 48 95 45 100 45Z"
      fill="currentColor"
      fillOpacity="0.92"
    />
    <path
      d="M45 15Q35 5 30 8"
      stroke="currentColor"
      strokeWidth="6"
      strokeLinecap="round"
      opacity="0.92"
    />
    <path
      d="M75 15Q85 5 90 8"
      stroke="currentColor"
      strokeWidth="6"
      strokeLinecap="round"
      opacity="0.92"
    />
    <circle cx="45" cy="35" r="6" fill="white" />
    <circle cx="75" cy="35" r="6" fill="white" />
  </svg>
);

const SYSTEM_ICON_MAP: Record<SystemIconKey, IconComponent> = {
  archive: Archive,
  book: BookOpen,
  bot: Bot,
  brain: Brain,
  briefcase: BriefcaseBusiness,
  building: Building2,
  calendar: CalendarDays,
  chartColumn: ChartColumn,
  chartLine: ChartLine,
  checkBadge: BadgeCheck,
  clipboard: ClipboardList,
  clapperboard: Clapperboard,
  clock: Clock3,
  coffee: Coffee,
  crown: Crown,
  edit: FilePenLine,
  fileText: FileText,
  flask: FlaskConical,
  folder: Folder,
  folderOpen: FolderOpen,
  flame: Flame,
  gem: Gem,
  handshake: Handshake,
  hammer: Hammer,
  hardHat: HardHat,
  heartPulse: HeartPulse,
  lightbulb: Lightbulb,
  link: Link2,
  lobster: LobsterIcon,
  megaphone: Megaphone,
  messageSquare: MessageSquare,
  microscope: Microscope,
  monitor: Monitor,
  package: Package,
  palette: Palette,
  party: PartyPopper,
  pin: Pin,
  puzzle: Puzzle,
  receipt: ReceiptText,
  refresh: RefreshCw,
  rocket: Rocket,
  ruler: Ruler,
  search: Search,
  settings: Settings2,
  shield: Shield,
  smartphone: Smartphone,
  sparkles: Sparkles,
  target: Target,
  trash: Trash2,
  users: UsersRound,
  warning: TriangleAlert,
  wrench: Wrench,
  zap: Zap,
};

export function SystemIcon({
  name,
  className,
  strokeWidth = 1.9,
  ...props
}: { name: SystemIconKey } & Omit<LucideProps, "ref">) {
  const Icon = SYSTEM_ICON_MAP[name];

  return (
    <Icon
      className={cn("h-[1em] w-[1em] shrink-0", className)}
      strokeWidth={strokeWidth}
      aria-hidden="true"
      {...props}
    />
  );
}

export function IconText({
  icon,
  children,
  className,
  iconClassName,
  labelClassName,
}: {
  icon: ReactNode;
  children: ReactNode;
  className?: string;
  iconClassName?: string;
  labelClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className={cn("inline-flex shrink-0 items-center justify-center", iconClassName)}>
        {icon}
      </span>
      <span className={labelClassName}>{children}</span>
    </span>
  );
}

export function StatusDot({ className }: { className?: string }) {
  return (
    <span className={cn("inline-block h-2.5 w-2.5 rounded-full", className)} aria-hidden="true" />
  );
}

export function CheckBadgeIcon({ className }: { className?: string }) {
  return (
    <CircleCheckBig className={cn("h-[1em] w-[1em] shrink-0", className)} aria-hidden="true" />
  );
}
