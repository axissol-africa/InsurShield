import { describe, expect, it } from 'vitest';
import { QUALITY_LIMITS, assessPixels, withSubjectVerdict } from './photoQuality';

/**
 * The checks are graded against generated images whose properties are known:
 * a sharp scene, the same scene blurred, an underexposed one, and a blank
 * wall. Real photos vary, but a check that cannot separate these four would
 * not be worth running.
 */

const WIDTH = 160;
const HEIGHT = 120;

/** RGBA pixels from a function returning the grey level at each point. */
const imageFrom = (level) => {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const value = Math.max(0, Math.min(255, level(x, y)));
      const offset = (y * WIDTH + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { data, width: WIDTH, height: HEIGHT };
};

/** Hard-edged checks: plenty of detail at every scale, like a real subject. */
const sharpScene = (scale = 1) => imageFrom((x, y) => (((x >> 2) + (y >> 2)) % 2 ? 210 : 40) * scale);

/** The same scene with the edges smoothed away — what camera shake produces. */
const blurredScene = imageFrom((x, y) => 125 + 60 * Math.sin(x / 26) * Math.cos(y / 26));

const fullSize = { width: 1600, height: 1200 };

describe('photo quality checks', () => {
  it('accepts a sharp, well-exposed photo', () => {
    const result = assessPixels(sharpScene(), fullSize);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.metrics.sharpness).toBeGreaterThan(QUALITY_LIMITS.minSharpness);
  });

  it('rejects a blurred photo and says to hold steady', () => {
    const result = assessPixels(blurredScene, fullSize);
    expect(result.problems).toContain('BLURRY');
    expect(result.ok).toBe(false);
  });

  it('rejects a photo taken in the dark', () => {
    const result = assessPixels(imageFrom((x, y) => (((x >> 2) + (y >> 2)) % 2 ? 26 : 4)), fullSize);
    expect(result.problems).toContain('TOO_DARK');
  });

  it('rejects a washed-out photo', () => {
    const result = assessPixels(imageFrom((x, y) => (((x >> 2) + (y >> 2)) % 2 ? 252 : 243)), fullSize);
    expect(result.problems).toContain('TOO_BRIGHT');
  });

  it('rejects a frame with nothing in it, such as a wall or the sky', () => {
    const result = assessPixels(imageFrom(() => 150), fullSize);
    expect(result.problems).toContain('FEATURELESS');
    // "Nothing in frame" is the useful advice here, not "hold steady".
    expect(result.problems).not.toContain('BLURRY');
  });

  it('rejects an image too small to read, however sharp', () => {
    const result = assessPixels(sharpScene(), { width: 320, height: 240 });
    expect(result.problems).toContain('TOO_SMALL');
  });

  it('reports the measurements it judged on', () => {
    const { metrics } = assessPixels(sharpScene(), fullSize);
    expect(metrics).toEqual({
      sharpness: expect.any(Number),
      brightness: expect.any(Number),
      contrast: expect.any(Number),
      outdoorShare: expect.any(Number),
    });
  });
});

/**
 * The close-ups are the shots customers get wrong: a photo of the garden
 * instead of the odometer sends the whole request back from the insurer. A
 * leafy frame is textured and well exposed, so only its colour gives it away.
 */
const foliage = colourImage([60, 130, 45]);
const dashboard = { key: 'insp_dashboard', frame: 'close', mustShow: 'The odometer reading' };
const frontView = { key: 'insp_front', frame: 'wide' };

describe('the photographed subject', () => {
  it('refuses a close-up pointed at trees instead of the vehicle', () => {
    const result = assessPixels(foliage, fullSize, { closeUp: true });
    expect(result.problems).toContain('WRONG_SUBJECT');
    expect(result.ok).toBe(false);
  });

  it('refuses a close-up pointed at open sky', () => {
    const result = assessPixels(colourImage([70, 140, 225]), fullSize, { closeUp: true });
    expect(result.problems).toContain('WRONG_SUBJECT');
  });

  // A car parked on grass under a blue sky is a correct wide shot.
  it('allows greenery in the background of a wide shot', () => {
    const result = assessPixels(foliage, fullSize, { closeUp: false });
    expect(result.problems).not.toContain('WRONG_SUBJECT');
  });

  // Dashboards, VIN plates and stereos are grey, so the check must ignore them.
  it('accepts a neutral-coloured close-up of a vehicle part', () => {
    const result = assessPixels(sharpScene(), fullSize, { closeUp: true });
    expect(result.problems).toEqual([]);
    expect(result.metrics.outdoorShare).toBe(0);
  });

  it('adopts a server subject verdict and names the part to photograph', () => {
    const local = assessPixels(sharpScene(), fullSize, { closeUp: true });
    const merged = withSubjectVerdict(local, { showsRequestedPart: false }, dashboard);
    expect(merged.ok).toBe(false);
    expect(merged.problems).toEqual(['WRONG_SUBJECT']);
    expect(merged.messages[0]).toContain('the odometer reading');
  });

  it('leaves an accepted photo alone when the server agrees', () => {
    const local = assessPixels(sharpScene(), fullSize, { closeUp: true });
    expect(withSubjectVerdict(local, { showsRequestedPart: true }, frontView)).toBe(local);
  });
});

/** A textured image in one hue: the colour decides, the texture keeps it sharp. */
function colourImage([red, green, blue]) {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const shade = ((x >> 2) + (y >> 2)) % 2 ? 1.3 : 0.7;
      const offset = (y * WIDTH + x) * 4;
      data[offset] = red * shade;
      data[offset + 1] = green * shade;
      data[offset + 2] = blue * shade;
      data[offset + 3] = 255;
    }
  }
  return { data, width: WIDTH, height: HEIGHT };
}
