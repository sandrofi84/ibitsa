/** Where the camera should be: a whole-number zoom, and whether it follows the hero. */
export interface CameraAim {
  zoom: number;
  follow: boolean;
}

/** The camera as its controls and tests see it. */
export interface CameraState {
  /** The camera's zoom right now (between whole steps while it eases). */
  zoom: number;
  aim: CameraAim;
  auto: boolean;
  /** The part of the map in view. */
  view: { x: number; y: number; width: number; height: number };
}
