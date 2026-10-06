import { describe, expect, it } from 'vitest';
import { fitViewport } from './viewport';

const world = { width: 480, height: 270 };

describe('fitViewport', () => {
  it('picks the largest whole zoom at which the world fits, and fills the rest', () => {
    expect(fitViewport({ panel: { width: 1000, height: 620 }, world })).toEqual({
      zoom: 2,
      width: 500,
      height: 310,
    });
    expect(fitViewport({ panel: { width: 1500, height: 900 }, world })).toEqual({
      zoom: 3,
      width: 500,
      height: 300,
    });
  });

  it('just under a step keeps the lower zoom but still fills the panel', () => {
    expect(fitViewport({ panel: { width: 1439, height: 900 }, world })).toEqual({
      zoom: 2,
      width: 719,
      height: 450,
    });
  });

  it('never goes below zoom 1, even in a panel smaller than the world', () => {
    expect(fitViewport({ panel: { width: 300, height: 200 }, world })).toEqual({
      zoom: 1,
      width: 300,
      height: 200,
    });
    expect(fitViewport({ panel: { width: 0, height: 0 }, world })).toEqual({
      zoom: 1,
      width: 1,
      height: 1,
    });
  });
});
