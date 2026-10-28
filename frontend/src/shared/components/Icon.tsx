const iconPaths: Record<string, string> = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  box: '<path d="m12 3 9 5v8l-9 5-9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8M7.5 5.5l9 5"/>',
  warehouse:
    '<path d="m3 8 9-5 9 5v13H3Z"/><path d="M7 21V11h10v10M7 15h10M7 18h10M12 11v10"/>',
  receive: '<path d="M12 3v11m-4-4 4 4 4-4M4 13l-1 8h18l-1-8M4 13h4m8 0h4"/>',
  orders:
    '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v4H9ZM9 12h6M9 16h4"/>',
  cart: '<path d="M2 3h3l3 12h11l3-8H6M9 19h.01M18 19h.01"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
  truck:
    '<path d="M2 5h12v12H2ZM14 9h4l4 5v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  users:
    '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m1 5a5 5 0 0 1 3 6"/>',
  chart: '<path d="M4 3v18h17M8 16v-4m5 4V7m5 9V3"/>',
  settings:
    '<path d="m9 3-1 3-3 1v3l-2 2 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-2V7l-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  arrow: '<path d="M4 12h16m-5-5 5 5-5 5"/>',
  back: '<path d="M20 12H4m5-5-5 5 5 5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 8-3 8-3 9h18c0-1-3-1-3-9M10 21h4"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  spark:
    '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  route:
    '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v6a3 3 0 0 0 3 3h6m3 1V8a3 3 0 0 0-3-3h-3"/>',
  history: '<path d="M3 4v5h5M3 9a9 9 0 1 1 0 7M12 7v5l3 2"/>',
  swap: '<path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/>',
  alert: '<path d="m12 3 10 18H2Zm0 5v6m0 3v1"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  edit: '<path d="m15 4 5 5M4 16 16 4a3 3 0 0 1 4 4L8 20l-5 1Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  save: '<path d="M4 3h13l4 4v14H3V3ZM7 3v6h10V3M7 21v-8h10v8"/>',
  file: '<path d="M5 3h9l5 5v13H5ZM14 3v6h5M9 13h6M9 17h6"/>',
  refresh: '<path d="M3 9a9 9 0 0 1 15-5l3 3M21 3v4h-4M21 15A9 9 0 0 1 6 20l-3-3m0 4v-4h4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  cube: '<path d="m12 2 10 5v10l-10 5L2 17V7Z"/><path d="m2 7 10 5 10-5M12 12v10"/>',
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16"/>',
  layers:
    '<path d="m12 3 10 5-10 5L2 8Zm-9 10 9 5 9-5M3 18l9 4 9-4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  expand: '<path d="M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6"/>',
  cursor: '<path d="m4 3 6 18 3-8 8-3Z"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 10-8 10S4 17 4 12V6Z"/><path d="m8 12 3 3 5-6"/>',
  building:
    '<path d="M4 21V3h12v18M16 9h5v12H2M8 7h1m3 0h1M8 11h1m3 0h1M8 15h1m3 0h1M8 21v-3h4v3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 5 9 8 9-8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/>',
  scan: '<path d="M3 8V3h5m8 0h5v5m0 8v5h-5M8 21H3v-5M3 12h18"/>',
};

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <svg
      className={`icon ${className}`}
      aria-hidden
      viewBox="0 0 24 24"
      dangerouslySetInnerHTML={{ __html: iconPaths[name] ?? iconPaths.box }}
    />
  );
}

export const Logo = () => (
  <svg viewBox="0 0 38 42" aria-hidden>
    <path
      d="M19 2 35 11v20L19 40 3 31V11Z"
      fill="none"
      stroke="#24b5ec"
      strokeWidth="3"
    />
    <path
      d="m19 11 8 5v10l-8 5-8-5V16Z"
      fill="none"
      stroke="#69cefa"
      strokeWidth="1.7"
    />
    <path d="m11 16 8 5 8-5M19 21v10" fill="none" stroke="#69cefa" strokeWidth="1.7" />
  </svg>
);
