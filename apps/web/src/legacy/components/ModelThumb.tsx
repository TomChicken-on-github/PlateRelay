/** Placeholder render of a sliced model until real 3MF thumbnails exist. */
export function ModelThumb({ c1, c2, bg = "var(--md-sc)", slot = true }: { c1: string; c2?: string; bg?: string; slot?: boolean }) {
  return (
    <svg viewBox="0 0 200 200" className="block size-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <polygon points="100,52 192,100 100,148 8,100" fill={bg} stroke="var(--md-outline-variant)" />
      <path d="M52 98v22a48 24 0 0 0 96 0V98Z" fill={c1} opacity=".78" />
      <ellipse cx="100" cy="98" rx="48" ry="24" fill={c1} />
      <ellipse cx="100" cy="98" rx="24" ry="12" fill={bg} />
      {slot && <rect x="150" y="104" width="22" height="14" rx="3" fill={c2 || c1} />}
    </svg>
  );
}

/** Larger preview with the build plate outline, used on review and order detail. */
export function ModelPreview({ c1 }: { c1: string }) {
  return (
    <svg viewBox="0 0 200 200" className="block size-full" role="img" aria-label="模型预览">
      <polygon points="100,40 192,92 100,144 8,92" fill="var(--md-sc)" stroke="var(--md-outline-variant)" />
      <polygon points="100,52 180,98 100,144 20,98" fill="none" stroke="var(--md-outline-variant)" strokeDasharray="3 3" />
      <path d="M48 90v34a52 26 0 0 0 104 0V90Z" fill={c1} opacity=".78" />
      <ellipse cx="100" cy="90" rx="52" ry="26" fill={c1} />
      <ellipse cx="100" cy="90" rx="26" ry="13" fill="var(--md-sc)" />
      <rect x="146" y="98" width="24" height="16" rx="3" fill={c1} opacity=".9" />
    </svg>
  );
}

/** Placeholder photo (finish, failure or stock-in shot). */
export function PhotoPlaceholder({ c, label }: { c: string; label?: string }) {
  return (
    <div className="relative aspect-[5/2] overflow-hidden rounded-xl">
      <svg viewBox="0 0 320 128" preserveAspectRatio="xMidYMid slice" className="block size-full" aria-hidden="true">
        <defs>
          <linearGradient id="ph-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8a8590" />
            <stop offset="1" stopColor="#4b4750" />
          </linearGradient>
        </defs>
        <rect width="320" height="128" fill="url(#ph-g)" />
        <rect x="0" y="92" width="320" height="36" fill="#2d2b31" />
        <path d="M118 92l12-44h60l12 44Z" fill={c} />
        <rect x="118" y="84" width="84" height="8" rx="2" fill={c} opacity=".7" />
      </svg>
      {label && <span className="absolute bottom-2 left-2 rounded-md bg-black/65 px-2 py-0.5 text-body-s font-medium tracking-normal text-white">{label}</span>}
    </div>
  );
}

export function ShotThumb({ c }: { c: string }) {
  return (
    <svg viewBox="0 0 64 64" preserveAspectRatio="xMidYMid slice" className="block size-full" aria-hidden="true">
      <rect width="64" height="64" fill="#5b5760" />
      <rect y="46" width="64" height="18" fill="#2d2b31" />
      <path d="M18 46l4-18h20l4 18Z" fill={c} />
    </svg>
  );
}

export function FilamentDots({ fil }: { fil: [string, string][] }) {
  return (
    <span>
      {fil.map(([c, t], i) => (
        <span key={i} className="mr-1.5 inline-flex items-center whitespace-nowrap">
          <i className="mr-1 inline-block size-[9px] rounded-full shadow-[0_0_0_1px_var(--md-outline-variant)]" style={{ background: c }} />
          {t}
        </span>
      ))}
    </span>
  );
}
