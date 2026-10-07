import {
  type ArmoryLayer,
  type ArmoryView,
  type HeroClassView,
  type RecolorMap,
  resolveClasses,
  resolveRecolor,
} from '@ibitsa/protocol';
import type { ArmoryRequest, ArmoryLayerName as Layer } from './fake-armory.types';

/**
 * Dev only (#182): `ibitsa.classes` and `ibitsa.recolor` as VS Code would hold them, at your layer
 * and the project's, so the Armory can be played without the extension. The live dev host puts the
 * classes and recolors in its snapshots, as the runtime does.
 */
export class FakeArmory {
  private readonly classesAt: Record<Layer, Record<string, unknown>> = { user: {}, workspace: {} };
  private readonly recolorAt: Record<Layer, Record<string, unknown>> = { user: {}, workspace: {} };
  private readonly listeners: (() => void)[] = [];

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  apply(request: ArmoryRequest): void {
    switch (request.type) {
      case 'writeClass':
        this.classesAt[request.layer][request.id] = request.class;
        break;
      case 'resetClass':
        delete this.classesAt[request.layer][request.id];
        break;
      case 'writeRecolor':
        this.recolorAt[request.layer][request.target] = request.recolor;
        break;
      case 'resetRecolor':
        delete this.recolorAt[request.layer][request.target];
        break;
    }
    for (const l of this.listeners) l();
  }

  classes(): HeroClassView[] {
    return resolveClasses({ ...this.classesAt.user, ...this.classesAt.workspace });
  }

  recolor(): RecolorMap {
    return resolveRecolor({ ...this.recolorAt.user, ...this.recolorAt.workspace });
  }

  view(): ArmoryView {
    const layerOf = (at: Record<Layer, Record<string, unknown>>, key: string): ArmoryLayer =>
      key in at.workspace ? 'workspace' : key in at.user ? 'user' : 'default';
    return {
      classes: this.classes().map((c) => ({ ...c, layer: layerOf(this.classesAt, c.id) })),
      recolor: Object.entries(this.recolor()).map(([target, recolor]) => ({
        target,
        recolor,
        layer: layerOf(this.recolorAt, target),
      })),
    };
  }
}
