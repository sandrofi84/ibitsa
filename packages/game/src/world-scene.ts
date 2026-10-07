import type { Manifest } from '@ibitsa/assets';
import type { Cue, HeroView, Reading, Snapshot, TaskPointState } from '@ibitsa/protocol';
import * as Phaser from 'phaser';
import { CameraDirector, OVERVIEW_ZOOM } from './camera-director';
import type { CameraState } from './camera-director.types';
import type { GameClient } from './client';
import { CouncillorToken } from './councillor-token';
import { speechExcerpt } from './heroes';
import {
  BRIDGE,
  bridgeState,
  heroSpot,
  heroSpots,
  ibitsaSpot,
  layoutWorld,
  overviewCenter,
  pathTo,
  reviewerPath,
  reviewerSide,
} from './layout';
import type { BridgeLayout, Point, WorldLayout } from './layout.types';
import { marker } from './map-markers';
import { BRIDGE_KEY, PACK_KEY } from './pack-scene';
import { badgeOf } from './pull-requests';
import type { PullRequestBadge } from './pull-requests.types';
import { reviewersOf } from './reviewers';
import { councillorAppearance, councillorTitle } from './sitting-hut';
import type { ViewState } from './view-state';
import type { MapProbe } from './world-scene.types';

export const WIDTH = 480;
export const HEIGHT = 270;
const TRAVEL_MS = 3_000;
/** How long the camera takes to zoom or ease back to the whole map. */
const CAMERA_MS = 400;
/** One zoom step per wheel gesture: a trackpad sends many events for one swipe. */
const WHEEL_GAP_MS = 250;
/** How far the pointer moves before a press becomes a drag, in game pixels. */
const DRAG_START = 3;
const AUTO_KEY = 'cameraAuto';

/** Registry key: how many page pixels the hero pane covers on the right (0 collapsed or hidden). */
export const RIGHT_INSET = 'rightInset';

/** Game events between the camera and its on-screen controls (#59). */
export const CAMERA_EVENTS = {
  zoomIn: 'camera:zoomIn',
  zoomOut: 'camera:zoomOut',
  overview: 'camera:overview',
  toggleAuto: 'camera:toggleAuto',
  changed: 'camera:changed',
} as const;
const CATCH_UP_MS = 1_000;

const TASK_FRAME: Record<TaskPointState, number> = {
  locked: 0,
  active: 1,
  underReview: 3,
  done: 2,
  doneUnreviewed: 2,
};

const textStyle = (color = '#ffffff'): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: 'monospace',
  fontSize: '8px',
  color,
});

/** The world map (spec §7.2), drawn only from snapshots. */
export class WorldScene extends Phaser.Scene {
  private manifest!: Manifest;
  private layout: WorldLayout = layoutWorld(null);
  private water!: Phaser.GameObjects.TileSprite;
  /** Everything on the map, which the main camera zooms; the HUD is drawn by a fixed UI camera. */
  private world!: Phaser.GameObjects.Container;
  private ui!: Phaser.Cameras.Scene2D.Camera;
  private director!: CameraDirector;
  private view!: ViewState;
  private lastWheel = 0;
  private dragging = false;
  private questLayer!: Phaser.GameObjects.Container;
  private hud!: Phaser.GameObjects.Text;
  private empty!: Phaser.GameObjects.Text;
  private readonly heroes = new Map<string, HeroToken>();
  /** Councillors out reviewing (#140), by review; and the reviews whose councillor has gone home. */
  private readonly reviewers = new Map<string, CouncillorToken>();
  private readonly reviewed = new Set<string>();
  private islandKey = '';
  /** The hero the camera follows when chosen in the hero pane (#125); else the first one working. */
  private selected: string | null = null;
  private last: Snapshot | null = null;
  private boundsKey = '';
  private probe: MapProbe = {
    bounds: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    islands: [],
    bridges: [],
  };

  constructor() {
    super('world');
  }

  /** The first hero's token, for tests and probes. */
  firstHero(): HeroToken | null {
    return this.heroes.values().next().value ?? null;
  }

  /** The token the camera follows (#124): the selected hero, else the first working, else the first. */
  private focusToken(): HeroToken | null {
    const hero = this.last && CameraDirector.focusOf(this.last, this.selected);
    return (hero && this.heroes.get(hero.id)) ?? this.firstHero();
  }

  /** Follow this hero (#124); the hero pane's selection (#125) calls it. Null goes back to the default. */
  selectHero(id: string | null): void {
    this.selected = id;
    // Before the first snapshot the map isn't drawn yet; the selection waits for it.
    if (!this.last) return;
    if (this.director.observe(this.last, id)) this.aimCamera(this.director.current);
    else if (this.director.current.follow) this.aimCamera(this.director.current);
  }

  /** What the map shows (#124), for tests and probes: islands, bridges and blocked heroes. */
  mapProbe(): MapProbe {
    return {
      ...this.probe,
      following: (this.last && CameraDirector.focusOf(this.last, this.selected)?.id) ?? null,
      blocked: [...this.heroes].flatMap(([heroId, token]) => {
        const reason = token.blockedReason();
        return reason ? [{ heroId, reason }] : [];
      }),
      underReview: [...this.heroes].flatMap(([heroId, token]) =>
        token.underReview() ? [heroId] : [],
      ),
      reviewers: [...this.reviewers.values()].map((t) => t.probe()),
      shipped: this.last?.campaign?.shipped ?? false,
      atIbitsa: [...this.heroes].flatMap(([heroId, token]) => (token.atIbitsa() ? [heroId] : [])),
    };
  }

  /** Where a PR badge sits on the map, for clicks in tests (#153); null when the island has none. */
  pullRequestSpot(islandId: string): { x: number; y: number } | null {
    return this.prSpots.get(islandId) ?? null;
  }

  /** The camera as the controls and tests see it. */
  cameraState(): CameraState {
    const cam = this.cameras.main;
    const v = cam.worldView;
    return {
      zoom: cam.zoom,
      aim: this.director.current,
      auto: this.director.autoFocus,
      view: { x: v.x, y: v.y, width: v.width, height: v.height },
    };
  }

  /** Where each task point's middle is on the map (#141), for tests. */
  private readonly taskSpots = new Map<string, { x: number; y: number }>();
  private readonly prSpots = new Map<string, { x: number; y: number }>();

  /** Where a click reaches a task point on the map (below a hero on it), or null if it isn't drawn. */
  taskSpot(taskPointId: string): { x: number; y: number } | null {
    return this.taskSpots.get(taskPointId) ?? null;
  }

  /** A point on the map in canvas pixels, through the camera's scroll and zoom. */
  toCanvas(point: { x: number; y: number }): { x: number; y: number } {
    const cam = this.cameras.main;
    return {
      x: (point.x - cam.worldView.x) * cam.zoom,
      y: (point.y - cam.worldView.y) * cam.zoom,
    };
  }

  create(): void {
    this.manifest = this.cache.json.get(PACK_KEY) as Manifest;
    const waterIndex = this.manifest.tiles.tiles.water?.index ?? 0;
    this.world = this.add.container(0, 0);
    // The sea reaches past the map on every side, so a panel wider or taller than the world shows
    // more sea, never black (#59). A filled panel is under twice the world in each direction.
    this.water = this.add.tileSprite(0, 0, 1, 1, 'tiles', waterIndex).setOrigin(0);
    this.world.add(this.water);
    let waterFrame = 0;
    this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => {
        waterFrame = (waterFrame + 1) % (this.manifest.tiles.tiles.water?.frames ?? 1);
        this.water.setFrame(waterIndex + waterFrame);
      },
    });

    const v = this.layout.village;
    const village = this.add.container(0, 0);
    this.drawIsland(village, v);
    this.questLayer = this.add.container(0, 0);
    this.empty = this.add.text(330, 120, 'No quest yet', textStyle('#d8ecff')).setOrigin(0.5);
    this.world.add([
      village,
      this.add.image(v.hut.x, v.hut.y, 'building:hut').setOrigin(0),
      this.add.text(v.x + 22, v.y + 70, 'HOME VILLAGE', textStyle()),
      this.questLayer,
      this.empty,
    ]);
    this.hud = this.add.text(6, 4, '', textStyle());

    this.setUpCamera();

    const client = this.registry.get('client') as GameClient;
    client.onSnapshot((s) => this.render(s));
    client.onCue((c) => this.cue(c));
  }

  private setUpCamera(): void {
    this.view = this.registry.get('view') as ViewState;
    this.director = new CameraDirector({ auto: this.view.get(AUTO_KEY, true) });
    const cam = this.cameras.main;
    this.fitBounds();
    cam.centerOn(WIDTH / 2, HEIGHT / 2);
    this.ui = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, 'ui');
    this.ui.ignore(this.world);
    cam.ignore(this.hud);
    this.scale.on(Phaser.Scale.Events.RESIZE, (size: Phaser.Structs.Size) => {
      cam.setSize(size.width, size.height);
      this.ui.setSize(size.width, size.height);
      if (!this.director.current.follow && this.director.current.zoom === OVERVIEW_ZOOM) {
        const c = overviewCenter(this.layout);
        cam.centerOn(c.x, c.y);
      }
    });

    const events = this.game.events;
    events.on(CAMERA_EVENTS.zoomIn, () => this.aimCamera(this.director.zoomIn()));
    events.on(CAMERA_EVENTS.zoomOut, () => this.aimCamera(this.director.zoomOut()));
    events.on(CAMERA_EVENTS.overview, () => this.aimCamera(this.director.overview()));
    events.on(CAMERA_EVENTS.toggleAuto, () => {
      this.director.setAuto(!this.director.autoFocus);
      this.view.set(AUTO_KEY, this.director.autoFocus);
      this.announceCamera();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const name of Object.values(CAMERA_EVENTS)) events.off(name);
    });
    // The controls show the right state from the start, not only after the first move.
    this.announceCamera();

    this.input.on('wheel', (p: Phaser.Input.Pointer) => {
      const dy = p.deltaY;
      const now = this.time.now;
      if (dy === 0 || now - this.lastWheel < WHEEL_GAP_MS) return;
      this.lastWheel = now;
      this.aimCamera(dy > 0 ? this.director.zoomOut() : this.director.zoomIn());
    });
    this.input.on('pointerup', () => {
      this.dragging = false;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      if (!this.dragging && p.getDistance() < DRAG_START) return;
      if (!this.dragging) {
        this.dragging = true;
        cam.stopFollow();
        this.director.pan();
        this.announceCamera();
      }
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });
    // Phaser listens on the window; typing in the hero pane or a form must not zoom.
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === '+' || e.key === '=') this.aimCamera(this.director.zoomIn());
      else if (e.key === '-' || e.key === '_') this.aimCamera(this.director.zoomOut());
      else if (e.key === '0') this.aimCamera(this.director.overview());
    });
  }

  /**
   * While following, the hero sits in the middle of the map you can see: left of the open hero pane,
   * not under it. The offset is in map pixels, so it tracks the zoom as it eases.
   */
  override update(): void {
    const cam = this.cameras.main;
    // Page pixels the hero pane covers on the right, kept current by boot; a registry value rather
    // than an event, because the pane can appear before this scene starts.
    const inset = ((this.registry.get(RIGHT_INSET) as number | undefined) ?? 0) / this.scale.zoom;
    // Phaser centres on target − offset: a negative x puts the hero left of the middle.
    cam.setFollowOffset(-inset / 2 / cam.zoom, 0);
    // Bubbles and icons keep their whole-map size while the map zooms (#75).
    for (const token of this.heroes.values()) token.keepSize(cam.zoom);
  }

  /** Moves the main camera to the director's aim: zoom, follow the hero, or ease back to the map. */
  private aimCamera(aim: { zoom: number; follow: boolean }): void {
    const cam = this.cameras.main;
    cam.zoomTo(aim.zoom, CAMERA_MS, 'Sine.easeInOut', true);
    const hero = this.focusToken();
    if (aim.follow && hero) {
      cam.startFollow(hero.target(), true, 0.15, 0.15);
    } else {
      cam.stopFollow();
      if (aim.zoom === OVERVIEW_ZOOM) {
        const c = overviewCenter(this.layout);
        cam.pan(c.x, c.y, CAMERA_MS, 'Sine.easeInOut', true);
      }
    }
    this.announceCamera();
  }

  /**
   * The sea and the camera's reach follow the map (#124): past its edges by a whole world each side, so
   * a panel wider or taller than the world shows more sea, never black (#59).
   */
  private fitBounds(): void {
    const b = this.layout.bounds;
    const key = JSON.stringify(b);
    if (key === this.boundsKey) return;
    this.boundsKey = key;
    const area = {
      x: b.x - WIDTH,
      y: b.y - HEIGHT,
      width: b.width + WIDTH * 2,
      height: b.height + HEIGHT * 2,
    };
    this.water.setPosition(area.x, area.y).setSize(area.width, area.height);
    this.cameras.main.setBounds(area.x, area.y, area.width, area.height);
  }

  private announceCamera(): void {
    this.game.events.emit(CAMERA_EVENTS.changed, this.cameraState());
  }

  private drawIsland(
    into: Phaser.GameObjects.Container,
    { x, y, middles }: { x: number; y: number; middles: number },
  ): void {
    const i = this.manifest.island;
    into.add(this.add.image(x, y, 'island', 'left').setOrigin(0));
    for (let m = 0; m < middles; m++) {
      into.add(this.add.image(x + i.leftCap + m * i.middle, y, 'island', 'middle').setOrigin(0));
    }
    into.add(this.add.image(x + i.leftCap + middles * i.middle, y, 'island', 'right').setOrigin(0));
  }

  private dots(into: Phaser.GameObjects.Container, points: Point[]): void {
    const g = this.add.graphics();
    for (let k = 0; k < points.length - 1; k++) {
      const a = points[k] as Point;
      const b = points[k + 1] as Point;
      const steps = Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / 5);
      for (let s = 1; s < steps; s++) {
        const x = Math.round(a.x + ((b.x - a.x) * s) / steps);
        const y = Math.round(a.y + ((b.y - a.y) * s) / steps);
        g.fillStyle(0x1f4a7c).fillRect(x, y + 1, 2, 2);
        g.fillStyle(0xf3ead2).fillRect(x, y, 2, 2);
      }
    }
    into.add(g);
  }

  render(snapshot: Snapshot): void {
    this.last = snapshot;
    this.layout = layoutWorld(snapshot);
    this.fitBounds();
    this.empty.setVisible(snapshot.campaign === null);
    this.hud.setText(
      snapshot.campaign
        ? `${snapshot.campaign.title.toUpperCase()}   GOLD ${gold(snapshot.campaign.gold)}${snapshot.campaign.capMicroUsd === null ? '' : ` / ${gold({ kind: 'exact', value: snapshot.campaign.capMicroUsd })}`}${snapshot.campaign.autoApprove ? '   AUTO' : ''}`
        : '',
    );

    // Islands, paths and bridges are cheap to rebuild; heroes persist so their movement continues.
    const key = JSON.stringify([
      snapshot.islands,
      snapshot.campaign?.branching,
      snapshot.campaign?.stackedStart,
    ]);
    if (key !== this.islandKey) {
      this.islandKey = key;
      this.drawIslands(snapshot);
    }

    const spots = heroSpots(this.layout, snapshot);
    const seen = new Set<string>();
    // Every PR merged (#153): the heroes walk to Ibitsa on the horizon and stay there.
    const shipped = snapshot.campaign?.shipped === true;
    snapshot.heroes.forEach((hero, n) => {
      if (shipped) spots.set(hero.id, ibitsaSpot(this.layout, n));
    });
    for (const hero of snapshot.heroes) {
      seen.add(hero.id);
      const spot = spots.get(hero.id) ?? heroSpot(this.layout, hero.taskPointId);
      let token = this.heroes.get(hero.id);
      if (!token) {
        token = new HeroToken({
          scene: this,
          layer: this.world,
          hero,
          iconKinds: this.manifest.activityIcons.kinds,
          character: this.characterKey(hero.classId),
          start:
            hero.state.kind === 'traveling'
              ? (pathTo(this.layout, hero.taskPointId)[0] ?? spot)
              : spot,
        });
        this.heroes.set(hero.id, token);
      }
      token.update({
        hero,
        layout: this.layout,
        questActive: snapshot.campaign?.status === 'active' && !shipped,
        spot,
      });
      // After the update, so "Ready for review!" has gone and the cheer shows.
      if (shipped) token.journey(spot);
    }
    for (const [id, token] of this.heroes) {
      if (!seen.has(id)) {
        token.destroy();
        this.heroes.delete(id);
      }
    }
    this.renderReviewers(snapshot);
    if (this.director.observe(snapshot, this.selected)) this.aimCamera(this.director.current);
  }

  /**
   * The councillors reviewing each task (#140): one walks out from the hut for each review of the round,
   * and walks back once the phase is over, or once its review is gone. A review whose councillor has
   * gone home, or was already over when the map first saw it, doesn't bring it out again.
   */
  private renderReviewers(snapshot: Snapshot): void {
    if (!snapshot.campaign) {
      for (const token of this.reviewers.values()) token.destroy();
      this.reviewers.clear();
      return;
    }
    const listed = new Set<string>();
    for (const view of reviewersOf(snapshot)) {
      listed.add(view.key);
      if (this.reviewed.has(view.key)) continue;
      let token = this.reviewers.get(view.key);
      if (!token) {
        if (view.leaving) {
          this.reviewed.add(view.key);
          continue;
        }
        token = new CouncillorToken({
          scene: this,
          layer: this.world,
          view,
          character: this.councillorKey(view.councillorId),
          title: councillorTitle(view.councillorId),
          side: reviewerSide(view.index),
          path: reviewerPath(this.layout, view),
          still: reducedMotion(),
          gone: () => {
            this.reviewers.delete(view.key);
            this.reviewed.add(view.key);
          },
        });
        this.reviewers.set(view.key, token);
      }
      token.update(view);
    }
    for (const [key, token] of this.reviewers) if (!listed.has(key)) token.leave();
  }

  /**
   * Every island with its task points (#124): dimmed while it waits to start; a dotted path from the
   * village to each separate island, or to the first stacked one, and drawbridges between stacked ones.
   */
  private drawIslands(snapshot: Snapshot): void {
    this.questLayer.removeAll(true);
    const stacked = snapshot.campaign?.branching === 'stacked';
    const islands: MapProbe['islands'] = [];
    this.prSpots.clear();
    if (snapshot.campaign) this.drawIbitsa(snapshot.campaign.shipped);
    snapshot.islands.forEach((island, k) => {
      const l = this.layout.islands[k];
      if (!l) return;
      const dim = island.worktree === 'waiting';
      const badge = badgeOf(island);
      islands.push({ id: island.id, x: l.x, y: l.y, row: l.row, dim, pr: badge?.state ?? null });
      const first = island.taskPoints[0];
      if (first && (!stacked || k === 0)) this.dots(this.questLayer, pathTo(this.layout, first.id));
      const c = this.add.container(0, 0);
      this.drawIsland(c, l);
      c.add(this.add.text(l.x + 8, l.y + 70, island.name.toUpperCase().slice(0, 28), textStyle()));
      island.taskPoints.forEach((tp, i) => {
        const p = l.taskPoints[i];
        if (!p) return;
        const next = l.taskPoints[i + 1];
        if (next)
          this.dots(c, [
            { x: p.x + 16, y: p.y + 8 },
            { x: next.x, y: next.y + 8 },
          ]);
        // Clicking a task point opens its checks and reviews in the task panel (#141). A hero standing
        // on it covers most of it, so it also answers a little below, under the hero's feet; a click on
        // the hero itself still selects the hero (Phaser can't order the two, as they're in different layers).
        c.add(
          this.add
            .sprite(p.x, p.y, 'taskPoints', TASK_FRAME[tp.state])
            .setOrigin(0)
            .setInteractive({
              hitArea: new Phaser.Geom.Rectangle(0, 0, 16, 16 + TASK_HIT_BELOW),
              hitAreaCallback: Phaser.Geom.Rectangle.Contains,
              useHandCursor: true,
            })
            .on('pointerdown', (pointer: Phaser.Input.Pointer) => {
              if (!onCanvas(pointer)) return;
              const at = { x: pointer.worldX, y: pointer.worldY };
              const hero = [...this.heroes].find(([, token]) => token.covers(at));
              if (hero) this.game.events.emit(HERO_SELECTED, hero[0]);
              else this.game.events.emit(TASK_SELECTED, tp.id);
            }),
        );
        this.taskSpots.set(tp.id, { x: p.x + 8, y: p.y + 16 + TASK_HIT_BELOW / 2 });
        if (tp.state === 'doneUnreviewed') {
          // done, but no councillor has reviewed it yet (M1): a small marker, not colour alone
          c.add(this.add.rectangle(p.x + 12, p.y + 1, 3, 3, 0xffffff).setOrigin(0));
        }
      });
      // An island still waiting for a slot, a dependency or the island before it looks idle.
      c.setAlpha(dim ? 0.55 : 1);
      this.questLayer.add(c);
      if (badge)
        this.drawBadge({ islandId: island.id, badge, at: { x: l.x + l.width - 12, y: l.y + 4 } });
    });
    const bridges = this.layout.bridges.map((b) => {
      const state = bridgeState({ snapshot, to: b.to });
      this.drawBridge({ bridge: b, ...state });
      return { from: b.from, to: b.to, vertical: b.vertical, ...state };
    });
    this.probe = { bounds: this.layout.bounds, islands, bridges };
  }

  /**
   * An island's PR badge (§5.6, #153), floating at its top right: its state as a word on its colour.
   * Hovering shows a summary; a click opens the PR card.
   */
  private drawBadge({
    islandId,
    badge,
    at,
  }: {
    islandId: string;
    badge: PullRequestBadge;
    at: Point;
  }): void {
    const r = (badge.color >> 16) & 0xff;
    const g = (badge.color >> 8) & 0xff;
    const b = badge.color & 0xff;
    const light = 0.299 * r + 0.587 * g + 0.114 * b > 140;
    const text = this.add
      .text(at.x, at.y, ` ${badge.label} `, {
        ...textStyle(light ? '#1a1420' : '#ffffff'),
        backgroundColor: `#${badge.color.toString(16).padStart(6, '0')}`,
      })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (onCanvas(pointer)) this.game.events.emit(PULL_REQUEST_SELECTED, islandId);
      })
      .on('pointerover', () => {
        const below = this.toCanvas({ x: at.x - text.width, y: at.y + text.height + 2 });
        this.game.events.emit(PULL_REQUEST_HOVERED, { islandId, ...below });
      })
      .on('pointerout', () => this.game.events.emit(PULL_REQUEST_HOVERED, null));
    this.questLayer.add(text);
    this.prSpots.set(islandId, { x: at.x - text.width / 2, y: at.y + text.height / 2 });
  }

  /**
   * Ibitsa on the horizon (§7.2): a far-off castle, out of reach until the campaign is shipped; then its
   * banner turns gold (#153). Drawn by the game; packs have no art for it yet.
   */
  private drawIbitsa(shipped: boolean): void {
    const { x, y } = this.layout.ibitsa;
    const g = this.add.graphics({ x: x - 16, y: y - 6 });
    const stone = shipped ? 0xe8dcc0 : 0x9aa6b8;
    g.fillStyle(stone, shipped ? 1 : 0.7);
    g.fillRect(0, 8, 32, 16).fillRect(2, 2, 6, 22).fillRect(24, 2, 6, 22).fillRect(12, 0, 8, 24);
    g.fillStyle(0x1a1420, 0.6).fillRect(14, 16, 4, 8);
    g.lineStyle(1, 0x5e3b1c).lineBetween(16, 0, 16, -6);
    g.fillStyle(shipped ? 0xf2c230 : 0x6a6a6a).fillTriangle(16, -6, 22, -4, 16, -2);
    this.questLayer.add(g);
    this.questLayer.add(
      this.add
        .text(x, y - 14, 'IBITSA', textStyle(shipped ? '#f2c230' : '#c8d0dc'))
        .setOrigin(0.5, 1),
    );
  }

  /** A drawbridge (§9.2): the pack's pieces, or plain planks; a padlock while raised, a mark when behind. */
  private drawBridge({
    bridge: b,
    lowered,
    behind,
  }: {
    bridge: BridgeLayout;
    lowered: boolean;
    behind: boolean;
  }): void {
    const frame = lowered ? 'lowered' : 'raised';
    // Drawn left to right; a bridge between rows is the same turned a quarter clockwise.
    const c = this.add.container(b.vertical ? b.x + BRIDGE.height : b.x, b.y);
    if (b.vertical) c.setAngle(90);
    if (this.textures.exists(BRIDGE_KEY)) {
      c.add(this.add.image(0, 0, BRIDGE_KEY, `${frame}:left`).setOrigin(0));
      for (let x = BRIDGE.end; x < b.length - BRIDGE.end; x += BRIDGE.segment)
        c.add(this.add.image(x, 0, BRIDGE_KEY, `${frame}:segment`).setOrigin(0));
      c.add(this.add.image(b.length - BRIDGE.end, 0, BRIDGE_KEY, `${frame}:right`).setOrigin(0));
    } else {
      const g = this.add.graphics();
      g.fillStyle(0x5e3b1c)
        .fillRect(2, 2, 4, 20)
        .fillRect(b.length - 6, 2, 4, 20);
      if (lowered) g.fillStyle(0xb07a3e).fillRect(0, 9, b.length, 7);
      c.add(g);
    }
    this.questLayer.add(c);
    const mid = b.vertical
      ? { x: b.x + BRIDGE.height / 2, y: b.y + b.length / 2 }
      : { x: b.x + b.length / 2, y: b.y + BRIDGE.height / 2 };
    if (!lowered) this.questLayer.add(marker({ scene: this, kind: 'padlock', at: mid }));
    if (behind)
      this.questLayer.add(marker({ scene: this, kind: 'behind', at: { x: mid.x, y: mid.y - 14 } }));
  }

  private characterKey(classId: string): string {
    const key = `hero.${classId}`;
    return this.manifest.characters[key] ? key : 'hero.ranger';
  }

  private councillorKey(councillorId: string): string {
    const key = councillorAppearance(councillorId);
    return this.manifest.characters[key] ? key : 'councillor.default';
  }

  private cue(cue: Cue): void {
    if (cue.type === 'activityFinished') this.heroes.get(cue.heroId)?.flash(cue);
    if (cue.type === 'retrying') this.heroes.get(cue.heroId)?.flash({ outcome: 'failed' });
    if (cue.type === 'heroSaid') this.heroes.get(cue.heroId)?.say(cue.text);
  }
}

function gold(reading: Reading<number>): string {
  if (reading.kind === 'unknown') return '?';
  const g = Math.round(reading.value / 10_000); // 1 gold = 1 cent
  return reading.kind === 'estimated' ? `~${g}` : String(g);
}

/** The viewer asked for less motion: councillors appear in place rather than walk (#140). */
function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** What a blocked hero waits for, in a few words (#121, #124). */
const BLOCKED_LABEL: Record<'slot' | 'previousIsland' | 'dependency', string> = {
  slot: 'Waiting for a free slot',
  previousIsland: 'Waiting for the island before',
  dependency: 'Waiting on a task elsewhere',
};

/** How long the flask stays, green or red, after a test run. */
const TEST_LINGER_MS = 900;

/** How long a message's speech bubble stays before it fades. */
const SPEECH_MS = 4000;

/** Emitted on `game.events` with the hero's id when the hero is clicked on the map (#61). */
export const HERO_SELECTED = 'heroSelected';

/** Emitted on `game.events` with the task point's id when it is clicked on the map (#141). */
export const TASK_SELECTED = 'taskSelected';
/** Emitted on `game.events` with the island's id when its PR badge is clicked (#153). */
export const PULL_REQUEST_SELECTED = 'pullRequestSelected';

/**
 * Phaser hears presses anywhere in the window, so a click on a panel lying over the map (a card's
 * button, a "Needs you" item) would also reach the token beneath it. Only the canvas's own count.
 */
function onCanvas(pointer: Phaser.Input.Pointer): boolean {
  return pointer.downElement === pointer.manager.game.canvas;
}
/** Emitted on `game.events` with `{ islandId, x, y }` (canvas pixels) over a PR badge, null off it. */
export const PULL_REQUEST_HOVERED = 'pullRequestHovered';
/** How far below a task point a click still reaches it, clear of a hero standing on it. */
const TASK_HIT_BELOW = 6;

/** A hero on the map: round token base, sprite, HP bar and status bubble (spec §7.2). */
export class HeroToken {
  private readonly container: Phaser.GameObjects.Container;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly hpBar: Phaser.GameObjects.Graphics;
  private readonly bubble: Phaser.GameObjects.Text;
  /** Speech: a message excerpt that fades, or "Ready for review!" while submitted (#57). */
  private readonly speech: Phaser.GameObjects.Container;
  private readonly speechBox: Phaser.GameObjects.Graphics;
  private readonly speechText: Phaser.GameObjects.Text;
  private speechKind: 'none' | 'message' | 'submitted' = 'none';
  /** What the hero is doing, as an icon beside its head (#60); lingers briefly after a test. */
  private readonly icon: Phaser.GameObjects.Sprite;
  private readonly iconKinds: readonly string[];
  private iconLinger: Phaser.Time.TimerEvent | null = null;
  /** The camera zoom the bubbles and icon are sized for. */
  private zoom = 1;
  private speechFade: Phaser.Tweens.Tween | null = null;
  private travel: Phaser.Tweens.Tween | null = null;
  private traveled = false;
  /** Walking to (or standing at) Ibitsa once the campaign is shipped (#153). */
  private journeyed = false;
  private state: HeroView['state']['kind'] = 'traveling';
  private readonly padlock: Phaser.GameObjects.Sprite;
  private readonly hourglass: Phaser.GameObjects.Sprite | Phaser.GameObjects.Graphics;
  private readonly blockedLabel: Phaser.GameObjects.Text;
  private blocked: 'slot' | 'previousIsland' | 'dependency' | null = null;

  private readonly scene: Phaser.Scene;
  private readonly layer: Phaser.GameObjects.Container;
  private readonly character: string;

  constructor({
    scene,
    layer,
    hero,
    iconKinds,
    character,
    start,
  }: {
    scene: Phaser.Scene;
    /** The map layer the token lives in, so the camera zooms it. */
    layer: Phaser.GameObjects.Container;
    hero: HeroView;
    iconKinds: readonly string[];
    character: string;
    /** Where it appears: the start of its walk, its task point, or its place in the village line. */
    start: Point;
  }) {
    this.scene = scene;
    this.layer = layer;
    this.iconKinds = iconKinds;
    this.character = character;
    const base = scene.add.graphics();
    base.fillStyle(0x000000, 0.35).fillEllipse(0, 0, 12, 4);
    base.lineStyle(1, 0xf3ead2).strokeEllipse(0, 0, 12, 4);
    this.sprite = scene.add.sprite(0, 1, character).setOrigin(0.5, 1);
    this.sprite
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (onCanvas(pointer)) scene.game.events.emit(HERO_SELECTED, hero.id);
      });
    this.hpBar = scene.add.graphics();
    this.bubble = scene.add
      .text(0, -26, '', { ...textStyle('#1a1420'), backgroundColor: '#f2c230' })
      .setOrigin(0.5);
    this.speechBox = scene.add.graphics();
    this.speechText = scene.add.text(0, -3, '', textStyle('#1a1420')).setOrigin(0.5, 1);
    this.speechText
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (onCanvas(pointer)) scene.game.events.emit(HERO_SELECTED, hero.id);
      });
    this.speech = scene.add.container(0, -24, [this.speechBox, this.speechText]).setVisible(false);
    this.icon = scene.add.sprite(13, -9, 'activityIcons', 0).setVisible(false);
    // Blocked (#124): a padlock over the head, and what it waits for when you point at it.
    this.padlock = marker({
      scene,
      kind: 'padlock',
      at: { x: 0, y: -26 },
    }) as Phaser.GameObjects.Sprite;
    this.padlock.setVisible(false);
    // Under review (#140): it waits idle on its task point under an hourglass.
    this.hourglass = marker({ scene, kind: 'hourglass', at: { x: 0, y: -26 } });
    this.hourglass.setVisible(false);
    this.blockedLabel = scene.add
      .text(0, -36, '', { ...textStyle('#1a1420'), backgroundColor: '#f3ead2' })
      .setOrigin(0.5)
      .setVisible(false);
    this.sprite
      .on('pointerover', () => this.blockedLabel.setVisible(this.blocked !== null))
      .on('pointerout', () => this.blockedLabel.setVisible(false));
    this.container = scene.add.container(start.x, start.y, [
      base,
      this.sprite,
      this.hpBar,
      this.icon,
      this.bubble,
      this.speech,
      this.padlock,
      this.hourglass,
      this.blockedLabel,
    ]);
    layer.add(this.container);
  }

  /** Whether it waits under the hourglass while councillors review its task (#140). */
  underReview(): boolean {
    return this.hourglass.visible;
  }

  /** What the hero waits for while blocked, else null (#124). */
  blockedReason(): 'slot' | 'previousIsland' | 'dependency' | null {
    return this.blocked;
  }

  /** What the camera follows. */
  target(): Phaser.GameObjects.Container {
    return this.container;
  }

  /** Whether a point on the map falls on the hero's sprite. */
  covers(point: { x: number; y: number }): boolean {
    return this.sprite.getBounds().contains(point.x, point.y);
  }

  /** The campaign is shipped (#153): walk to Ibitsa once and cheer; it stays there after. */
  journey(to: Point): void {
    if (this.journeyed) return;
    this.journeyed = true;
    this.travel?.stop();
    this.travel = null;
    this.walk([{ x: this.container.x, y: this.container.y }, to]);
    this.say('Ibitsa!');
  }

  /** At (or on the way to) Ibitsa. */
  atIbitsa(): boolean {
    return this.journeyed;
  }

  /** The middle of the sprite, on the map. */
  position(): { x: number; y: number } {
    return { x: this.container.x, y: this.container.y - this.sprite.height / 2 };
  }

  /** A message from the hero: its excerpt shows for a few seconds, unless "Ready for review!" is up. */
  say(text: string): void {
    if (this.speechKind === 'submitted') return;
    this.showSpeech({ text: speechExcerpt(text), kind: 'message' });
    this.speechFade = this.scene.tweens.add({
      targets: this.speech,
      alpha: 0,
      delay: SPEECH_MS,
      duration: 500,
      onComplete: () => this.hideSpeech(),
    });
  }

  /**
   * Keeps the speech bubble, status bubble and activity icon at their whole-map size whatever the camera
   * zoom (#75). They stay anchored to the hero in map coordinates; only their size counters the zoom.
   */
  keepSize(zoom: number): void {
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    const size = 1 / zoom;
    this.speech.setScale(size);
    this.bubble.setScale(size);
    this.icon.setScale(size);
  }

  /** The speech bubble's width on the canvas while it shows, given the camera's real zoom (tests). */
  speechWidth(cameraZoom: number): number | null {
    return this.speech.visible ? this.speechText.width * this.speech.scaleX * cameraZoom : null;
  }

  /** The activity icon showing, else null. */
  showingIcon(): string | null {
    return this.icon.visible ? (this.iconKinds[Number(this.icon.frame.name)] ?? null) : null;
  }

  private showIcon(kind: string): boolean {
    const frame = this.iconKinds.indexOf(kind);
    if (frame < 0) return false;
    this.icon.setFrame(frame).setVisible(true);
    return true;
  }

  /** The speech bubble's text while it shows, else null. */
  speaking(): string | null {
    return this.speech.visible ? this.speechText.text : null;
  }

  private showSpeech({ text, kind }: { text: string; kind: 'message' | 'submitted' }): void {
    this.speechFade?.stop();
    this.speechFade = null;
    this.speechKind = kind;
    this.speechText.setText(text);
    const w = Math.ceil(this.speechText.width) + 8;
    const h = Math.ceil(this.speechText.height) + 4;
    const fill = kind === 'submitted' ? 0xd9f2c4 : 0xfff6dc;
    this.speechBox
      .clear()
      .fillStyle(fill)
      .fillRoundedRect(-w / 2, -h - 1, w, h, 3)
      .lineStyle(1, 0x5e3b1c)
      .strokeRoundedRect(-w / 2, -h - 1, w, h, 3)
      .fillStyle(fill)
      .fillTriangle(-3, -2, 3, -2, 0, 3)
      .lineStyle(1, 0x5e3b1c)
      .lineBetween(-3, -1, 0, 3)
      .lineBetween(3, -1, 0, 3);
    this.speech.setAlpha(1).setVisible(true);
  }

  private hideSpeech(): void {
    this.speechFade?.stop();
    this.speechFade = null;
    this.speechKind = 'none';
    this.speech.setVisible(false);
  }

  update({
    hero,
    layout,
    questActive,
    spot,
  }: {
    hero: HeroView;
    layout: WorldLayout;
    questActive: boolean;
    /** Where it stands when not walking: its task point, or its place in the village line (#124). */
    spot: Point;
  }): void {
    const previous = this.state;
    this.state = hero.state.kind;
    const s = hero.state;

    if (s.kind === 'traveling' && !this.traveled && !this.travel)
      this.walk(pathTo(layout, hero.taskPointId));
    if (s.kind !== 'traveling') {
      if (this.travel && !this.journeyed) {
        // Arrived for real: finish the walk within a second instead of showing work mid-path.
        const remaining = (1 - this.travel.progress) * TRAVEL_MS;
        this.travel.timeScale = Math.max(1, remaining / CATCH_UP_MS);
      } else if (!this.travel) {
        this.container.setPosition(spot.x, spot.y);
      }
    }
    this.blocked = s.kind === 'blocked' ? s.reason : null;
    this.padlock.setVisible(this.blocked !== null);
    if (this.blocked) this.blockedLabel.setText(` ${BLOCKED_LABEL[this.blocked]} `);
    else this.blockedLabel.setVisible(false);
    this.hourglass.setVisible(s.kind === 'underReview');

    const working = s.kind === 'working' && hero.activity && hero.activity.kind !== 'think';
    const animation = s.kind === 'traveling' || this.travel ? 'walk' : working ? 'work' : 'idle';
    this.play(animation);

    this.sprite.clearTint();
    if (s.kind === 'unknown') {
      this.sprite.setTint(0x888888);
      this.sprite.anims.pause();
    } else if (s.kind === 'error') {
      this.sprite.setTint(0xff8888);
    }

    const bubbles: Partial<Record<HeroView['state']['kind'], [string, string]>> = {
      waitingOnYou: ['?', '#f2c230'],
      unknown: ['?', '#9a9a9a'],
      error: ['!', '#e8483a'],
      stalled: ['!', '#f2c230'],
      outOfGold: ['$', '#cdb56a'],
      resting: ['z', '#d8ecff'],
    };
    const bubble = bubbles[s.kind];
    this.bubble.setVisible(Boolean(bubble));
    if (bubble) {
      this.bubble.setText(` ${bubble[0]} `).setBackgroundColor(bubble[1]);
      if (previous !== s.kind) {
        const size = 1 / this.zoom;
        this.scene.tweens.add({
          targets: this.bubble,
          scale: { from: 1.6 * size, to: size },
          duration: 200,
        });
      }
    }

    if (!this.iconLinger) {
      const activity = s.kind === 'working' ? hero.activity : null;
      if (!activity || !this.showIcon(activity.kind)) this.icon.setVisible(false);
    }

    // "Ready for review!" stays until the quest is finished or the hero gets back to work.
    const readyForReview = s.kind === 'submitted' && questActive;
    if (readyForReview && this.speechKind !== 'submitted') {
      this.showSpeech({ text: 'Ready for review!', kind: 'submitted' });
    } else if (!readyForReview && this.speechKind === 'submitted') {
      this.hideSpeech();
    }
    // Above the status bubble when one shows, so neither covers the other or the HP bar.
    this.speech.setY(this.bubble.visible ? -32 : -22);

    this.drawHp(hero.hp);
  }

  private play(animation: 'walk' | 'work' | 'idle'): void {
    const key = `${this.character}:${animation}`;
    if (this.sprite.anims.currentAnim?.key !== key) this.sprite.play(key);
    else if (this.sprite.anims.isPaused) this.sprite.anims.resume();
  }

  private walk(path: Point[]): void {
    const lengths = path
      .slice(1)
      .map((p, i) => Math.hypot(p.x - (path[i] as Point).x, p.y - (path[i] as Point).y));
    const total = lengths.reduce((a, b) => a + b, 0) || 1;
    this.travel = this.scene.tweens.addCounter({
      from: 0,
      to: total,
      duration: TRAVEL_MS,
      onUpdate: (tween) => {
        let d = tween.getValue() ?? 0;
        for (let k = 0; k < lengths.length; k++) {
          const len = lengths[k] as number;
          const a = path[k] as Point;
          const b = path[k + 1] as Point;
          if (d <= len || k === lengths.length - 1) {
            const f = len === 0 ? 1 : Math.min(1, d / len);
            this.container.setPosition(
              Math.round(a.x + (b.x - a.x) * f),
              Math.round(a.y + (b.y - a.y) * f),
            );
            this.sprite.setFlipX(b.x < a.x);
            return;
          }
          d -= len;
        }
      },
      onComplete: () => {
        this.travel = null;
        this.traveled = true;
        this.sprite.setFlipX(false);
        if (this.state !== 'traveling') this.play('idle');
      },
    });
  }

  private drawHp(hp: HeroView['hp']): void {
    const g = this.hpBar.clear();
    const w = 12;
    const x = -w / 2;
    const y = -19;
    g.fillStyle(0x1a1420).fillRect(x - 1, y - 1, w + 2, 4);
    if (hp.kind === 'unknown') {
      g.fillStyle(0x6a6a6a).fillRect(x, y, w, 2);
      return;
    }
    const left = Math.max(0, 1 - hp.value.used / hp.value.max);
    const color = left > 0.5 ? 0x4fd16a : left > 0.25 ? 0xf2c230 : 0xe8483a;
    g.fillStyle(0x3a2a2a).fillRect(x, y, w, 2);
    g.fillStyle(color, hp.kind === 'estimated' ? 0.6 : 1).fillRect(x, y, Math.round(w * left), 2);
  }

  flash({ outcome, kind }: { outcome: 'ok' | 'failed'; kind?: string }): void {
    if (kind === 'test' && this.showIcon('test')) {
      // The flask turns green or red and stays a moment, so a quick test run is still seen.
      this.icon.setTint(outcome === 'ok' ? 0x7fdc7f : 0xff6a5a);
      this.iconLinger?.remove();
      this.iconLinger = this.scene.time.delayedCall(TEST_LINGER_MS, () => {
        this.iconLinger = null;
        this.icon.clearTint().setVisible(false);
      });
    }
    if (outcome === 'failed') {
      this.scene.tweens.add({
        targets: this.sprite,
        alpha: { from: 0.3, to: 1 },
        duration: 120,
        repeat: 2,
        onStart: () => this.sprite.setTint(0xff5040),
        onComplete: () => this.sprite.clearTint(),
      });
      return;
    }
    const spark = this.scene.add.rectangle(
      this.container.x + 6,
      this.container.y - 14,
      2,
      2,
      0xf2c230,
    );
    this.layer.add(spark);
    this.scene.tweens.add({
      targets: spark,
      y: spark.y - 8,
      alpha: 0,
      duration: 500,
      onComplete: () => spark.destroy(),
    });
  }

  destroy(): void {
    this.travel?.stop();
    this.container.destroy();
  }
}
