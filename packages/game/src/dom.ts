/** Tiny DOM builders shared by the panels. Text always goes in as text, never as HTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  { text, className }: { text?: string; className?: string } = {},
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}

export function button({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}): HTMLButtonElement {
  const b = el('button', { text: label });
  b.type = 'button';
  b.onclick = onClick;
  return b;
}
