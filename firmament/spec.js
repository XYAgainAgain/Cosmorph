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
    rank: 5,
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
    rank: 6,
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
];

export const TYPE_BY_ID = Object.fromEntries(ENTITY_TYPES.map((t) => [t.type, t]));

/* The four base layers are always evaluated by sky2d whether or not the scene
   lists them, so Firmament hides them by muting rather than by omission. */
export const BASE_TYPES = ENTITY_TYPES.filter((t) => !t.addable).map((t) => t.type);

export function defaultParams(type) {
  const out = {};
  for (const param of TYPE_BY_ID[type].params) setPath(out, param.key, param.def);
  return out;
}

/* Params are flat-keyed in the spec ("radius.0") but nested in the preset,
   because the engine's DEFAULTS blocks store vectors as arrays. */
export function setPath(obj, key, value) {
  const dot = key.indexOf('.');
  if (dot < 0) { obj[key] = value; return; }
  const head = key.slice(0, dot);
  const idx = Number(key.slice(dot + 1));
  if (!Array.isArray(obj[head])) obj[head] = [];
  obj[head][idx] = value;
}

export function getPath(obj, key) {
  const dot = key.indexOf('.');
  if (dot < 0) return obj[key];
  const arr = obj[key.slice(0, dot)];
  return Array.isArray(arr) ? arr[Number(key.slice(dot + 1))] : undefined;
}

/* Decimal places implied by the step, so readouts never show 0.30000000000004 */
export function decimalsFor(step) {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : Math.min(s.length - dot - 1, 5);
}

export function formatValue(param, value) {
  if (param.kind === 'bool') return value ? 'on' : 'off';
  return Number(value).toFixed(decimalsFor(param.step));
}
