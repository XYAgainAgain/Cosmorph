/* Declarative parameter schema for Firmament. Every entry maps to a real
   uniform in engine/render/sky2d.js; defaults are copied from its DEFAULTS
   blocks and the modules' own *_DEFAULTS, so a fresh scene matches the engine. */

export const TIERS = [
  { id: 1, label: 'Basic' },
  { id: 2, label: 'Advanced' },
  { id: 3, label: 'Expert' },
];

export const PALETTE_OPTIONS = [
  { id: 'hooNatural', label: 'HOO Natural' },
  { id: 'hooBold', label: 'HOO Bold' },
  { id: 'sho', label: 'SHO Hubble' },
  { id: 'cfht', label: 'CFHT' },
];

/* OIII is the token default, so it carries no data-theme attribute; every other
   id is written straight onto the root element. */
export const DEFAULT_THEME = 'oiii';

export const UI_THEMES = [
  { id: DEFAULT_THEME, label: 'OIII Teal' },
  { id: 'halpha', label: 'Hα Crimson' },
  { id: 'hbeta', label: 'Hβ Ice' },
  { id: 'sii', label: 'SII Ruby' },
  { id: 'heii', label: 'HeII Blue' },
  { id: 'night', label: 'Night Vision' },
];

export const SPEED_STEPS = [1, 10, 60, 300, 1800, 3600, 21600];

/* Pan range in sky units (y is one screen height). Bounded because an absolute
   pad needs an axis, and composition never needs more than a couple of frames. */
export const CAMERA_RANGE = 2;

export const CAPTURE_SIZES = [
  { id: 'window', label: 'Window' },
  { id: '1920x1080', label: '1920 × 1080' },
  { id: '2560x1440', label: '2560 × 1440' },
  { id: '3840x2160', label: '3840 × 2160' },
  { id: '3440x1440', label: '3440 × 1440' },
  { id: '1440x2560', label: '1440 × 2560' },
];

/* Scene-level grading. These are compose.js uniforms, not entity params. */
export const SCENE_PARAMS = [
  {
    key: 'exposure', label: 'Exposure', min: 0.05, max: 3, step: 0.01, def: 0.85,
    group: 'Grading', tier: 1, u: 'uExposure',
  },
  {
    key: 'stretchK', label: 'Stretch', min: 1, max: 60, step: 0.5, def: 10,
    group: 'Grading', tier: 1,
    /* asinh normalizer is derived, never stored twice */
    set: (U, v) => { U.uStretchK.value = v; U.uStretchNorm.value = 1 / Math.asinh(v); },
  },
  {
    key: 'black', label: 'Black point', min: 0, max: 0.1, step: 0.001, def: 0.015,
    group: 'Grading', tier: 1, u: 'uBlack',
  },
  {
    key: 'scnr', label: 'Green SCNR', min: 0, max: 1, step: 0.01, def: 0,
    group: 'Grading', tier: 2, u: 'uScnr',
  },
  {
    key: 'dither', label: 'Output dither', min: 0, max: 0.02, step: 0.0005, def: 1.5 / 255,
    group: 'Grading', tier: 3, u: 'uDither',
  },
];

const p = (key, label, min, max, step, def, group, tier, extra = {}) => ({
  key, label, min, max, step, def, group, tier, ...extra,
});

/* Aspect-scaled framed position: sky x spans [0, aspect] */
const aspectX = (u) => ({ set: (U, v, ctx) => { U[u].value.x = v * ctx.aspect; } });
const plainY = (u) => ({ set: (U, v) => { U[u].value.y = v; } });

/* Ascending-edge pairs: the shader's smoothstep collapses if hi <= lo */
const pairLo = (loU, hiU, hiKey) => ({
  set: (U, v, ctx) => {
    U[loU].value = v;
    U[hiU].value = Math.max(ctx.params[hiKey], v + 0.001);
  },
});
const pairHi = (hiU, loKey) => ({
  set: (U, v, ctx) => { U[hiU].value = Math.max(v, ctx.params[loKey] + 0.001); },
});

/* radius × elong above 1 pushes a cometary tail outside the 3×3 cell search;
   per-clump jitter reaches 1.45× radius, which is where the factor comes from */
function globElong(radius, elong) {
  return Math.min(elong, 1 / Math.max(radius * 1.45, 1e-3));
}

/* The jet's two shipped silhouettes. `bow` stays on for both: the leading cap
   is the one feature a runaway and an HH jet share. */
export const JET_LOOKS = [
  { id: 'hh', label: 'Bipolar HH Jet', look: { beam: 1, bow: 1, counter: 1, wake: 0 } },
  { id: 'runaway', label: 'Runaway Bow Shock', look: { beam: 0, bow: 1, counter: 0, wake: 1 } },
];

/* `rank` is the default depth order (top of the list = farthest). It matches
   each type's default depth ascending, so a fresh scene loads the curated
   parallax spread; after that the user's drag order owns it. */
export const ENTITY_TYPES = [
  {
    type: 'stars',
    label: 'Stars',
    salt: 1,
    rank: 0,
    pinned: true,
    depthParam: null,
    /* Hiding is a live mute, not a removal: the engine renders the four base
       layers whether or not the scene lists them. */
    mute: { density: 0, gain: 0 },
    groups: ['Field', 'Bright Tier', 'Optics', 'Galactic Band'],
    params: [
      p('density', 'Faint density', 0, 1, 0.01, 0.75, 'Field', 1, { u: 'uStarDensity' }),
      p('count', 'Bright count', 0, 400, 1, 84, 'Bright Tier', 1, { structural: true }),
      p('gain', 'Bright gain', 0, 3, 0.01, 1.0, 'Bright Tier', 1, { u: 'uStarGain' }),
      p('twinkleDepth', 'Twinkle depth', 0, 1, 0.01, 0.3, 'Optics', 1, { u: 'uTwinkleDepth' }),
      p('spikeThreshold', 'Spike threshold', 0, 2, 0.01, 0.5, 'Optics', 1, { u: 'uSpikeThreshold' }),
      p('spikeAngle', 'Spike angle', 0, 1.5708, 0.005, 0.35, 'Optics', 1, { u: 'uSpikeAngle', unit: 'rad' }),
      p('twinkleRate', 'Twinkle rate', 0, 6000, 10, 1800, 'Optics', 3, { structural: true }),
      p('bandY', 'Band offset', -0.5, 1.5, 0.01, 0.32, 'Galactic Band', 2, { u: 'uBandY' }),
      p('bandTilt', 'Band tilt', -1, 1, 0.01, -0.28, 'Galactic Band', 2, { u: 'uBandTilt' }),
      p('bandGain', 'Off-band gain', 0, 1, 0.01, 0.45, 'Galactic Band', 2, { u: 'uBandGain' }),
      p('bandWidth', 'Band width', 0.05, 2, 0.01, 0.55, 'Galactic Band', 3, { u: 'uBandWidth' }),
    ],
  },

  {
    type: 'emission',
    label: 'Emission nebula',
    salt: 2,
    rank: 3,
    depth: 0.3,
    depthParam: { u: 'uDepthLine', max: 1 },
    mute: { gain: 0 },
    groups: ['Structure', 'Coverage', 'Ionizing Source', 'Species', 'Evolution', 'Depth'],
    params: [
      p('gain', 'Gain', 0, 3, 0.01, 1.2, 'Structure', 1, { u: 'uNebGain' }),
      p('freq', 'Frequency', 0.2, 4, 0.01, 1.35, 'Structure', 1, { u: 'uNebFreq' }),
      p('warp', 'Domain warp', 0, 3, 0.01, 1.3, 'Structure', 1, { u: 'uWarp' }),
      p('mottle', 'Mottling', 0, 3, 0.01, 1.3, 'Structure', 2, { u: 'uMottle' }),
      p('stria', 'Striations', 0, 1, 0.01, 0.35, 'Structure', 2, { u: 'uStria' }),
      p('contrast', 'Contrast', 0.2, 3, 0.01, 1.2, 'Structure', 2, { u: 'uNebContrast' }),
      p('covLo', 'Coverage low', 0, 1, 0.01, 0.3, 'Coverage', 2, pairLo('uCovLo', 'uCovHi', 'covHi')),
      p('covHi', 'Coverage high', 0, 1, 0.01, 0.48, 'Coverage', 2, pairHi('uCovHi', 'covLo')),
      p('ionRadius', 'Source radius', 0.05, 2, 0.01, 0.75, 'Ionizing Source', 1, {
        set: (U, v) => { U.uIonR2.value = Math.max(v * v, 1e-4); },
      }),
      p('ionSrc.0', 'Source X', -0.5, 2.5, 0.01, 1.05, 'Ionizing Source', 2, aspectX('uIonSrc')),
      p('ionSrc.1', 'Source Y', -0.5, 1.5, 0.01, 0.8, 'Ionizing Source', 2, plainY('uIonSrc')),
      p('oiii', 'OIII strength', 0, 1.5, 0.01, 0.55, 'Species', 1, { u: 'uOiii' }),
      p('sii', 'SII strength', 0, 1, 0.01, 0.12, 'Species', 2, { u: 'uSii' }),
      p('hotLo', 'Hot zone low', 0, 1, 0.01, 0.55, 'Species', 3, pairLo('uHotLo', 'uHotHi', 'hotHi')),
      p('hotHi', 'Hot zone high', 0, 1, 0.01, 0.9, 'Species', 3, pairHi('uHotHi', 'hotLo')),
      p('morphRate', 'Morph rate', 0, 2, 0.01, 0.35, 'Evolution', 2, { u: 'uMorphRate' }),
    ],
  },

  {
    type: 'ifn',
    label: 'IFN continuum',
    salt: 3,
    rank: 1,
    depth: 0.12,
    depthParam: { u: 'uDepthCont', max: 1 },
    mute: { amp: 0 },
    groups: ['Structure', 'Evolution', 'Depth'],
    params: [
      p('amp', 'Amplitude', 0, 1, 0.005, 0.16, 'Structure', 1, { u: 'uIfnAmp' }),
      p('freq', 'Frequency', 0.2, 5, 0.01, 1.3, 'Structure', 1, { u: 'uIfnFreq' }),
      p('morphRate', 'Morph rate', 0, 1, 0.01, 0.08, 'Evolution', 2, { u: 'uIfnMorph' }),
    ],
  },

  {
    type: 'darkDust',
    label: 'Dark wisps',
    salt: 4,
    rank: 11,
    depth: 0.55,
    depthParam: { u: 'uDepthWisp', max: 1 },
    mute: { tau: 0 },
    groups: ['Extinction', 'Evolution', 'Depth'],
    params: [
      p('tau', 'Optical depth', 0, 8, 0.01, 2.8, 'Extinction', 1, { u: 'uWispTau' }),
      p('freq', 'Frequency', 0.2, 8, 0.01, 3.2, 'Extinction', 1, { u: 'uWispFreq' }),
      p('threshold', 'Threshold', 0, 1, 0.01, 0.55, 'Extinction', 1, { u: 'uWispTh' }),
      p('softness', 'Edge softness', 0.001, 0.6, 0.001, 0.12, 'Extinction', 2, { u: 'uWispSoft' }),
      p('morphRate', 'Morph rate', 0, 1, 0.01, 0.18, 'Evolution', 2, { u: 'uWispMorph' }),
    ],
  },

  {
    type: 'globules',
    label: 'Bok globules',
    salt: 5,
    rank: 12,
    depth: 0.6,
    depthParam: { u: 'uDepthGlob', max: 0.95 },
    addable: true,
    mute: { tau: 0, rimGain: 0 },
    groups: ['Shape', 'Erosion', 'Density', 'Ionizing Source', 'Rim Lighting', 'Evolution', 'Depth'],
    params: [
      p('freq', 'Cell frequency', 0.5, 8, 0.01, 3.2, 'Shape', 1, { u: 'uGlobFreq' }),
      p('radius', 'Clump radius', 0.05, 0.6, 0.005, 0.34, 'Shape', 1, {
        set: (U, v, ctx) => {
          U.uGlobRadius.value = v;
          U.uGlobElong.value = globElong(v, ctx.params.elong);
        },
      }),
      p('fill', 'Fill fraction', 0, 1, 0.01, 0.6, 'Shape', 1, { u: 'uGlobFill' }),
      p('core', 'Core hardness', 0, 0.95, 0.01, 0.45, 'Shape', 2, { u: 'uGlobCore' }),
      p('elong', 'Tail elongation', 1, 6, 0.01, 2.4, 'Shape', 2, {
        set: (U, v, ctx) => { U.uGlobElong.value = globElong(ctx.params.radius, v); },
      }),
      p('taper', 'Tail taper', 0, 3, 0.01, 0.9, 'Shape', 3, { u: 'uGlobTaper' }),
      p('cometary', 'Cometary tails', 0, 1, 1, 1, 'Shape', 2, { kind: 'bool', structural: true }),
      p('detail', 'Detail frequency', 0.5, 6, 0.01, 2.4, 'Erosion', 2, { u: 'uGlobDetail' }),
      p('erode', 'Erosion', 0, 1, 0.01, 0.3, 'Erosion', 2, { u: 'uGlobErode' }),
      p('eroFreq', 'Erosion cells', 1, 12, 0.05, 5.0, 'Erosion', 3, { u: 'uGlobEroFreq' }),
      p('eroFall', 'Erosion falloff', 0.05, 2, 0.01, 0.6, 'Erosion', 3, { u: 'uGlobEroFall' }),
      p('tau', 'Optical depth', 0, 8, 0.01, 3.2, 'Density', 1, { u: 'uGlobTau' }),
      p('threshold', 'Threshold', 0, 1, 0.01, 0.28, 'Density', 2, { u: 'uGlobTh' }),
      p('softness', 'Edge softness', 0.001, 0.5, 0.001, 0.1, 'Density', 3, { u: 'uGlobSoft' }),
      p('ionRadius', 'Source radius', 0.05, 2, 0.01, 0.9, 'Ionizing Source', 2, {
        set: (U, v) => { U.uGlobIonR2.value = Math.max(v * v, 1e-4); },
      }),
      p('ionSrc.0', 'Source X', -0.5, 2.5, 0.01, 1.05, 'Ionizing Source', 2, aspectX('uGlobIonSrc')),
      p('ionSrc.1', 'Source Y', -0.5, 1.5, 0.01, 0.8, 'Ionizing Source', 2, plainY('uGlobIonSrc')),
      p('hotLo', 'Hot zone low', 0, 1, 0.01, 0.5, 'Ionizing Source', 3, pairLo('uGlobHotLo', 'uGlobHotHi', 'hotHi')),
      p('hotHi', 'Hot zone high', 0, 1, 0.01, 0.85, 'Ionizing Source', 3, pairHi('uGlobHotHi', 'hotLo')),
      p('rimGain', 'Rim gain', 0, 4, 0.01, 1.2, 'Rim Lighting', 1, { u: 'uRimGain' }),
      p('rimAt', 'Rim position', 0, 1, 0.01, 0.35, 'Rim Lighting', 2, { u: 'uRimAt' }),
      p('rimW', 'Rim width', 0.01, 0.6, 0.005, 0.22, 'Rim Lighting', 2, { u: 'uRimW' }),
      p('rimOiii', 'Rim OIII', 0, 1, 0.01, 0.5, 'Rim Lighting', 2, { u: 'uRimOiii' }),
      p('rimHalo', 'Rim halo', 0, 1, 0.01, 0.25, 'Rim Lighting', 3, { u: 'uRimHalo' }),
      p('rimKnot', 'Rim beading', 0, 1, 0.01, 0.6, 'Rim Lighting', 3, { u: 'uRimKnot' }),
      p('rimKnotFreq', 'Bead frequency', 1, 30, 0.1, 12.0, 'Rim Lighting', 3, { u: 'uRimKnotFreq' }),
      p('rimSii', 'Rim SII', 0, 1, 0.01, 0.15, 'Rim Lighting', 3, { u: 'uRimSii' }),
      p('rimEps', 'Slope epsilon', 0.001, 0.05, 0.001, 0.006, 'Rim Lighting', 3, { u: 'uRimEps' }),
      p('rimFacing', 'Facing falloff', 0.5, 20, 0.1, 6.0, 'Rim Lighting', 3, { u: 'uRimFacing' }),
      p('morphRate', 'Morph rate', 0, 1, 0.01, 0.1, 'Evolution', 2, { u: 'uGlobMorph' }),
    ],
  },

  {
    type: 'reflection',
    label: 'Reflection nebula',
    salt: 6,
    rank: 4,
    depth: 0.35,
    depthParam: { u: 'uDepthRefl', max: 0.95 },
    addable: true,
    mute: { lum: 0, filAmp: 0, tau: 0 },
    groups: ['Illumination', 'Scatter', 'Dust', 'Filaments', 'Extinction', 'Evolution', 'Depth'],
    params: [
      p('lum', 'Luminosity', 0, 3, 0.01, 0.9, 'Illumination', 1, { u: 'uReflLum' }),
      p('star.0', 'Star X', -0.5, 2.5, 0.01, 0.42, 'Illumination', 1, aspectX('uReflStar')),
      p('star.1', 'Star Y', -0.5, 1.5, 0.01, 0.58, 'Illumination', 1, plainY('uReflStar')),
      p('warmAmt', 'Warm core', 0, 1, 0.01, 0.55, 'Illumination', 2, { u: 'uReflWarmAmt' }),
      p('warmR', 'Warm radius', 0.01, 0.6, 0.005, 0.14, 'Illumination', 3, { u: 'uReflWarmR' }),
      p('radius.0', 'Red radius', 0.02, 1, 0.005, 0.14, 'Scatter', 2, { u: 'uReflRadius', comp: 'x' }),
      p('radius.1', 'Green radius', 0.02, 1, 0.005, 0.17, 'Scatter', 2, { u: 'uReflRadius', comp: 'y' }),
      p('radius.2', 'Blue radius', 0.02, 1, 0.005, 0.22, 'Scatter', 2, { u: 'uReflRadius', comp: 'z' }),
      p('falloff.0', 'Red falloff', 0.2, 5, 0.01, 2.6, 'Scatter', 3, { u: 'uReflFalloff', comp: 'x' }),
      p('falloff.1', 'Green falloff', 0.2, 5, 0.01, 2.3, 'Scatter', 3, { u: 'uReflFalloff', comp: 'y' }),
      p('falloff.2', 'Blue falloff', 0.2, 5, 0.01, 1.9, 'Scatter', 3, { u: 'uReflFalloff', comp: 'z' }),
      p('tint.0', 'Tint R', 0, 1.5, 0.01, 0.55, 'Scatter', 3, { u: 'uReflTint', comp: 'x' }),
      p('tint.1', 'Tint G', 0, 1.5, 0.01, 0.78, 'Scatter', 3, { u: 'uReflTint', comp: 'y' }),
      p('tint.2', 'Tint B', 0, 1.5, 0.01, 1.0, 'Scatter', 3, { u: 'uReflTint', comp: 'z' }),
      p('warm.0', 'Warm R', 0, 1.5, 0.01, 1.0, 'Scatter', 3, { u: 'uReflWarm', comp: 'x' }),
      p('warm.1', 'Warm G', 0, 1.5, 0.01, 0.64, 'Scatter', 3, { u: 'uReflWarm', comp: 'y' }),
      p('warm.2', 'Warm B', 0, 1.5, 0.01, 0.58, 'Scatter', 3, { u: 'uReflWarm', comp: 'z' }),
      p('dustLo', 'Dust low', 0, 1, 0.01, 0.34, 'Dust', 1, pairLo('uReflDustLo', 'uReflDustHi', 'dustHi')),
      p('dustHi', 'Dust high', 0, 1, 0.01, 0.62, 'Dust', 2, pairHi('uReflDustHi', 'dustLo')),
      p('freq', 'Dust frequency', 0.2, 8, 0.01, 2.1, 'Dust', 2, { u: 'uReflFreq' }),
      p('carve', 'Lit-edge carve', 0, 1, 0.01, 0.3, 'Dust', 3, { u: 'uReflCarve' }),
      p('floor', 'Coverage floor', 0, 1, 0.01, 0.28, 'Dust', 3, { u: 'uReflFloor' }),
      p('filAmp', 'Filament gain', 0, 2, 0.01, 0.35, 'Filaments', 1, { u: 'uReflFilAmp' }),
      p('filFreq', 'Filament freq', 1, 30, 0.1, 14.0, 'Filaments', 2, { u: 'uReflFilFreq' }),
      p('filAniso', 'Radial aniso', 0, 6, 0.01, 2.5, 'Filaments', 3, { u: 'uReflFilAniso' }),
      p('filIn', 'Mask inner', 0.001, 0.5, 0.001, 0.09, 'Filaments', 3, {
        set: (U, v, ctx) => {
          U.uReflFilIn.value = v;
          U.uReflFilOut.value = Math.max(ctx.params.filOut, v + 0.001);
        },
      }),
      p('filOut', 'Mask outer', 0.01, 1, 0.005, 0.34, 'Filaments', 3, {
        set: (U, v, ctx) => { U.uReflFilOut.value = Math.max(v, ctx.params.filIn + 0.001); },
      }),
      p('filSharp', 'Ridge sharpness', 0, 8, 0.01, 3.0, 'Filaments', 3, { u: 'uReflFilSharp' }),
      p('filHa', 'Filament Hα', 0, 2, 0.01, 0.5, 'Filaments', 3, { u: 'uReflFilHa' }),
      p('tau', 'Optical depth', 0, 3, 0.01, 0.35, 'Extinction', 2, { u: 'uReflTau' }),
      p('tauSpread', 'Tau spread', 0.1, 12, 0.05, 4.0, 'Extinction', 3, { u: 'uReflTauSpread' }),
      p('morph', 'Morph rate', 0, 1, 0.01, 0.06, 'Evolution', 2, { u: 'uReflMorph' }),
    ],
  },

  {
    type: 'filaments',
    label: 'SNR filaments',
    salt: 7,
    rank: 2,
    depth: 0.25,
    depthParam: { u: 'uDepthFil', max: 0.95 },
    addable: true,
    mute: { gain: 0, haze: 0 },
    groups: ['Shell', 'Threads', 'Haze', 'Species', 'Evolution', 'Depth'],
    params: [
      p('gain', 'Gain', 0, 2, 0.01, 0.26, 'Shell', 1, { u: 'uFilGain' }),
      p('radius', 'Shell radius', 0.05, 3, 0.005, 0.85, 'Shell', 1, { u: 'uArcRadius' }),
      p('thick', 'Shell thickness', 0.005, 0.5, 0.001, 0.075, 'Shell', 1, { u: 'uArcThick' }),
      p('center.0', 'Center X', -1.5, 3, 0.01, 0.5, 'Shell', 1, aspectX('uArcCenter')),
      p('center.1', 'Center Y', -1.5, 2.5, 0.01, 0.45, 'Shell', 1, plainY('uArcCenter')),
      p('rot', 'Shell rotation', -3.1416, 3.1416, 0.01, 0.35, 'Shell', 2, { u: 'uArcRot', unit: 'rad' }),
      p('squash', 'Ellipticity', 0.05, 3, 0.01, 0.92, 'Shell', 2, { u: 'uArcSquash' }),
      p('phase', 'Arc bearing', -3.1416, 3.1416, 0.01, 0.6, 'Shell', 2, { u: 'uArcPhase', unit: 'rad' }),
      p('half', 'Arc extent', 0, 3.1416, 0.01, 1.0, 'Shell', 2, { u: 'uArcHalf', unit: 'rad' }),
      p('soft', 'Arc taper', 0.01, 2, 0.01, 0.9, 'Shell', 3, { u: 'uArcSoft' }),
      p('expand', 'Expansion rate', 0, 0.001, 0.00001, 0.00015, 'Shell', 3, { u: 'uArcExpand' }),
      p('freq', 'Thread frequency', 1, 30, 0.1, 9.0, 'Threads', 2, { u: 'uFilFreq' }),
      p('warp', 'Radial warp', 0, 5, 0.01, 1.7, 'Threads', 2, { u: 'uFilWarp' }),
      p('braid', 'Braiding', 0, 1, 0.01, 0.75, 'Threads', 2, { u: 'uFilBraid' }),
      p('threshold', 'Threshold', 0, 1, 0.01, 0.66, 'Threads', 2, { u: 'uFilTh' }),
      p('aniso', 'Radial aniso', 0, 15, 0.05, 5.0, 'Threads', 3, { u: 'uFilAniso' }),
      p('kink', 'Kinking', 0, 3, 0.01, 0.85, 'Threads', 3, { u: 'uFilKink' }),
      p('sep', 'Species offset', 0, 0.05, 0.0005, 0.006, 'Threads', 3, { u: 'uFilSep' }),
      p('sharp', 'Ridge sharpness', 0, 12, 0.01, 5.0, 'Threads', 3, { u: 'uFilSharp' }),
      p('softness', 'Edge softness', 0.001, 1, 0.001, 0.24, 'Threads', 3, { u: 'uFilSoft' }),
      p('haze', 'Haze', 0, 1, 0.005, 0.07, 'Haze', 2, { u: 'uFilHaze' }),
      p('hazeW', 'Haze width', 1, 12, 0.05, 4.0, 'Haze', 3, { u: 'uFilHazeW' }),
      p('patch', 'Edge-on patch', 0, 1, 0.01, 0.7, 'Haze', 3, { u: 'uFilPatch' }),
      p('ha', 'Hα strength', 0, 2, 0.01, 0.78, 'Species', 2, { u: 'uFilHa' }),
      p('oiii', 'OIII strength', 0, 2, 0.01, 1.0, 'Species', 2, { u: 'uFilOiii' }),
      p('lace', 'Species lacework', 0, 1, 0.01, 0.4, 'Species', 2, { u: 'uFilLace' }),
      p('sii', 'SII strength', 0, 1, 0.01, 0.12, 'Species', 3, { u: 'uFilSii' }),
      p('morphRate', 'Morph rate', 0, 1, 0.01, 0.05, 'Evolution', 2, { u: 'uFilMorph' }),
    ],
  },

  {
    type: 'echo',
    label: 'Light echo',
    salt: 83,
    rank: 5,
    depth: 0.4,
    /* Past 0.58 its tau sits in front of the globules and sky2d warns: the
       compose rim exemption only holds while globules are the nearest tau. */
    depthParam: { u: 'uDepthEcho', max: 0.58 },
    addable: true,
    mute: { lum: 0, tau: 0, ha: 0 },
    groups: ['Source', 'Flash Cycle', 'Dust Cloud', 'Brightness', 'Tint', 'Species', 'Extinction', 'Depth'],
    params: [
      p('src.0', 'Source X', -0.5, 2.5, 0.01, 0.6, 'Source', 1, aspectX('uEchoSrc')),
      p('src.1', 'Source Y', -0.5, 1.5, 0.01, 0.54, 'Source', 1, plainY('uEchoSrc')),
      /* Below 0.02 the isodelay slice aliases; sky2d floors it there anyway */
      p('start', 'Start radius', 0.02, 0.3, 0.005, 0.04, 'Source', 3, { u: 'uEchoStart' }),
      p('refR', 'Falloff radius', 0.01, 1.5, 0.01, 0.34, 'Source', 3, { u: 'uEchoRefR' }),
      p('fall', 'Falloff power', 0, 5, 0.05, 2.0, 'Source', 3, { u: 'uEchoFall' }),
      p('attenMax', 'Falloff cap', 1, 20, 0.1, 2.5, 'Source', 3, { u: 'uEchoAttenMax' }),
      p('rate', 'Cycle rate', 0, 0.002, 0.00001, 0.0004, 'Flash Cycle', 2, { u: 'uEchoRate' }),
      p('span', 'Cycle span', 0.05, 2, 0.0001, 0.8192, 'Flash Cycle', 2, { u: 'uEchoSpan' }),
      p('phase', 'Cycle phase', 0, 1, 0.01, 0.2, 'Flash Cycle', 2, { u: 'uEchoPhase' }),
      p('fadeIn', 'Fade in', 0.001, 1, 0.001, 0.18, 'Flash Cycle', 3, { u: 'uEchoFadeIn' }),
      p('fadeOut', 'Fade out', 0, 0.999, 0.005, 0.24, 'Flash Cycle', 3, { u: 'uEchoFadeOut' }),
      p('shellR', 'Shell radius', 0, 1.2, 0.005, 0.34, 'Dust Cloud', 1, { u: 'uEchoShellR' }),
      p('shellW', 'Shell width', 0.005, 0.8, 0.005, 0.17, 'Dust Cloud', 1, { u: 'uEchoShellW' }),
      p('dustXY.0', 'Cloud offset X', -0.6, 0.6, 0.01, 0.09, 'Dust Cloud', 2, { u: 'uEchoDustXY', comp: 'x' }),
      p('dustXY.1', 'Cloud offset Y', -0.6, 0.6, 0.01, -0.06, 'Dust Cloud', 2, { u: 'uEchoDustXY', comp: 'y' }),
      p('dustZ', 'Cloud depth offset', -0.6, 0.6, 0.01, 0.1, 'Dust Cloud', 2, { u: 'uEchoDustZ' }),
      p('th', 'Threshold', 0, 1, 0.01, 0.52, 'Dust Cloud', 2, { u: 'uEchoTh' }),
      /* This cutoff is what bounds the sampled z domain, not decoration */
      p('outer', 'Outer cutoff', 0.1, 1.5, 0.01, 0.9, 'Dust Cloud', 3, { u: 'uEchoOuter' }),
      p('halo', 'Outer halo', 0, 1, 0.01, 0.22, 'Dust Cloud', 3, { u: 'uEchoHalo' }),
      p('freq', 'Frequency', 0.5, 20, 0.1, 5.5, 'Dust Cloud', 3, { u: 'uEchoFreq' }),
      p('zSquash', 'Depth squash', 0.05, 3, 0.01, 0.55, 'Dust Cloud', 3, { u: 'uEchoZSquash' }),
      p('carve', 'Carve', 0, 1, 0.01, 0.35, 'Dust Cloud', 3, { u: 'uEchoCarve' }),
      p('soft', 'Edge softness', 0.001, 0.6, 0.001, 0.22, 'Dust Cloud', 3, { u: 'uEchoSoft' }),
      p('lum', 'Luminosity', 0, 3, 0.01, 0.4, 'Brightness', 1, { u: 'uEchoLum' }),
      p('slab', 'Slab brightening', 0, 1, 0.01, 0.5, 'Brightness', 2, { u: 'uEchoSlab' }),
      p('slabMax', 'Slab cap', 1, 20, 0.1, 3.0, 'Brightness', 3, { u: 'uEchoSlabMax' }),
      p('roseAmt', 'Rose blend', 0, 1, 0.01, 0.3, 'Tint', 2, { u: 'uEchoRoseAmt' }),
      p('cool.0', 'Cool R', 0, 1.5, 0.01, 0.52, 'Tint', 3, { u: 'uEchoCool', comp: 'x' }),
      p('cool.1', 'Cool G', 0, 1.5, 0.01, 0.66, 'Tint', 3, { u: 'uEchoCool', comp: 'y' }),
      p('cool.2', 'Cool B', 0, 1.5, 0.01, 0.92, 'Tint', 3, { u: 'uEchoCool', comp: 'z' }),
      p('warm.0', 'Warm R', 0, 1.5, 0.01, 1.0, 'Tint', 3, { u: 'uEchoWarm', comp: 'x' }),
      p('warm.1', 'Warm G', 0, 1.5, 0.01, 0.86, 'Tint', 3, { u: 'uEchoWarm', comp: 'y' }),
      p('warm.2', 'Warm B', 0, 1.5, 0.01, 0.66, 'Tint', 3, { u: 'uEchoWarm', comp: 'z' }),
      p('rose.0', 'Rose R', 0, 1.5, 0.01, 1.0, 'Tint', 3, { u: 'uEchoRose', comp: 'x' }),
      p('rose.1', 'Rose G', 0, 1.5, 0.01, 0.7, 'Tint', 3, { u: 'uEchoRose', comp: 'y' }),
      p('rose.2', 'Rose B', 0, 1.5, 0.01, 0.72, 'Tint', 3, { u: 'uEchoRose', comp: 'z' }),
      p('hueLo', 'Hue low', 0, 1, 0.01, 0.42, 'Tint', 3, pairLo('uEchoHueLo', 'uEchoHueHi', 'hueHi')),
      p('hueHi', 'Hue high', 0, 1, 0.01, 0.72, 'Tint', 3, pairHi('uEchoHueHi', 'hueLo')),
      p('ha', 'Hα whisper', 0, 2, 0.01, 0.35, 'Species', 2, { u: 'uEchoHa' }),
      p('haOn', 'Hα pass', 0, 1, 1, 0, 'Species', 3, { kind: 'bool', structural: true }),
      p('tau', 'Optical depth', 0, 4, 0.01, 0.45, 'Extinction', 2, { u: 'uEchoTau' }),
      p('tauTh', 'Tau threshold', 0, 1, 0.01, 0.6, 'Extinction', 3, { u: 'uEchoTauTh' }),
      p('tauZ', 'Tau slice', -1, 1, 0.01, 0, 'Extinction', 3, { u: 'uEchoTauZ' }),
    ],
  },

  {
    type: 'searchlight',
    label: 'Protoplanetary beams',
    salt: 97,
    rank: 6,
    depth: 0.4,
    depthParam: { u: 'uDepthBeam', max: 0.58 },
    addable: true,
    mute: { lum: 0, tau: 0 },
    groups: ['Beams', 'Illumination', 'Rays', 'Arcs', 'Rungs', 'Torus', 'Evolution', 'Depth'],
    params: [
      p('center.0', 'Center X', -0.5, 2.5, 0.01, 0.5, 'Beams', 1, aspectX('uBeamCenter')),
      p('center.1', 'Center Y', -0.5, 1.5, 0.01, 0.52, 'Beams', 1, plainY('uBeamCenter')),
      p('axis', 'Polar axis', -3.1416, 3.1416, 0.01, 0.55, 'Beams', 1, { u: 'uBeamAxis', unit: 'rad' }),
      p('len', 'Beam length', 0.05, 2, 0.01, 0.72, 'Beams', 1, { u: 'uBeamLen' }),
      p('half', 'Cone half-angle', 0.02, 1.45, 0.005, 0.3, 'Beams', 1, { u: 'uBeamHalf', unit: 'rad' }),
      p('throat', 'Throat radius', 0.001, 0.5, 0.001, 0.05, 'Beams', 2, { u: 'uBeamThroat' }),
      p('taper', 'Tip taper', 0, 0.95, 0.01, 0.55, 'Beams', 2, { u: 'uBeamTaper' }),
      p('asym', 'Lobe asymmetry', 0, 0.9, 0.01, 0.22, 'Beams', 2, { u: 'uBeamAsym' }),
      p('wall', 'Wall accent', 0, 1, 0.01, 0.45, 'Beams', 2, { u: 'uBeamWall' }),
      /* This uniform IS the cutoff sharpness; a large value erases the read */
      p('soft', 'Cone edge', 0.001, 0.15, 0.001, 0.035, 'Beams', 3, { u: 'uBeamSoft', unit: 'rad' }),
      p('core', 'Core radius', 0.001, 0.5, 0.001, 0.06, 'Beams', 3, { u: 'uBeamCore' }),
      p('fall', 'Dilution power', 0.05, 5, 0.01, 1.8, 'Beams', 3, { u: 'uBeamFall' }),
      p('wallK', 'Wall power', 0, 8, 0.05, 1.6, 'Beams', 3, { u: 'uBeamWallK' }),
      p('lum', 'Luminosity', 0, 3, 0.01, 0.6, 'Illumination', 1, { u: 'uBeamLum' }),
      p('struct', 'Structure gain', 0, 2, 0.01, 0.5, 'Illumination', 2, { u: 'uBeamStruct' }),
      p('glow', 'Envelope glow', 0, 2, 0.01, 0.3, 'Illumination', 2, { u: 'uBeamGlow' }),
      p('warmAmt', 'Warm core', 0, 1, 0.01, 0.6, 'Illumination', 2, { u: 'uBeamWarmAmt' }),
      p('warmR', 'Warm radius', 0.001, 0.6, 0.001, 0.12, 'Illumination', 3, { u: 'uBeamWarmR' }),
      p('tint.0', 'Tint R', 0, 1.5, 0.01, 1.0, 'Illumination', 3, { u: 'uBeamTint', comp: 'x' }),
      p('tint.1', 'Tint G', 0, 1.5, 0.01, 0.97, 'Illumination', 3, { u: 'uBeamTint', comp: 'y' }),
      p('tint.2', 'Tint B', 0, 1.5, 0.01, 0.9, 'Illumination', 3, { u: 'uBeamTint', comp: 'z' }),
      p('warm.0', 'Warm R', 0, 1.5, 0.01, 1.0, 'Illumination', 3, { u: 'uBeamWarm', comp: 'x' }),
      p('warm.1', 'Warm G', 0, 1.5, 0.01, 0.93, 'Illumination', 3, { u: 'uBeamWarm', comp: 'y' }),
      p('warm.2', 'Warm B', 0, 1.5, 0.01, 0.76, 'Illumination', 3, { u: 'uBeamWarm', comp: 'z' }),
      p('threshold', 'Ray threshold', 0, 1, 0.01, 0.34, 'Rays', 2, { u: 'uBeamTh' }),
      p('rayFreq', 'Ray frequency', 0.5, 40, 0.1, 9.0, 'Rays', 3, { u: 'uBeamRayFreq' }),
      p('rayAniso', 'Ray anisotropy', 0, 3, 0.01, 0.1, 'Rays', 3, { u: 'uBeamRayAniso' }),
      p('raySoft', 'Ray softness', 0.001, 1, 0.001, 0.42, 'Rays', 3, { u: 'uBeamRaySoft' }),
      p('arcs', 'Mass-loss arcs', 0, 1, 1, 1, 'Arcs', 2, { kind: 'bool', structural: true }),
      p('arcAmp', 'Arc amplitude', 0, 0.5, 0.001, 0.05, 'Arcs', 2, { u: 'uBeamArcAmp' }),
      p('arcR', 'Arc decay radius', 0.01, 1.5, 0.01, 0.35, 'Arcs', 2, { u: 'uBeamArcR' }),
      p('arcDrift', 'Arc drift', 0, 0.05, 0.0005, 0.009, 'Arcs', 2, { u: 'uBeamArcDrift' }),
      p('arcFreq', 'Arc frequency', 1, 120, 0.5, 46.0, 'Arcs', 3, { u: 'uBeamArcFreq' }),
      p('arcSharp', 'Arc sharpness', 0, 8, 0.05, 2.5, 'Arcs', 3, { u: 'uBeamArcSharp' }),
      p('arcIn', 'Arc inner radius', 0.001, 0.5, 0.001, 0.06, 'Arcs', 3, { u: 'uBeamArcIn' }),
      p('arcAzimFreq', 'Arc break-up', 0, 20, 0.1, 4.0, 'Arcs', 3, { u: 'uBeamArcAzimFreq' }),
      p('rungs', 'Rung ladder', 0, 1, 1, 0, 'Rungs', 3, { kind: 'bool', structural: true }),
      p('rungAmt', 'Rung amount', 0, 1, 0.01, 0.5, 'Rungs', 3, { u: 'uBeamRungAmt' }),
      p('rungFreq', 'Rung frequency', 1, 120, 0.5, 34.0, 'Rungs', 3, { u: 'uBeamRungFreq' }),
      p('rungSharp', 'Rung sharpness', 0, 8, 0.05, 2.0, 'Rungs', 3, { u: 'uBeamRungSharp' }),
      p('torusR', 'Torus radius', 0.01, 1.5, 0.005, 0.3, 'Torus', 2, { u: 'uBeamTorusR' }),
      p('torusT', 'Torus thickness', 0.001, 0.4, 0.001, 0.045, 'Torus', 2, { u: 'uBeamTorusT' }),
      p('tau', 'Optical depth', 0, 6, 0.01, 2.2, 'Torus', 2, { u: 'uBeamTau' }),
      p('torusFlare', 'Torus flare', 0, 3, 0.01, 0.6, 'Torus', 3, { u: 'uBeamTorusFlare' }),
      p('ansae', 'Ansae deepening', 0, 4, 0.01, 0.8, 'Torus', 3, { u: 'uBeamAnsae' }),
      p('torusFreq', 'Torus frequency', 0.5, 30, 0.1, 7.0, 'Torus', 3, { u: 'uBeamTorusFreq' }),
      p('torusTh', 'Torus threshold', 0, 1, 0.01, 0.42, 'Torus', 3, { u: 'uBeamTorusTh' }),
      p('torusSoft', 'Torus softness', 0.001, 1, 0.001, 0.18, 'Torus', 3, { u: 'uBeamTorusSoft' }),
      p('torusFloor', 'Torus floor', 0, 1, 0.01, 0.45, 'Torus', 3, { u: 'uBeamTorusFloor' }),
      /* Below ~0.0008 rad/h the seamless fold quantizes the spin to a stop */
      p('spin', 'Axis spin', 0, 0.05, 0.0005, 0.003, 'Evolution', 2, { u: 'uBeamSpin' }),
      p('morphRate', 'Morph rate', 0, 1, 0.01, 0.05, 'Evolution', 2, { u: 'uBeamMorph' }),
    ],
  },

  {
    type: 'shadowFan',
    label: 'Shadow fan',
    salt: 89,
    rank: 7,
    depth: 0.42,
    depthParam: { u: 'uDepthFan', max: 0.58 },
    addable: true,
    mute: { lum: 0, tau: 0 },
    groups: ['Cone', 'Illumination', 'Dust', 'Shadow Bands', 'Evolution', 'Extinction', 'Depth'],
    params: [
      p('apex.0', 'Apex X', -0.5, 2.5, 0.01, 0.74, 'Cone', 1, aspectX('uFanApex')),
      p('apex.1', 'Apex Y', -0.5, 1.5, 0.01, 0.78, 'Cone', 1, plainY('uFanApex')),
      p('angle', 'Bearing', -3.1416, 3.1416, 0.01, -2.15, 'Cone', 1, { u: 'uFanAngle', unit: 'rad' }),
      p('half', 'Half-angle', 0.02, 1.5708, 0.005, 0.42, 'Cone', 1, { u: 'uFanHalf', unit: 'rad' }),
      p('len', 'Length', 0.01, 2, 0.01, 0.5, 'Cone', 1, { u: 'uFanLen' }),
      p('edge', 'Edge softness', 0.001, 1, 0.001, 0.16, 'Cone', 2, { u: 'uFanEdge', unit: 'rad' }),
      p('fade', 'Tip fade', 0, 0.95, 0.01, 0.45, 'Cone', 2, { u: 'uFanFade' }),
      p('limb', 'Wall limb', 0, 3, 0.01, 0.5, 'Cone', 3, { u: 'uFanLimb' }),
      p('lum', 'Luminosity', 0, 3, 0.01, 0.5, 'Illumination', 1, { u: 'uFanLum' }),
      p('litR', 'Lit radius', 0.001, 1, 0.001, 0.14, 'Illumination', 2, { u: 'uFanLitR' }),
      p('falloff', 'Falloff power', 0.05, 5, 0.01, 1.0, 'Illumination', 2, { u: 'uFanFalloff' }),
      p('warmAmt', 'Warm apex', 0, 1, 0.01, 0.45, 'Illumination', 2, { u: 'uFanWarmAmt' }),
      p('warmR', 'Warm radius', 0.001, 0.5, 0.001, 0.05, 'Illumination', 3, { u: 'uFanWarmR' }),
      p('tint.0', 'Tint R', 0, 1.5, 0.01, 0.62, 'Illumination', 3, { u: 'uFanTint', comp: 'x' }),
      p('tint.1', 'Tint G', 0, 1.5, 0.01, 0.76, 'Illumination', 3, { u: 'uFanTint', comp: 'y' }),
      p('tint.2', 'Tint B', 0, 1.5, 0.01, 1.0, 'Illumination', 3, { u: 'uFanTint', comp: 'z' }),
      p('warm.0', 'Warm R', 0, 1.5, 0.01, 1.0, 'Illumination', 3, { u: 'uFanWarm', comp: 'x' }),
      p('warm.1', 'Warm G', 0, 1.5, 0.01, 0.82, 'Illumination', 3, { u: 'uFanWarm', comp: 'y' }),
      p('warm.2', 'Warm B', 0, 1.5, 0.01, 0.62, 'Illumination', 3, { u: 'uFanWarm', comp: 'z' }),
      p('threshold', 'Threshold', 0, 1, 0.01, 0.4, 'Dust', 2, { u: 'uFanTh' }),
      p('floor', 'Body floor', 0, 1, 0.01, 0.28, 'Dust', 2, { u: 'uFanFloor' }),
      p('mottle', 'Mottling', 0, 1, 0.01, 0.35, 'Dust', 2, { u: 'uFanMottle' }),
      p('mottleOn', 'Mottle pass', 0, 1, 1, 1, 'Dust', 3, { kind: 'bool', structural: true }),
      p('freq', 'Frequency', 0.5, 30, 0.1, 12.0, 'Dust', 3, { u: 'uFanFreq' }),
      p('aniso', 'Radial comb', 0, 4, 0.01, 0.25, 'Dust', 3, { u: 'uFanAniso' }),
      p('softness', 'Edge softness', 0.001, 1, 0.001, 0.3, 'Dust', 3, { u: 'uFanSoft' }),
      p('motFreq', 'Mottle frequency', 0.5, 20, 0.1, 5.5, 'Dust', 3, { u: 'uFanMotFreq' }),
      p('shadow', 'Band contrast', 0, 1, 0.01, 0.85, 'Shadow Bands', 1, { u: 'uFanShadow' }),
      p('shadowCount', 'Blocker count', 0, 12, 1, 5, 'Shadow Bands', 2, { structural: true }),
      p('shadowW', 'Band width', 0.001, 0.6, 0.001, 0.13, 'Shadow Bands', 2, { u: 'uFanShadowW', unit: 'rad' }),
      p('rotRate', 'Rotation rate', -0.02, 0.02, 0.0001, 0.0016, 'Shadow Bands', 2, { u: 'uFanRot' }),
      p('pen', 'Penumbra', 0, 0.5, 0.001, 0.045, 'Shadow Bands', 3, { u: 'uFanPen', unit: 'rad' }),
      p('penGrow', 'Penumbra growth', 0, 0.6, 0.005, 0.14, 'Shadow Bands', 3, { u: 'uFanPenGrow', unit: 'rad' }),
      p('spread', 'Rate jitter', 0, 3, 0.01, 0.5, 'Shadow Bands', 3, { u: 'uFanSpread' }),
      p('shadowIn', 'Band fade-in', 0.001, 0.5, 0.001, 0.03, 'Shadow Bands', 3, { u: 'uFanShadowIn' }),
      p('morphRate', 'Morph rate', 0, 1, 0.01, 0.05, 'Evolution', 2, { u: 'uFanMorph' }),
      p('tau', 'Optical depth', 0, 3, 0.01, 0.18, 'Extinction', 2, { u: 'uFanTau' }),
    ],
  },

  {
    type: 'jets',
    label: 'HH jets',
    salt: 103,
    rank: 8,
    depth: 0.42,
    depthParam: { u: 'uDepthJet', max: 0.95 },
    addable: true,
    mute: { ha: 0, oiii: 0, sii: 0 },
    groups: ['Look', 'Source', 'Beam', 'Knots', 'Texture', 'Bow Shock', 'Wake', 'Species', 'Evolution', 'Depth'],
    params: [
      {
        key: 'look',
        label: 'Look',
        group: 'Look',
        tier: 1,
        kind: 'enum',
        /* Writes look.* and stores nothing of its own; the four toggles below
           are the state, so a preset file never carries a redundant copy. */
        derived: true,
        structural: true,
        refresh: true,
        options: JET_LOOKS,
        read: (params) => (getPath(params, 'look.wake') && !getPath(params, 'look.beam') ? 'runaway' : 'hh'),
        write: (params, id) => {
          const pick = JET_LOOKS.find((o) => o.id === id) ?? JET_LOOKS[0];
          for (const key of Object.keys(pick.look)) setPath(params, `look.${key}`, pick.look[key]);
        },
      },
      p('look.beam', 'Beam', 0, 1, 1, 1, 'Look', 3, { kind: 'bool', structural: true, refresh: true }),
      p('look.bow', 'Leading bow cap', 0, 1, 1, 1, 'Look', 3, { kind: 'bool', structural: true, refresh: true }),
      p('look.counter', 'Counter cap', 0, 1, 1, 1, 'Look', 3, { kind: 'bool', structural: true, refresh: true }),
      p('look.wake', 'Runaway wake', 0, 1, 1, 0, 'Look', 3, { kind: 'bool', structural: true, refresh: true }),
      p('src.0', 'Source X', -0.5, 2.5, 0.01, 0.58, 'Source', 1, aspectX('uJetSrc')),
      p('src.1', 'Source Y', -0.5, 1.5, 0.01, 0.4, 'Source', 1, plainY('uJetSrc')),
      p('angle', 'Jet angle', -3.1416, 3.1416, 0.01, 0.62, 'Source', 1, { u: 'uJetAngle', unit: 'rad' }),
      p('len', 'Arm length', 0.01, 1.5, 0.005, 0.36, 'Source', 1, { u: 'uJetLen' }),
      p('asym', 'Arm asymmetry', 0.05, 1, 0.01, 0.82, 'Source', 2, { u: 'uJetAsym' }),
      p('gap', 'Birth gap', 0.001, 0.2, 0.001, 0.022, 'Source', 2, { u: 'uJetGap' }),
      p('beamGain', 'Beam gain', 0, 2, 0.01, 0.36, 'Beam', 1, { u: 'uJetBeamGain' }),
      p('width', 'Beam width', 0.0005, 0.1, 0.0005, 0.008, 'Beam', 2, { u: 'uJetWidth' }),
      p('flare', 'Beam flare', 0, 6, 0.01, 1.6, 'Beam', 2, { u: 'uJetFlare' }),
      p('taper', 'Beam taper', 0, 0.95, 0.01, 0.7, 'Beam', 2, { u: 'uJetTaper' }),
      p('precess', 'Precession', 0, 0.2, 0.001, 0.012, 'Beam', 2, { u: 'uJetPrecess' }),
      p('precFreq', 'Precession freq', 0, 30, 0.1, 7.0, 'Beam', 3, { u: 'uJetPrecFreq' }),
      p('precRate', 'Precession rate', 0, 3, 0.01, 0.35, 'Beam', 3, { u: 'uJetPrecRate' }),
      p('beamSii', 'Beam SII', 0, 2, 0.01, 0.25, 'Beam', 3, { u: 'uJetBeamSii' }),
      p('knotFreq', 'Knot frequency', 0, 60, 0.5, 14.0, 'Knots', 2, { u: 'uJetKnotFreq' }),
      p('drift', 'Knot drift', -20, 20, 0.1, 3.0, 'Knots', 2, { u: 'uJetDrift' }),
      p('knotSharp', 'Knot sharpness', 0, 20, 0.1, 6.0, 'Knots', 3, { u: 'uJetKnotSharp' }),
      p('knotJit', 'Knot jitter', 0, 0.9, 0.01, 0.35, 'Knots', 3, { u: 'uJetKnotJit' }),
      p('knotFloor', 'Inter-knot floor', 0, 1, 0.01, 0.45, 'Knots', 3, { u: 'uJetKnotFloor' }),
      p('knotFade', 'Knot distance fade', 0, 1, 0.01, 0.45, 'Knots', 3, { u: 'uJetKnotFade' }),
      p('threshold', 'Threshold', 0, 1, 0.01, 0.3, 'Texture', 2, { u: 'uJetTh' }),
      p('texFreq', 'Texture frequency', 0, 60, 0.5, 20.0, 'Texture', 3, { u: 'uJetTexFreq' }),
      p('texAniso', 'Texture anisotropy', 0, 3, 0.01, 0.25, 'Texture', 3, { u: 'uJetTexAniso' }),
      p('softness', 'Edge softness', 0.001, 1, 0.001, 0.3, 'Texture', 3, { u: 'uJetSoft' }),
      p('shockFreq', 'Shock frequency', 0, 60, 0.5, 16.0, 'Texture', 3, { u: 'uJetShockFreq' }),
      p('bowGain', 'Bow gain', 0, 2, 0.01, 0.4, 'Bow Shock', 1, { u: 'uJetBowGain' }),
      p('bowStand', 'Standoff', 0, 1.5, 0.005, 0.37, 'Bow Shock', 2, { u: 'uJetBowStand' }),
      p('bowSpan', 'Wing span', 0.001, 1, 0.001, 0.14, 'Bow Shock', 2, { u: 'uJetBowSpan' }),
      p('bowCurv', 'Curvature', 0, 40, 0.1, 7.0, 'Bow Shock', 2, { u: 'uJetBowCurv' }),
      p('bowThick', 'Shell thickness', 0.0005, 0.2, 0.0005, 0.014, 'Bow Shock', 3, { u: 'uJetBowThick' }),
      p('bowSep', 'Strand separation', 0, 0.1, 0.0005, 0.011, 'Bow Shock', 3, { u: 'uJetBowSep' }),
      p('bowFace', 'Facing power', 0, 6, 0.01, 1.4, 'Bow Shock', 3, { u: 'uJetBowFace' }),
      p('bowTh', 'Bow threshold', 0, 1, 0.01, 0.22, 'Bow Shock', 3, { u: 'uJetBowTh' }),
      p('wakeGain', 'Wake gain', 0, 2, 0.01, 0.12, 'Wake', 1, { u: 'uJetWakeGain' }),
      p('wakeLen', 'Wake length', 0.001, 2, 0.001, 0.5, 'Wake', 2, { u: 'uJetWakeLen' }),
      p('wakeW', 'Wake width', 0.001, 0.5, 0.001, 0.05, 'Wake', 2, { u: 'uJetWakeW' }),
      p('wakeFlare', 'Wake flare', 0, 8, 0.05, 2.5, 'Wake', 3, { u: 'uJetWakeFlare' }),
      p('ha', 'Hα strength', 0, 2, 0.01, 0.95, 'Species', 2, { u: 'uJetHa' }),
      p('oiii', 'OIII strength', 0, 2, 0.01, 1.0, 'Species', 2, { u: 'uJetOiii' }),
      p('sii', 'SII strength', 0, 2, 0.01, 0.7, 'Species', 2, { u: 'uJetSii' }),
      p('leadOiii', 'Leading OIII', 0, 2, 0.01, 0.45, 'Species', 3, { u: 'uJetLeadOiii' }),
      /* hooNatural zeroes SII, so the trailing strand needs an Hα fraction or
         the two-strand candy stripe renders as one strand. */
      p('trailHa', 'Trailing Hα', 0, 2, 0.01, 0.55, 'Species', 3, { u: 'uJetTrailHa' }),
      p('morphRate', 'Morph rate', 0, 1, 0.01, 0.12, 'Evolution', 2, { u: 'uJetMorph' }),
    ],
  },

  {
    type: 'wrbubble',
    label: 'Wolf-Rayet bubble',
    salt: 107,
    rank: 9,
    depth: 0.42,
    depthParam: { u: 'uDepthWrb', max: 0.95 },
    addable: true,
    mute: { gain: 0, starLum: 0 },
    groups: ['Shell', 'Bow Shock', 'Completeness', 'Fibres', 'Species', 'Horns', 'Central Star', 'Evolution', 'Depth'],
    params: [
      p('center.0', 'Center X', -0.5, 2.5, 0.01, 0.46, 'Shell', 1, aspectX('uWrbCenter')),
      p('center.1', 'Center Y', -0.5, 1.5, 0.01, 0.52, 'Shell', 1, plainY('uWrbCenter')),
      p('radius', 'Radius', 0.01, 1.5, 0.005, 0.28, 'Shell', 1, { u: 'uWrbRadius' }),
      p('ratio', 'OIII shell ratio', 0.15, 0.95, 0.01, 0.7, 'Shell', 2, { u: 'uWrbRatio' }),
      /* Below ~0.05 the chord's sqrt cusp narrows to a crawling one-pixel ring */
      p('thick', 'Hα thickness', 0.02, 0.9, 0.005, 0.17, 'Shell', 2, { u: 'uWrbThick' }),
      p('thickO', 'OIII thickness', 0.02, 0.9, 0.005, 0.22, 'Shell', 2, { u: 'uWrbThickO' }),
      p('expand', 'Expansion rate', 0, 0.0002, 0.000001, 0.000034, 'Shell', 3, { u: 'uWrbExpand' }),
      p('axis', 'Motion axis', -3.1416, 3.1416, 0.01, 0.35, 'Bow Shock', 2, { u: 'uWrbAxis', unit: 'rad' }),
      p('bow', 'Nose flattening', 0, 1.5, 0.01, 0.55, 'Bow Shock', 2, { u: 'uWrbBow' }),
      p('wing', 'Flank flare', 0, 0.8, 0.01, 0.3, 'Bow Shock', 3, { u: 'uWrbWing' }),
      p('comp', 'Completeness', 0, 1, 0.01, 0.8, 'Completeness', 2, { u: 'uWrbComp' }),
      p('gapPhase', 'Gap bearing', -3.1416, 3.1416, 0.01, 2.4, 'Completeness', 2, { u: 'uWrbGapPhase', unit: 'rad' }),
      p('compSoft', 'Gap softness', 0.001, 2, 0.001, 0.5, 'Completeness', 3, { u: 'uWrbCompSoft' }),
      p('compO', 'OIII gap survival', 0, 1, 0.01, 0.4, 'Completeness', 3, { u: 'uWrbCompO' }),
      p('threshold', 'Threshold', 0, 1, 0.01, 0.7, 'Fibres', 2, { u: 'uWrbTh' }),
      p('warp', 'Domain warp', 0, 3, 0.01, 0.85, 'Fibres', 2, { u: 'uWrbWarp' }),
      /* Past ~60 the fibres alias against the foreshortened limb */
      p('fibFreq', 'Fibre frequency', 0, 60, 0.5, 28.0, 'Fibres', 3, { u: 'uWrbFibFreq' }),
      p('fibAniso', 'Fibre anisotropy', 0, 2, 0.01, 0.55, 'Fibres', 3, { u: 'uWrbFibAniso' }),
      p('fibSharp', 'Ridge sharpness', 0, 8, 0.05, 2.0, 'Fibres', 3, { u: 'uWrbFibSharp' }),
      p('warp2', 'Shear warp', 0, 3, 0.01, 0.45, 'Fibres', 3, { u: 'uWrbWarp2' }),
      p('softness', 'Edge softness', 0.001, 1, 0.001, 0.26, 'Fibres', 3, { u: 'uWrbSoft' }),
      p('patch', 'Patchiness', 0, 1, 0.01, 0.55, 'Fibres', 3, { u: 'uWrbPatch' }),
      p('bleed', 'Species bleed', 0, 1, 0.01, 0.18, 'Fibres', 3, { u: 'uWrbBleed' }),
      p('gain', 'Gain', 0, 2, 0.01, 0.3, 'Species', 1, { u: 'uWrbGain' }),
      p('ha', 'Hα strength', 0, 2, 0.01, 0.85, 'Species', 2, { u: 'uWrbHa' }),
      p('oiii', 'OIII strength', 0, 2, 0.01, 1.0, 'Species', 2, { u: 'uWrbOiii' }),
      p('sii', 'SII strength', 0, 2, 0.01, 0.1, 'Species', 3, { u: 'uWrbSii' }),
      p('horns', 'Horns', 0, 1, 1, 0, 'Horns', 2, { kind: 'bool', structural: true }),
      p('hornPhi', 'Horn bearing', -3.1416, 3.1416, 0.01, 0.95, 'Horns', 3, { u: 'uWrbHornPhi', unit: 'rad' }),
      p('hornTilt', 'Horn tilt', -3.1416, 3.1416, 0.01, 0.55, 'Horns', 3, { u: 'uWrbHornTilt', unit: 'rad' }),
      p('hornLen', 'Horn length', 0, 3, 0.01, 0.85, 'Horns', 3, { u: 'uWrbHornLen' }),
      p('hornW', 'Horn width', 0.001, 0.3, 0.001, 0.055, 'Horns', 3, { u: 'uWrbHornW' }),
      p('hornFeather', 'Horn feather', 0.001, 0.5, 0.001, 0.05, 'Horns', 3, { u: 'uWrbHornFeather' }),
      p('hornAmt', 'Horn amount', 0, 2, 0.01, 0.7, 'Horns', 3, { u: 'uWrbHornAmt' }),
      p('starLum', 'Star luminosity', 0, 3, 0.01, 0.45, 'Central Star', 1, { u: 'uWrbStarLum' }),
      /* An offset in units of R, so it must not be aspect-scaled */
      p('starAt.0', 'Star offset X', -1, 1, 0.01, 0.06, 'Central Star', 2, { u: 'uWrbStarAt', comp: 'x' }),
      p('starAt.1', 'Star offset Y', -1, 1, 0.01, -0.04, 'Central Star', 2, { u: 'uWrbStarAt', comp: 'y' }),
      p('starCore', 'Core radius', 0.0005, 0.05, 0.0005, 0.006, 'Central Star', 3, { u: 'uWrbStarCore' }),
      p('starBeta', 'Moffat beta', 0.5, 6, 0.01, 1.9, 'Central Star', 3, { u: 'uWrbStarBeta' }),
      p('starHalo', 'Halo amount', 0, 1, 0.005, 0.05, 'Central Star', 3, { u: 'uWrbStarHalo' }),
      p('starHaloR', 'Halo radius', 0.001, 0.5, 0.001, 0.07, 'Central Star', 3, { u: 'uWrbStarHaloR' }),
      p('starTint.0', 'Star R', 0, 1.5, 0.01, 0.76, 'Central Star', 3, { u: 'uWrbStarTint', comp: 'x' }),
      p('starTint.1', 'Star G', 0, 1.5, 0.01, 0.86, 'Central Star', 3, { u: 'uWrbStarTint', comp: 'y' }),
      p('starTint.2', 'Star B', 0, 1.5, 0.01, 1.0, 'Central Star', 3, { u: 'uWrbStarTint', comp: 'z' }),
      p('morphRate', 'Morph rate', 0, 1, 0.01, 0.06, 'Evolution', 2, { u: 'uWrbMorph' }),
    ],
  },

  {
    type: 'planetary',
    label: 'Planetary nebula',
    salt: 101,
    rank: 10,
    depth: 0.45,
    depthParam: { u: 'uDepthPn', max: 0.95 },
    addable: true,
    mute: { gain: 0, starLum: 0 },
    groups: ['Shell', 'Morphology', 'Rings', 'Striations', 'Coverage', 'Halo', 'FLIERs', 'Central Star', 'Species', 'Evolution', 'Depth'],
    params: [
      p('center.0', 'Center X', -0.5, 2.5, 0.01, 0.62, 'Shell', 1, aspectX('uPnCenter')),
      p('center.1', 'Center Y', -0.5, 1.5, 0.01, 0.52, 'Shell', 1, plainY('uPnCenter')),
      p('radius', 'Radius', 0.01, 1, 0.005, 0.155, 'Shell', 1, { u: 'uPnRadius' }),
      p('thick', 'Shell thickness', 0.001, 0.3, 0.001, 0.034, 'Shell', 2, { u: 'uPnThick' }),
      p('torus', 'Equatorial torus', 0, 3, 0.01, 0.5, 'Shell', 2, { u: 'uPnTorus' }),
      p('sep', 'Species separation', 0, 0.1, 0.0005, 0.007, 'Shell', 3, { u: 'uPnSep' }),
      p('expand', 'Expansion rate', 0, 0.00005, 0.000001, 0.000006, 'Shell', 3, { u: 'uPnExpand' }),
      p('rot', 'Polar rotation', -3.1416, 3.1416, 0.01, 0.55, 'Morphology', 1, { u: 'uPnRot', unit: 'rad' }),
      p('aspect', 'Elongation', 0.05, 4, 0.01, 1.35, 'Morphology', 1, { u: 'uPnAspect' }),
      /* waist 0 reads round, ~0.4 a pinched ring, 0.7+ butterfly lobes */
      p('waist', 'Waist pinch', 0, 0.95, 0.01, 0.42, 'Morphology', 1, { u: 'uPnWaist' }),
      p('pinch', 'Pinch power', 0.05, 8, 0.05, 2.2, 'Morphology', 2, { u: 'uPnPinch' }),
      p('wobble', 'Shell wobble', 0, 1, 0.01, 0.14, 'Morphology', 2, { u: 'uPnWobble' }),
      p('mottle', 'Mottling', 0, 1, 0.01, 0.35, 'Morphology', 2, { u: 'uPnMottle' }),
      p('motFreq', 'Mottle frequency', 0.5, 30, 0.1, 7.0, 'Morphology', 3, { u: 'uPnMotFreq' }),
      p('ring', 'AGB rings', 0, 1, 0.01, 0.4, 'Rings', 2, { u: 'uPnRing' }),
      p('ringFreq', 'Ring frequency', 10, 400, 1, 190, 'Rings', 3, { u: 'uPnRingFreq' }),
      p('ringPhase', 'Ring phase', -3.1416, 3.1416, 0.01, 1.7, 'Rings', 3, { u: 'uPnRingPhase', unit: 'rad' }),
      p('ringFade', 'Ring fade', 0.001, 2, 0.001, 0.45, 'Rings', 3, { u: 'uPnRingFade' }),
      p('striaFreq', 'Striation freq', 0.5, 30, 0.1, 7.0, 'Striations', 3, { u: 'uPnStriaFreq' }),
      p('striaAniso', 'Radial aniso', 0, 3, 0.01, 0.32, 'Striations', 3, { u: 'uPnStriaAniso' }),
      p('striaSharp', 'Ridge sharpness', 0, 8, 0.05, 2.6, 'Striations', 3, { u: 'uPnStriaSharp' }),
      p('striaEro', 'Erosion', 0, 1, 0.01, 0.5, 'Striations', 3, { u: 'uPnStriaEro' }),
      p('cov', 'Coverage', 0.05, 1, 0.01, 0.8, 'Coverage', 2, { u: 'uPnCov' }),
      p('breakup', 'Break-up', 0, 1, 0.01, 0.55, 'Coverage', 2, { u: 'uPnBreakup' }),
      p('halo', 'Halo gain', 0, 1, 0.01, 0.1, 'Halo', 2, { u: 'uPnHalo' }),
      p('haloR', 'Halo radius', 1, 8, 0.05, 3.4, 'Halo', 2, { u: 'uPnHaloR' }),
      p('haloOiii', 'Halo OIII', 0, 2, 0.01, 0.35, 'Halo', 3, { u: 'uPnHaloOiii' }),
      p('fliers', 'Ansae knots', 0, 1, 1, 1, 'FLIERs', 2, { kind: 'bool', structural: true }),
      p('flier', 'Knot gain', 0, 3, 0.01, 0.8, 'FLIERs', 2, { u: 'uPnFlier' }),
      p('flierR', 'Knot radius', 0.5, 3, 0.01, 1.28, 'FLIERs', 3, { u: 'uPnFlierR' }),
      p('flierSize', 'Knot size', 0.001, 0.1, 0.001, 0.016, 'FLIERs', 3, { u: 'uPnFlierSize' }),
      p('flierHa', 'Knot Hα', 0, 2, 0.01, 0.9, 'FLIERs', 3, { u: 'uPnFlierHa' }),
      p('starLum', 'Star luminosity', 0, 4, 0.01, 1.4, 'Central Star', 1, { u: 'uPnStarLum' }),
      p('starSize', 'Star size', 0.0005, 0.05, 0.0005, 0.0045, 'Central Star', 2, { u: 'uPnStarSize' }),
      p('starHalo', 'Star halo', 0, 1, 0.005, 0.07, 'Central Star', 3, { u: 'uPnStarHalo' }),
      p('starTint.0', 'Star R', 0, 1.5, 0.01, 0.86, 'Central Star', 3, { u: 'uPnStarTint', comp: 'x' }),
      p('starTint.1', 'Star G', 0, 1.5, 0.01, 0.9, 'Central Star', 3, { u: 'uPnStarTint', comp: 'y' }),
      p('starTint.2', 'Star B', 0, 1.5, 0.01, 1.0, 'Central Star', 3, { u: 'uPnStarTint', comp: 'z' }),
      p('gain', 'Gain', 0, 2, 0.01, 0.22, 'Species', 1, { u: 'uPnGain' }),
      p('ha', 'Hα strength', 0, 2, 0.01, 0.85, 'Species', 2, { u: 'uPnHa' }),
      p('oiii', 'OIII strength', 0, 2, 0.01, 1.0, 'Species', 2, { u: 'uPnOiii' }),
      p('sii', 'SII strength', 0, 2, 0.01, 0.14, 'Species', 3, { u: 'uPnSii' }),
      p('morphRate', 'Morph rate', 0, 1, 0.01, 0.04, 'Evolution', 2, { u: 'uPnMorph' }),
    ],
  },
];

export const TYPE_BY_ID = Object.fromEntries(ENTITY_TYPES.map((t) => [t.type, t]));

/* The four base layers are always evaluated by sky2d whether or not the scene
   lists them, so Firmament hides them by muting rather than by omission. */
export const BASE_TYPES = ENTITY_TYPES.filter((t) => !t.addable).map((t) => t.type);

export function defaultParams(type) {
  const out = {};
  for (const param of TYPE_BY_ID[type].params) {
    /* A derived control writes other keys and owns none of its own */
    if (!param.derived) setPath(out, param.key, param.def);
  }
  return out;
}

/* Flat-keyed in the spec ("radius.0"), nested in the preset like the engine's
   array-valued DEFAULTS; a non-numeric tail ("look.beam") addresses a flag-bag object instead. */
const isIndex = (tail) => /^\d+$/.test(tail);

export function setPath(obj, key, value) {
  const dot = key.indexOf('.');
  if (dot < 0) { obj[key] = value; return; }
  const head = key.slice(0, dot);
  const tail = key.slice(dot + 1);
  if (isIndex(tail)) {
    if (!Array.isArray(obj[head])) obj[head] = [];
    obj[head][Number(tail)] = value;
    return;
  }
  if (!obj[head] || typeof obj[head] !== 'object' || Array.isArray(obj[head])) obj[head] = {};
  obj[head][tail] = value;
}

export function getPath(obj, key) {
  const dot = key.indexOf('.');
  if (dot < 0) return obj[key];
  const head = obj[key.slice(0, dot)];
  const tail = key.slice(dot + 1);
  if (isIndex(tail)) return Array.isArray(head) ? head[Number(tail)] : undefined;
  return head && typeof head === 'object' ? head[tail] : undefined;
}

/* Decimal places implied by the step, so readouts never show 0.30000000000004 */
export function decimalsFor(step) {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : Math.min(s.length - dot - 1, 6);
}

export function formatValue(param, value) {
  if (param.kind === 'bool') return value ? 'on' : 'off';
  return Number(value).toFixed(decimalsFor(param.step));
}
