import {
  AlignLeft,
  Clock,
  Columns2,
  Image as ImageIcon,
  Megaphone,
  Minus,
  MousePointerClick,
  MoveVertical,
  Share2,
  Table,
  Type,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { BlockType } from "../../../shared/email/design";

export const BLOCK_ICONS: Record<BlockType, LucideIcon> = {
  heading: Type,
  text: AlignLeft,
  button: MousePointerClick,
  image: ImageIcon,
  details: Table,
  callout: Megaphone,
  eta: Clock,
  tech: UserRound,
  columns: Columns2,
  social: Share2,
  divider: Minus,
  spacer: MoveVertical,
};

export const PALETTE_GROUPS: { label: string; types: BlockType[] }[] = [
  { label: "Content", types: ["heading", "text", "button", "image", "details"] },
  { label: "Arrival", types: ["eta", "tech", "callout"] },
  { label: "Layout", types: ["columns", "social", "divider", "spacer"] },
];

export const PALETTE_PREFIX = "palette:";
