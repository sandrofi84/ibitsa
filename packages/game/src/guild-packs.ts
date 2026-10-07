import type { PackView } from '@ibitsa/protocol';
import { button, el } from './dom';

/** How much bigger the preview draws a 16×16 character. */
const PREVIEW_SCALE = 3;

/**
 * The Guild Hall's Packs tab (§9.3, #183): each pack found, its validator errors, a live preview of a
 * character walking, and "Use this pack". A pack with errors can't be used.
 */
export function packsTab({
  packs,
  active,
  onUse,
}: {
  packs: PackView[] | null;
  active: string;
  onUse: (id: string) => void;
}): HTMLElement[] {
  if (packs === null) return [el('p', { text: 'Looking for packs…' })];
  const list = el('ul', { className: 'packs' });
  for (const pack of packs) list.append(packEntry({ pack, active: pack.id === active, onUse }));
  return [
    el('p', {
      className: 'note',
      text: 'Packs live in ~/.ibitsa/packs/ (yours) and .ibitsa/packs/ (this project).',
    }),
    list,
  ];
}

/** Where a pack comes from, in words. */
export function packSource(scope: PackView['scope']): string {
  return scope === 'builtin' ? 'built in' : scope === 'user' ? 'yours' : 'this project';
}

function packEntry({
  pack,
  active,
  onUse,
}: {
  pack: PackView;
  active: boolean;
  onUse: (id: string) => void;
}): HTMLElement {
  const li = el('li', { className: `entry pack${active ? ' active' : ''}` });
  li.append(el('strong', { text: pack.name }), ` (${packSource(pack.scope)})`);
  if (pack.preview) li.append(preview(pack.preview));
  if (active) li.append(' ', el('span', { className: 'layer user', text: 'In use' }));
  else {
    const use = button({ label: 'Use this pack', onClick: () => onUse(pack.id) });
    use.disabled = pack.errors.length > 0;
    li.append(' ', use);
  }
  if (pack.errors.length > 0) {
    const errors = el('ul', { className: 'pack-errors' });
    for (const e of pack.errors) errors.append(el('li', { text: e }));
    li.append(errors);
  }
  return li;
}

/**
 * A character walking, from the pack's own sheet: one row, stepped frame by frame, drawn at its true size
 * and scaled up so the pixels stay crisp.
 */
function preview(p: NonNullable<PackView['preview']>): HTMLElement {
  const box = el('span', { className: 'pack-preview' });
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', 'A character from this pack, walking');
  box.style.width = `${p.frameWidth * PREVIEW_SCALE}px`;
  box.style.height = `${p.frameHeight * PREVIEW_SCALE}px`;
  const sprite = el('span', { className: 'pack-sprite' });
  sprite.style.width = `${p.frameWidth}px`;
  sprite.style.height = `${p.frameHeight}px`;
  sprite.style.backgroundImage = `url("${p.sheet}")`;
  sprite.style.backgroundPosition = `0 ${-p.row * p.frameHeight}px`;
  sprite.style.transform = `scale(${PREVIEW_SCALE})`;
  box.append(sprite);
  if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && sprite.animate) {
    const y = `${-p.row * p.frameHeight}px`;
    sprite.animate(
      [
        { backgroundPosition: `0 ${y}` },
        { backgroundPosition: `${-p.frames * p.frameWidth}px ${y}` },
      ],
      { duration: (p.frames / p.fps) * 1000, iterations: Infinity, easing: `steps(${p.frames})` },
    );
  }
  return box;
}
