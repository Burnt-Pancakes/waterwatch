/**
 * App icon catalog. Import icons from here instead of directly from Lucide.
 * Semantic aliases keep the rest of the app independent of the chosen glyph.
 * Original Lucide names remain available for existing controls and primitives.
 */

// Site Types — access points and the map's "All" filter.
export {
  Ship as BoatRamp,
  Umbrella as Beach,
  Fish as Fishing,
  Anchor as Marina,
  Grid3X3 as All,
} from "lucide-react";
export { WaterIcon as Rivers } from "./WaterIcon";
export { KayakIcon as Kayak } from "./KayakIcon";
export { SwimIcon as SwimArea } from "./SwimIcon";
export { JellyfishIcon as Jellyfish } from "@/modules/seaNettles/components/JellyfishIcon";

// Navigation — main tabs, account navigation, and directions.
export {
  MapPin as MapHome,
  Route as Plan,
  ArrowLeft,
  ArrowRight,
  Navigation,
  LogIn,
  LogOut,
  UserRound,
  UserPlus,
  Heart,
  Bell,
  BellOff,
  Route,
} from "lucide-react";
export { TidesIcon as Tides } from "./TidesIcon";

// Map Type — basemap styles and map controls.
export {
  Map,
  Moon,
  Satellite,
  Layers,
  Crosshair,
  MapPin,
  SlidersHorizontal,
  Grid3X3,
  Search,
  Plus,
  Minus,
  Undo,
} from "lucide-react";

// Water Conditions — status, weather, river stage, and tides.
export {
  AlertTriangle as Warning,
  CheckCircle as Pass,
  XCircle as Fail,
  HelpCircle as NoData,
  AlertTriangle,
  TriangleAlert,
  CheckCircle,
  XCircle,
  HelpCircle,
  Activity,
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpRight,
  Cloud,
  CloudRain,
  Droplet,
  Thermometer,
  Wind,
  Waves,
} from "lucide-react";
export { WarningIcon } from "./WarningIcon";

// Actions and Feedback — forms, alerts, sharing, and editing.
export {
  Check,
  Clock,
  Fish,
  Info,
  KeyRound,
  Leaf,
  Loader2,
  LoaderCircle,
  Mail,
  MessageCircle,
  Pencil,
  PersonStanding,
  Sailboat,
  Send,
  Share2,
  Star,
  Trash2,
  X,
} from "lucide-react";

// Site marker glyphs — legacy names used by marker mappings and tests.
export { Anchor, Ship, Umbrella } from "lucide-react";

// Interface Controls — shared menus, dialogs, carousels, and other primitives.
export {
  ChevronDown,
  ChevronDownIcon,
  ChevronLeft,
  ChevronLeftIcon,
  ChevronRight,
  ChevronRightIcon,
  ChevronUp,
  Circle,
  GripVertical,
  MoreHorizontal,
  PanelLeft,
} from "lucide-react";

export type { LucideIcon, LucideProps } from "lucide-react";