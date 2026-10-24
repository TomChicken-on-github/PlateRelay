/** Tonal initial avatar; the hue comes from the name so a person keeps the same colour everywhere. */
export function Avatar({ name, size }: { name?: string | null; size: number }) {
  const style = { width: size, height: size, fontSize: size * 0.45 };
  const base = "inline-grid flex-none place-items-center rounded-full font-medium tracking-normal";
  if (!name) {
    return (
      <span className={`${base} bg-sc-highest text-on-variant`} style={style} aria-hidden="true">
        ?
      </span>
    );
  }
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <span className={`${base} text-[#1d1b20]`} style={{ ...style, background: `hsl(${hue} 70% 82%)` }} aria-hidden="true">
      {name[0]}
    </span>
  );
}
