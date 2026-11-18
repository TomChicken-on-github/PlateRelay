/** "1h 04m", or "42m" under an hour. */
export function duration(seconds: number): string {
  const m = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

/** "15:42" in the browser's time zone. */
/** 14:03:27 */
export function clockSeconds(d: Date | string | number): string {
  return new Date(d).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function clock(d: Date | string | number): string {
  return new Date(d).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "11/16 18:30". */
export function shortDateTime(d: Date | string | number): string {
  const x = new Date(d);
  return `${x.getMonth() + 1}/${x.getDate()} ${clock(x)}`;
}

/** "35 分钟前", "2 小时前", or a date for older. */
export function ago(d: Date | string | number, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(d).getTime()) / 1000);
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return shortDateTime(d);
}

/** A wait range in hours, e.g. "1–2 小时"; under an hour in minutes. */
export function waitRange(minSeconds: number, maxSeconds: number): string {
  if (maxSeconds < 3600) return `${Math.max(1, Math.round(minSeconds / 60))}–${Math.max(1, Math.round(maxSeconds / 60))} 分钟`;
  const h = (s: number) => Math.round((s / 3600) * 2) / 2;
  return `${h(minSeconds)}–${Math.max(h(minSeconds), h(maxSeconds))} 小时`;
}

/** "18.4 MB", "820 KB". */
export function bytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
