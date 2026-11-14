const iconPaths: Record<string, string> = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  box: '<path d="m12 3 9 5v8l-9 5-9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8M7.5 5.5l9 5"/>',
  warehouse:
    '<path d="m3 8 9-5 9 5v13H3Z"/><path d="M7 21V11h10v10M7 15h10M7 18h10M12 11v10"/>',
  receive: '<path d="M12 3v11m-4-4 4 4 4-4M4 13l-1 8h18l-1-8M4 13h4m8 0h4"/>',
  orders:
    '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v4H9ZM9 12h6M9 16h4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  spark:
    '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  alert: '<path d="m12 3 10 18H2Zm0 5v6m0 3v1"/>',
  back: '<path d="M20 12H4m5-5-5 5 5 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  scan: '<path d="M3 8V3h5m8 0h5v5m0 8v5h-5M8 21H3v-5M3 12h18"/>',
  chart: '<path d="M4 3v18h17M8 16v-4m5 4V7m5 9V3"/>',
  edit: '<path d="m15 4 5 5M4 16 16 4a3 3 0 0 1 4 4L8 20l-5 1Z"/>',
  truck:
    '<path d="M2 5h12v12H2ZM14 9h4l4 5v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  route:
    '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v6a3 3 0 0 0 3 3h6m3 1V8a3 3 0 0 0-3-3h-3"/>',
  refresh: '<path d="M3 9a9 9 0 0 1 15-5l3 3M21 3v4h-4M21 15A9 9 0 0 1 6 20l-3-3m0 4v-4h4"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  history: '<path d="M3 4v5h5M3 9a9 9 0 1 1 0 7M12 7v5l3 2"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/>',
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

export function Logo() {
  return (
    <svg className="brand-logo" viewBox="0 0 38 42" aria-hidden>
      <path d="M19 2 35 11v20L19 40 3 31V11Z" fill="none" stroke="#24b5ec" strokeWidth="3" />
      <path d="m19 11 8 5v10l-8 5-8-5V16Z" fill="none" stroke="#69cefa" strokeWidth="1.7" />
      <path d="m11 16 8 5 8-5M19 21v10" fill="none" stroke="#69cefa" strokeWidth="1.7" />
    </svg>
  );
}
