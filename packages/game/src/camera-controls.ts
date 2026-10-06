import type * as Phaser from 'phaser';
import type { CameraState } from './camera-director.types';
import { button, el } from './dom';
import { CAMERA_EVENTS } from './world-scene';

/**
 * Zoom out, zoom in and the auto-focus switch (#59), as buttons at the middle of the map's left edge. They
 * work like the wheel and the + / - / 0 keys, and are reachable by keyboard.
 */
export function mountCameraControls(events: Phaser.Events.EventEmitter): void {
  const bar = el('div', { className: 'camera-controls' });
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Map view');
  const out = button({ label: '−', onClick: () => events.emit(CAMERA_EVENTS.zoomOut) });
  out.setAttribute('aria-label', 'Zoom out');
  out.title = 'Zoom out (−); 0 shows the whole map';
  const zoomIn = button({ label: '+', onClick: () => events.emit(CAMERA_EVENTS.zoomIn) });
  zoomIn.setAttribute('aria-label', 'Zoom in');
  zoomIn.title = 'Zoom in (+)';
  const auto = button({
    label: 'Auto-focus',
    onClick: () => events.emit(CAMERA_EVENTS.toggleAuto),
  });
  auto.title = 'Follow the hero when it starts work, arrives somewhere, or needs you';
  bar.append(out, zoomIn, auto);
  document.body.appendChild(bar);

  events.on(CAMERA_EVENTS.changed, (state: CameraState) => {
    auto.setAttribute('aria-pressed', String(state.auto));
    out.disabled = state.aim.zoom <= 1;
  });
}
