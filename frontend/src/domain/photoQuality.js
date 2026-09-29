/**
 * Automatic checks on an inspection photo.
 *
 * The point is to catch a bad photo while the customer is still standing at
 * the vehicle, rather than days later when an insurer rejects the request.
 * Everything here is measured from the pixels, so it is the same judgement
 * every time and needs no network.
 *
 * What it can prove: the photo is sharp enough to read, correctly exposed,
 * big enough, shows something, and — for the close-ups — is not simply
 * pointed at foliage or the sky instead of the vehicle. What it cannot prove
 * is the subject itself: that a dashboard photo shows an odometer and not a
 * kitchen wall. That needs a vision model, and `withSubjectVerdict` below is
 * where a server-side answer joins this one.
 */

/** Width the image is sampled at before analysis: enough detail, little work. */
const SAMPLE_WIDTH = 320;

export const QUALITY_LIMITS = {
  /** Shorter edge, in real pixels, before detail is lost for an assessor. */
  minEdge: 640,
  /** Laplacian variance. Sharp phone photos sit in the hundreds; blur collapses it. */
  minSharpness: 45,
  /** Mean luminance, 0–255. */
  minBrightness: 38,
  maxBrightness: 238,
  /** Luminance spread. A wall, the sky or a lens cap has almost none. */
  minContrast: 14,
  /**
   * How much of a close-up may be foliage or open sky before it is treated as
   * pointed at the wrong thing. Set high on purpose: a dashboard, a VIN plate
   * or a stereo is metal, plastic and glass, so a frame this green or this
   * blue is a photo of the garden. Wide shots are exempt — grass and sky
   * belong in the background of a car parked outdoors.
   */
  maxOutdoorShareOfCloseUp: 0.6,
};

/** Every problem the checks can report, with what the customer should do about it. */
export const PHOTO_PROBLEMS = {
  TOO_SMALL: 'This photo is too small to read. Take it again with your phone camera rather than a screenshot.',
  TOO_DARK: 'Too dark to make out. Move into better light, or switch the flash on.',
  TOO_BRIGHT: 'Too bright — the detail is washed out. Move out of direct sun or change angle.',
  BLURRY: 'This came out blurry. Hold the phone steady, tap the screen to focus, then take it again.',
  FEATURELESS: 'Nothing is in frame. Point the camera at the vehicle and fill the frame with it.',
  WRONG_SUBJECT: 'This looks like trees or sky rather than the vehicle.',
};

/**
 * Grade the pixels of an image.
 *
 * @param {{ data: Uint8ClampedArray|number[], width: number, height: number }} sample
 *   RGBA pixels, as `CanvasRenderingContext2D.getImageData` returns them.
 * @param {{ width: number, height: number }} original  size of the photo itself
 * @param {{ closeUp?: boolean }} [expected]  what the shot is meant to be
 * @returns {{ ok: boolean, problems: string[], metrics: { sharpness: number, brightness: number, contrast: number, outdoorShare: number } }}
 */
export function assessPixels(sample, original = { width: 0, height: 0 }, expected = {}) {
  const grey = toGreyscale(sample);
  const brightness = mean(grey);
  const contrast = standardDeviation(grey, brightness);
  const sharpness = laplacianVariance(grey, sample.width, sample.height);
  const outdoorShare = outdoorFraction(sample);

  const problems = [];
  const shortEdge = Math.min(original.width || sample.width, original.height || sample.height);
  if (shortEdge < QUALITY_LIMITS.minEdge) problems.push('TOO_SMALL');
  if (brightness < QUALITY_LIMITS.minBrightness) problems.push('TOO_DARK');
  else if (brightness > QUALITY_LIMITS.maxBrightness) problems.push('TOO_BRIGHT');
  // A featureless frame reads as blurry too; report the one the customer can act on.
  if (contrast < QUALITY_LIMITS.minContrast) problems.push('FEATURELESS');
  else if (sharpness < QUALITY_LIMITS.minSharpness) problems.push('BLURRY');
  if (expected.closeUp && outdoorShare > QUALITY_LIMITS.maxOutdoorShareOfCloseUp) problems.push('WRONG_SUBJECT');

  return {
    ok: problems.length === 0,
    problems,
    metrics: {
      sharpness: Math.round(sharpness),
      brightness: Math.round(brightness),
      contrast: Math.round(contrast),
      outdoorShare: Math.round(outdoorShare * 100) / 100,
    },
  };
}

/**
 * Grade a captured photo against the shot it was taken for.
 *
 * @param {string} dataUrl  the photo, as a data URL
 * @param {object} [shot]  an `INSPECTION_SHOTS` entry; its `frame` and
 *   `mustShow` sharpen the checks and the advice given back
 * @returns {Promise<{ ok: boolean, problems: string[], messages: string[], metrics: object }>}
 */
export async function assessPhoto(dataUrl, shot = null) {
  const image = await loadImage(dataUrl);
  const height = Math.max(1, Math.round((image.height / image.width) * SAMPLE_WIDTH));
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_WIDTH;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, SAMPLE_WIDTH, height);

  const assessment = assessPixels(
    context.getImageData(0, 0, SAMPLE_WIDTH, height),
    { width: image.width, height: image.height },
    { closeUp: shot?.frame === 'close' },
  );
  return { ...assessment, messages: assessment.problems.map((problem) => advice(problem, shot)) };
}

/**
 * Fold a subject verdict from the server into a local assessment.
 *
 * The browser decides whether a photo is worth sending; only a vision model
 * can decide whether it shows the part that was asked for. When the API
 * gains that endpoint, call it with an accepted photo and pass the answer
 * here — the customer then sees one verdict in one voice, not two.
 *
 * @param {{ ok: boolean, problems: string[], metrics: object }} assessment
 * @param {{ showsRequestedPart: boolean }} verdict
 * @param {object} [shot]
 */
export function withSubjectVerdict(assessment, verdict, shot = null) {
  if (verdict?.showsRequestedPart !== false) return assessment;
  const problems = assessment.problems.includes('WRONG_SUBJECT')
    ? assessment.problems
    : [...assessment.problems, 'WRONG_SUBJECT'];
  return { ...assessment, ok: false, problems, messages: problems.map((problem) => advice(problem, shot)) };
}

/** What to say about a problem, naming the part when the shot is known. */
const advice = (problem, shot) =>
  problem === 'WRONG_SUBJECT' && shot?.mustShow
    ? `${PHOTO_PROBLEMS.WRONG_SUBJECT} Point the camera at ${lowerFirst(shot.mustShow)}.`
    : PHOTO_PROBLEMS[problem];

const lowerFirst = (text) => (/^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text);

// ── Measures ────────────────────────────────────────────────────────

/** Rec. 601 luma, which tracks perceived brightness better than a flat average. */
const toGreyscale = ({ data, width, height }) => {
  const grey = new Float32Array(width * height);
  for (let index = 0; index < grey.length; index += 1) {
    const offset = index * 4;
    grey[index] = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
  }
  return grey;
};

/**
 * Share of pixels coloured like foliage or open sky.
 *
 * Vehicles are overwhelmingly neutral — paint, glass, chrome, plastic, tar —
 * and the greys are skipped before any hue is considered, so a saturated
 * green or blue majority means the camera was pointed away from the car.
 */
const outdoorFraction = ({ data }) => {
  const pixels = data.length / 4;
  if (!pixels) return 0;
  let outdoor = 0;
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    const red = data[offset] / 255;
    const green = data[offset + 1] / 255;
    const blue = data[offset + 2] / 255;
    const max = Math.max(red, green, blue);
    const chroma = max - Math.min(red, green, blue);
    // Unsaturated: paintwork, shadow, glass, tarmac. Tells us nothing.
    if (chroma < 0.12 || max === 0 || chroma / max < 0.18) continue;
    const hue = hueOf(red, green, blue, max, chroma);
    const foliage = hue >= 60 && hue <= 170;
    const sky = hue >= 190 && hue <= 250 && max > 0.5;
    if (foliage || sky) outdoor += 1;
  }
  return outdoor / pixels;
};

/** Hue in degrees, from values already reduced to 0–1. */
const hueOf = (red, green, blue, max, chroma) => {
  const sixth = max === red ? ((green - blue) / chroma + 6) % 6 : max === green ? (blue - red) / chroma + 2 : (red - green) / chroma + 4;
  return sixth * 60;
};

const mean = (values) => {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) total += values[index];
  return values.length ? total / values.length : 0;
};

const standardDeviation = (values, average) => {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) total += (values[index] - average) ** 2;
  return values.length ? Math.sqrt(total / values.length) : 0;
};

/**
 * Variance of the Laplacian — the standard measure of focus. The kernel
 * responds to edges, so a sharp photo produces a wide spread of responses and
 * a blurred one almost none.
 */
const laplacianVariance = (grey, width, height) => {
  if (width < 3 || height < 3) return 0;
  const responses = new Float32Array((width - 2) * (height - 2));
  let cursor = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const centre = y * width + x;
      responses[cursor] =
        4 * grey[centre] - grey[centre - 1] - grey[centre + 1] - grey[centre - width] - grey[centre + width];
      cursor += 1;
    }
  }
  const average = mean(responses);
  return standardDeviation(responses, average) ** 2;
};

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That photo could not be read. Please take it again.'));
    image.src = src;
  });
