import type { ReplayOptions, ReplayStatus } from '@ibitsa/agent-fake';
import type { DevHost } from './dev-host';

/** Replay controls for standalone development; not part of the extension build (spec §13). */
export function mountOverlay({
  host,
  fixtures,
  current,
}: {
  host: DevHost;
  fixtures: string[];
  current: string;
}): void {
  const el = document.createElement('div');
  el.className = 'dev-overlay';
  el.innerHTML = `
    <strong>Replay</strong>
    <label>Fixture <select data-k="fixture">${fixtures.map((f) => `<option${f === current ? ' selected' : ''}>${f}</option>`).join('')}</select></label>
    <span class="row">
      <button data-k="play">Play</button><button data-k="pause">Pause</button><button data-k="step">Step</button>
    </span>
    <label>Speed <select data-k="speed">
      ${['0.25', '0.5', '1', '2', '4', '8', '16', 'instant'].map((s) => `<option${s === '1' ? ' selected' : ''}>${s}</option>`).join('')}
    </select></label>
    <label><input type="checkbox" data-k="gap" checked> Cap gaps at 3 s</label>
    <label><input type="checkbox" data-k="loop"> Loop</label>
    <label>Mode <select data-k="mode"><option>auto</option><option>interactive</option></select></label>
    <output data-k="status"></output>`;
  document.body.appendChild(el);
  const q = <T extends HTMLElement>(k: string) => el.querySelector(`[data-k="${k}"]`) as T;

  // Start from the replay's actual options (the URL may have set them).
  const o = host.replay.options;
  q<HTMLSelectElement>('speed').value = String(o.speed);
  q<HTMLInputElement>('gap').checked = o.gapCapMs !== null;
  q<HTMLInputElement>('loop').checked = o.loop;
  q<HTMLSelectElement>('mode').value = o.mode;

  const set = (options: Partial<ReplayOptions>) => host.replay.setOptions(options);
  q<HTMLButtonElement>('play').onclick = () => host.replay.play();
  q<HTMLButtonElement>('pause').onclick = () => host.replay.pause();
  q<HTMLButtonElement>('step').onclick = () => host.replay.step();
  q<HTMLSelectElement>('speed').onchange = (e) => {
    const v = (e.target as HTMLSelectElement).value;
    set({ speed: v === 'instant' ? 'instant' : Number(v) });
  };
  q<HTMLInputElement>('gap').onchange = (e) =>
    set({ gapCapMs: (e.target as HTMLInputElement).checked ? 3_000 : null });
  q<HTMLInputElement>('loop').onchange = (e) =>
    set({ loop: (e.target as HTMLInputElement).checked });
  q<HTMLSelectElement>('mode').onchange = (e) =>
    set({ mode: (e.target as HTMLSelectElement).value as ReplayOptions['mode'] });
  q<HTMLSelectElement>('fixture').onchange = (e) => {
    const url = new URL(location.href);
    url.searchParams.set('fixture', (e.target as HTMLSelectElement).value);
    location.href = url.toString();
  };

  const status = q<HTMLOutputElement>('status');
  host.onStatus((s: ReplayStatus) => {
    const parts = [
      `${s.position}/${s.total}`,
      s.playing ? 'playing' : s.finished ? 'finished' : 'paused',
    ];
    if (s.waitingFor) parts.push(`waiting for you: ${s.waitingFor}`);
    if (s.diverged) parts.push('diverged from recording');
    status.textContent = parts.join(' · ');
  });
}
