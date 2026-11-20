/**
 * Copies text. navigator.clipboard only exists on secure origins, and the panel is often opened over plain
 * HTTP on the venue LAN, so fall back to selecting a hidden textarea and running the copy command.
 * `host` is where the textarea goes: inside an open dialog, so the dialog's focus trap does not block it.
 */
export async function copyText(text: string, host: HTMLElement = document.body): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to the old way */
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
  host.appendChild(ta);
  const active = document.activeElement as HTMLElement | null;
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  active?.focus();
  return ok;
}
