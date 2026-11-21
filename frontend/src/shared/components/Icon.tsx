import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Bell,
  Box,
  Building2,
  Calendar,
  Car,
  ChartColumn,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  Droplet,
  Eye,
  EyeOff,
  Factory,
  FileText,
  FlaskConical,
  History,
  ImagePlus,
  Hospital,
  House,
  Info,
  Landmark,
  Layers,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  Mail,
  Map,
  MapPin,
  Maximize,
  Menu,
  Motorbike,
  MousePointer2,
  Package,
  Paperclip,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Save,
  ScanLine,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  CircleAlert,
  Truck,
  Users,
  Warehouse,
  X,
  type LucideIcon,
} from 'lucide-react';

/**
 * Iconos de la app (lucide-react). Se referencian por nombre para mantener
 * la API `<Icon name="..." />` en todas las pantallas.
 *
 * Para añadir uno: impórtalo de 'lucide-react' y agrégalo al mapa.
 * Catálogo: https://lucide.dev/icons
 */
export const icons = {
  home: House,
  box: Package,
  warehouse: Warehouse,
  receive: PackagePlus,
  orders: ClipboardList,
  cart: ShoppingCart,
  truck: Truck,
  car: Car,
  motorcycle: Motorbike,
  users: Users,
  chart: ChartColumn,
  settings: Settings,
  search: Search,
  chevron: ChevronRight,
  'chevron-left': ChevronLeft,
  arrow: ArrowRight,
  back: ArrowLeft,
  bell: Bell,
  calendar: Calendar,
  plus: Plus,
  close: X,
  check: Check,
  pin: MapPin,
  spark: Sparkles,
  route: Route,
  history: History,
  swap: ArrowLeftRight,
  alert: TriangleAlert,
  download: Download,
  edit: Pencil,
  trash: Trash2,
  save: Save,
  file: FileText,
  refresh: RefreshCw,
  menu: Menu,
  cube: Box,
  map: Map,
  layers: Layers,
  grid: LayoutGrid,
  expand: Maximize,
  cursor: MousePointer2,
  eye: Eye,
  'eye-off': EyeOff,
  shield: ShieldCheck,
  building: Building2,
  hospital: Hospital,
  factory: Factory,
  landmark: Landmark,
  flask: FlaskConical,
  droplet: Droplet,
  mail: Mail,
  info: Info,
  scan: ScanLine,
  loader: LoaderCircle,
  logout: LogOut,
  upload: Upload,
  clip: Paperclip,
  image: ImagePlus,
  stop: CircleAlert,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;

/**
 * Icono estándar. El tamaño y grosor de trazo los controla `.icon` en
 * global.css (y las reglas de cada contexto), no props.
 * `name` acepta string para nombres que vienen de datos; si no existe se
 * muestra `box`.
 */
export function Icon({
  name,
  className = '',
}: {
  name: IconName | (string & {});
  className?: string;
}) {
  const Cmp = (icons as Record<string, LucideIcon>)[name] ?? icons.box;
  return <Cmp className={`icon ${className}`.trim()} aria-hidden />;
}

/** Spinner de carga (gira con `.spinner` en global.css). */
export function Spinner({ className = '' }: { className?: string }) {
  return <LoaderCircle className={`icon spinner ${className}`.trim()} aria-hidden />;
}

export const Logo = () => (
  <svg viewBox="0 0 38 42" aria-hidden>
    <path d="M19 2 35 11v20L19 40 3 31V11Z" fill="none" stroke="#24b5ec" strokeWidth="3" />
    <path d="m19 11 8 5v10l-8 5-8-5V16Z" fill="none" stroke="#69cefa" strokeWidth="1.7" />
    <path d="m11 16 8 5 8-5M19 21v10" fill="none" stroke="#69cefa" strokeWidth="1.7" />
  </svg>
);
