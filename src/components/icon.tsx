// Ikon garis satu keluarga (24px, stroke 1.75) menggantikan emoji agar tampilan konsisten di semua perangkat.
const P = {
  truck: <><path d="M3 6h11v10H3z" /><path d="M14 10h4l3 3v3h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  alert: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></>,
  helmet: <><path d="M4 16a8 8 0 0116 0z" /><path d="M3 16h18v2H3zM12 8v4" /></>,
  swap: <><path d="M4 8h14l-3-3M20 16H6l3 3" /></>,
  camera: <><path d="M4 8h3l2-2h6l2 2h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  signal: <><path d="M3 9a14 14 0 0118 0M6 12.5a9 9 0 0112 0M9 16a4.5 4.5 0 016 0" /><circle cx="12" cy="19" r=".6" /></>,
  clip: <><path d="M20 11l-8 8a5 5 0 01-7-7l9-9a3.3 3.3 0 014.7 4.7L10 16.5a1.7 1.7 0 01-2.4-2.4L15 7" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  home: <><path d="M4 11l8-7 8 7" /><path d="M6 10v10h12V10" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  folder: <path d="M3 6h6l2 2h10v11H3z" />,
  doc: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
  link: <><path d="M10 14a4 4 0 005.6 0l3-3a4 4 0 00-5.6-5.6l-1 1" /><path d="M14 10a4 4 0 00-5.6 0l-3 3a4 4 0 005.6 5.6l1-1" /></>,
} as const;

export type IconName = keyof typeof P;

export function Icon({ name, size = 22, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden className={`shrink-0 ${className}`}>{P[name]}</svg>
  );
}
