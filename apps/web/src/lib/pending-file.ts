/* A file dropped on the overview's drop zone, handed to the submit page that opens next. */
let pending: File | null = null;

export const setPendingFile = (f: File) => void (pending = f);

export function takePendingFile(): File | null {
  const f = pending;
  pending = null;
  return f;
}
