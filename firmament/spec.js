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
  /* Lensing warps where the scene RTs are read, so it grades the whole sky
     rather than belonging to any one entity. `structural` entries are build
     gates: off, the compose shader is byte-identical to an unlensed build. */
  {
    key: 'lens', label: 'Lensing', kind: 'bool', min: 0, max: 1, step: 1, def: 0,
    group: 'Lensing', tier: 2, structural: true,
  },
  {
    key: 'lensThetaE', label: 'Einstein radius', min: 0, max: 0.5, step: 0.005, def: 0.16,
    group: 'Lensing', tier: 3, u: 'uLensThetaE',
  },
  {
    key: 'lensCore', label: 'Core radius', min: 0.001, max: 0.3, step: 0.001, def: 0.04,
    group: 'Lensing', tier: 3, u: 'uLensCore',
  },
  {
    key: 'lensX', label: 'Lens center X', min: 0, max: 1, step: 0.005, def: 0.5,
    /* Scene params carry no ctx, so the aspect comes off the uniform itself */
    group: 'Lensing', tier: 3, set: (U, v) => { U.uLensAt.value.x = v * U.uAspect.value; },
  },
  {
    key: 'lensY', label: 'Lens center Y', min: 0, max: 1, step: 0.005, def: 0.5,
    group: 'Lensing', tier: 3, set: (U, v) => { U.uLensAt.value.y = v; },
  },
  {
    key: 'lensEllip', label: 'Ellipticity', min: -0.8, max: 0.8, step: 0.01, def: 0.25,
    group: 'Lensing', tier: 3, u: 'uLensEllip',
  },
  {
    key: 'lensAngle', label: 'Lens angle', min: 0, max: 3.14, step: 0.01, def: 0.6,
    group: 'Lensing', tier: 3, u: 'uLensRot',
  },
  {
    key: 'lensPoint', label: 'Point-mass blend', min: 0, max: 1, step: 0.01, def: 0,
    group: 'Lensing', tier: 3, u: 'uLensPoint',
  },
  {
    key: 'lensShear1', label: 'Shear γ₁', min: -0.3, max: 0.3, step: 0.005, def: 0.05,
    group: 'Lensing', tier: 3, set: (U, v) => { U.uLensShear.value.x = v; },
  },
  {
    key: 'lensShear2', label: 'Shear γ₂', min: -0.3, max: 0.3, step: 0.005, def: 0,
    group: 'Lensing', tier: 3, set: (U, v) => { U.uLensShear.value.y = v; },
  },
  {
    key: 'lensHalos', label: 'Sub-halos', min: 0, max: 3, step: 1, def: 0,
    group: 'Lensing', tier: 3, structural: true,
  },
  {
    key: 'lensHaloStr', label: 'Sub-halo strength', min: 0, max: 1, step: 0.01, def: 0.35,
    group: 'Lensing', tier: 3, u: 'uLensHaloStr',
  },
  {
    key: 'lensHaloSpread', label: 'Sub-halo spread', min: 0, max: 0.6, step: 0.005, def: 0.25,
    group: 'Lensing', tier: 3, u: 'uLensHaloSpread',
  },
  {
    key: 'lensMag', label: 'Arc boost', min: 0, max: 1, step: 0.01, def: 0.35,
    group: 'Lensing', tier: 3, u: 'uLensMag',
  },
  {
    /* The three-tap compiles with the warp, so at 0 the taps collapse onto the
       same uv rather than disappearing: 4 fetches either way while lensing is on. */
    key: 'lensSmear', label: 'Arc smear', min: 0, max: 1, step: 0.01, def: 0.5,
    group: 'Lensing', tier: 3, u: 'uLensSmear',
  },
  {
    key: 'lensRingGain', label: 'Ring glow', min: 0, max: 0.4, step: 0.005, def: 0.05,
    group: 'Lensing', tier: 3, u: 'uLensRingGain',
  },
  {
    key: 'lensRingW', label: 'Ring width', min: 0.002, max: 0.08, step: 0.001, def: 0.02,
    group: 'Lensing', tier: 3, u: 'uLensRingW',
  },
  {
    key: 'lensChroma', label: 'Dispersion', min: 0, max: 1, step: 0.01, def: 0.12,
    group: 'Lensing', tier: 3, u: 'uLensChroma',
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

/* radius × elong past ~1.5 cells pushes a cometary tail outside the 3×3 cell
   search; jitter reaches 1.45× radius and clustering scales it by another 1+cluster */
function globElong(radius, elong, cluster) {
  return Math.min(elong, 1.5 / Math.max(radius * 1.45 * (1 + cluster), 1e-3));
}

/* The jet's two shipped silhouettes. `bow` stays on for both: the one feature
   the looks share. `tune` reseats the cap — past the beam tip for HH, hugging
   the star for a runaway. */
export const JET_LOOKS = [
  {
    id: 'hh',
    label: 'Bipolar HH Jet',
    look: { beam: 1, bow: 1, counter: 1, wake: 0 },
    tune: { bowStand: 0.42, bowSpan: 0.12 },
  },
  {
    id: 'runaway',
    label: 'Runaway Bow Shock',
    look: { beam: 0, bow: 1, counter: 0, wake: 1 },
    tune: { bowStand: 0.14, bowSpan: 0.2 },
  },
];

/* The shipped v2 bakes. The id is the sidecar path the loader fetches, which
   makes the pick build-time: a new asset means a new texture and a new graph. */
export const SHAPE_ASSETS = [
  { id: 'assets/shapes/horsehead.json', label: 'Horsehead (Barnard 33)' },
  { id: 'assets/shapes/mystic-mountain.json', label: 'Mystic Mountain' },
  { id: 'assets/shapes/bubble.json', label: 'Bubble' },
  { id: 'assets/shapes/crab.json', label: 'Crab' },
  { id: 'assets/shapes/pillars.json', label: 'Pillars (HST)' },
  { id: 'assets/shapes/pillars-miri.json', label: 'Pillars (MIRI)' },
  { id: 'assets/shapes/test-blob.json', label: 'Test Blob' },
];

/* The showpiece silhouettes. Each is a build-time branch, so a scene only
   compiles the morphology it picked; the flags below are the stored state. */
export const GALAXY_LOOKS = [
  { id: 'spiral', label: 'Grand-Design Spiral', look: { shell: 0, ring: 0, spokes: 0, polar: 0 } },
  { id: 'shell', label: 'Shell Elliptical', look: { shell: 1, ring: 0, spokes: 0, polar: 0 } },
  { id: 'hoag', label: "Hoag's Ring", look: { shell: 0, ring: 1, spokes: 0, polar: 0 } },
  { id: 'cartwheel', label: 'Cartwheel Ring', look: { shell: 0, ring: 1, spokes: 1, polar: 0 } },
  { id: 'polar', label: 'Polar Ring', look: { shell: 0, ring: 1, spokes: 0, polar: 1 } },
];

/* Flattened near/mid/far RGB. Must match Z_RAMPS in engine/shaders/tsl/galaxies.js */
export const Z_RAMPS = [
  { id: 'hubble', label: 'Hubble', stops: [0.72, 0.84, 1.0, 1.0, 0.88, 0.6, 1.0, 0.55, 0.34] },
  { id: 'jwst', label: 'JWST', stops: [0.55, 0.9, 1.0, 0.86, 1.0, 0.9, 1.0, 0.52, 0.3] },
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
      p('spikeThreshold', 'Spike threshold', 0, 2, 0.01, 0.82, 'Optics', 1, { u: 'uSpikeThreshold' }),
      p('spikeAngle', 'Spike angle', 0, 1.5708, 0.005, 0.35, 'Optics', 1, { u: 'uSpikeAngle', unit: 'rad' }),
      /* Nonzero default; the decal rationale lives in stars.js */
      p('spikeJitter', 'Spike angle jitter', 0, 1.5708, 0.005, 0.6, 'Optics', 2, { u: 'uSpikeJitter', unit: 'rad' }),
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
    rank: 4,
    depth: 0.3,
    depthParam: { u: 'uDepthLine', max: 1 },
    mute: { gain: 0 },
    groups: ['Structure', 'Coverage', 'Ionizing Source', 'Ionization Front', 'Species', 'Evolution', 'Depth'],
    params: [
      p('gain', 'Gain', 0, 3, 0.01, 0.42, 'Structure', 1, { u: 'uNebGain' }),
      p('freq', 'Frequency', 0.2, 4, 0.01, 1.35, 'Structure', 1, { u: 'uNebFreq' }),
      p('warp', 'Domain warp', 0, 3, 0.01, 1.3, 'Structure', 1, { u: 'uWarp' }),
      p('mottle', 'Mottling', 0, 3, 0.01, 1.3, 'Structure', 2, { u: 'uMottle' }),
      /* The cavity-wall brightening: this is what puts an order of magnitude
         between an edge-on sheet and the diffuse fill. */
      p('limb', 'Wall brightening', 0, 24, 0.05, 8.0, 'Structure', 1, { u: 'uLimb' }),
      p('limbK', 'Wall sharpness', 0.2, 5, 0.01, 1.6, 'Structure', 3, { u: 'uLimbK' }),
      p('stria', 'Striations', 0, 1, 0.01, 0.22, 'Structure', 2, { u: 'uStria' }),
      /* The y frequency is derived host-side, so both dials have to write it or
         the combing keeps the aspect it was built with. */
      p('striaFreq', 'Striation freq', 0.5, 90, 0.5, 34.0, 'Structure', 3, {
        set: (U, v, ctx) => {
          U.uStriaFreq.value = v;
          U.uStriaFreqY.value = v / Math.max(ctx.params.striaAniso, 1);
        },
      }),
      p('striaAniso', 'Striation aniso', 1, 80, 0.5, 30.0, 'Structure', 3, {
        set: (U, v, ctx) => { U.uStriaFreqY.value = ctx.params.striaFreq / Math.max(v, 1); },
      }),
      p('striaAngle', 'Striation angle', 0, 3.14, 0.01, 0.6, 'Structure', 3, { u: 'uStriaAngle', unit: 'rad' }),
      p('contrast', 'Contrast', 0.2, 3, 0.01, 1.2, 'Structure', 2, { u: 'uNebContrast' }),
      p('covLo', 'Coverage low', 0, 1, 0.01, 0.3, 'Coverage', 2, pairLo('uCovLo', 'uCovHi', 'covHi')),
      p('covHi', 'Coverage high', 0, 1, 0.01, 0.48, 'Coverage', 2, pairHi('uCovHi', 'covLo')),
      /* Without this the ionized cavity keeps landing in a coverage hole */
      p('covIon', 'Source coverage bias', 0, 1, 0.01, 0.35, 'Coverage', 2, { u: 'uCovIon' }),
      p('ionRadius', 'Source radius', 0.05, 2, 0.01, 0.62, 'Ionizing Source', 1, {
        set: (U, v) => { U.uNebIonR2.value = Math.max(v * v, 1e-4); },
      }),
      p('ionSrc.0', 'Source X', -0.5, 2.5, 0.01, 0.74, 'Ionizing Source', 2, aspectX('uNebIonSrc')),
      p('ionSrc.1', 'Source Y', -0.5, 1.5, 0.01, 0.66, 'Ionizing Source', 2, plainY('uNebIonSrc')),
      /* Where on the ionization scalar the glow stops dead against dark cloud */
      p('frontAt', 'Front level', 0, 1, 0.005, 0.3, 'Ionization Front', 1, { u: 'uFrontAt' }),
      p('frontWidth', 'Front width', 0.002, 0.2, 0.001, 0.012, 'Ionization Front', 1, { u: 'uFrontW' }),
      p('frontGain', 'Rim ridge', 0, 3, 0.01, 1.1, 'Ionization Front', 1, { u: 'uFrontGain' }),
      p('frontWobble', 'Front wobble', 0, 12, 0.05, 5.0, 'Ionization Front', 2, { u: 'uFrontWob' }),
      p('frontOiii', 'Rim OIII', 0, 1.5, 0.01, 0.35, 'Ionization Front', 2, { u: 'uFrontOiii' }),
      p('oiii', 'OIII strength', 0, 1.5, 0.01, 0.9, 'Species', 1, { u: 'uOiii' }),
      /* Fully ionized gas is OIII-dominant; without the dip the cavity goes white */
      p('hotHaCut', 'Cavity Hα dip', 0, 1, 0.01, 0.45, 'Species', 2, { u: 'uHotHaCut' }),
      p('sii', 'SII strength', 0, 1, 0.01, 0.12, 'Species', 2, { u: 'uSii' }),
      p('hotLo', 'Hot zone low', 0, 1, 0.01, 0.66, 'Species', 3, pairLo('uHotLo', 'uHotHi', 'hotHi')),
      p('hotHi', 'Hot zone high', 0, 1, 0.01, 0.98, 'Species', 3, pairHi('uHotHi', 'hotLo')),
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
      p('amp', 'Amplitude', 0, 1.5, 0.005, 0.62, 'Structure', 1, { u: 'uIfnAmp' }),
      p('freq', 'Frequency', 0.2, 12, 0.01, 5.0, 'Structure', 1, { u: 'uIfnFreq' }),
      /* 1 is isotropic; above it the wisps comb along the rotated x axis */
      p('aniso', 'Combing', 1, 6, 0.05, 2.0, 'Structure', 2, { u: 'uIfnAniso' }),
      p('rot', 'Comb bearing', -3.1416, 3.1416, 0.01, 0.7, 'Structure', 2, { u: 'uIfnRot', unit: 'rad' }),
      p('gamma', 'Void contrast', 0.5, 4, 0.05, 1.9, 'Structure', 2, { u: 'uIfnGamma' }),
      p('warp', 'Tearing', 0, 5, 0.01, 2.4, 'Structure', 2, { u: 'uIfnWarp' }),
      /* The four below are neutral at 0 and the hero sky leaves them there; swirl
         and grain are build-gated off, so its graph stays byte-identical. */
      p('swirl', 'Swirl', 0, 4, 0.01, 0, 'Structure', 2, { u: 'uIfnSwirl', unit: 'rad', structural: true }),
      p('feather', 'Feathering', 0, 1, 0.01, 0, 'Structure', 2, { u: 'uIfnFeather' }),
      p('soft', 'Edge softness', 0, 1, 0.01, 0, 'Structure', 2, { u: 'uIfnSoft' }),
      p('grain', 'Graininess', 0, 1, 0.005, 0, 'Structure', 3, { u: 'uIfnGrain', structural: true }),
      p('morphRate', 'Morph rate', 0, 1, 0.01, 0.08, 'Evolution', 2, { u: 'uIfnMorph' }),
    ],
  },

  {
    type: 'darkDust',
    label: 'Dark wisps',
    salt: 4,
    rank: 14,
    depth: 0.55,
    depthParam: { u: 'uDepthWisp', max: 1 },
    mute: { tau: 0 },
    groups: ['Extinction', 'Lanes', 'Evolution', 'Depth'],
    params: [
      p('tau', 'Optical depth', 0, 8, 0.01, 3.6, 'Extinction', 1, { u: 'uWispTau' }),
      p('freq', 'Frequency', 0.2, 12, 0.01, 4.6, 'Extinction', 1, { u: 'uWispFreq' }),
      p('threshold', 'Threshold', 0, 1, 0.01, 0.62, 'Extinction', 1, { u: 'uWispTh' }),
      p('softness', 'Edge softness', 0.001, 0.6, 0.001, 0.22, 'Extinction', 2, { u: 'uWispSoft' }),
      /* The warm reddening band; the physics rationale lives in dust.js */
      p('fringe', 'Reddening fringe', 0, 0.5, 0.005, 0.16, 'Extinction', 2, { u: 'uWispFringe' }),
      p('skirt', 'Fringe depth', 0, 1, 0.01, 0.3, 'Extinction', 2, { u: 'uWispSkirt' }),
      p('aniso', 'Lane stretch', 1, 20, 0.1, 6.0, 'Lanes', 1, { u: 'uWispAniso' }),
      p('angle', 'Lane angle', 0, 3.14, 0.01, 0.62, 'Lanes', 1, { u: 'uWispAngle', unit: 'rad' }),
      p('warp', 'Lane sinuosity', 0, 2, 0.01, 0.3, 'Lanes', 1, { u: 'uWispWarp' }),
      p('detail', 'Edge raggedness', 0, 1.5, 0.01, 0.45, 'Lanes', 2, { u: 'uWispDetail' }),
      /* Opt-in break with additive-last: the only way to hole the star field */
      p('occlude', 'Occlude stars', 0, 1, 1, 0, 'Extinction', 2, { kind: 'bool', structural: true }),
      p('morphRate', 'Morph rate', 0, 1, 0.01, 0.18, 'Evolution', 2, { u: 'uWispMorph' }),
    ],
  },

  {
    type: 'globules',
    label: 'Bok globules',
    salt: 5,
    rank: 15,
    depth: 0.6,
    depthParam: { u: 'uDepthGlob', max: 0.95 },
    addable: true,
    mute: { tau: 0, rimGain: 0 },
    groups: ['Shape', 'Erosion', 'Density', 'Ionizing Source', 'Rim Lighting', 'Evolution', 'Depth'],
    params: [
      p('freq', 'Cell frequency', 0.5, 8, 0.01, 2.0, 'Shape', 1, { u: 'uGlobFreq' }),
      p('radius', 'Clump radius', 0.05, 0.6, 0.005, 0.3, 'Shape', 1, {
        set: (U, v, ctx) => {
          U.uGlobRadius.value = v;
          U.uGlobElong.value = globElong(v, ctx.params.elong, ctx.params.cluster);
        },
      }),
      p('fill', 'Fill fraction', 0, 1, 0.01, 0.62, 'Shape', 1, { u: 'uGlobFill' }),
      p('core', 'Opaque core', 0, 0.95, 0.01, 0.24, 'Shape', 2, { u: 'uGlobCore' }),
      /* Above 1 the skirt feathers out; the old flat plateau read as a cutout */
      p('prof', 'Skirt falloff', 0.5, 4, 0.01, 1.3, 'Shape', 1, { u: 'uGlobProf' }),
      p('cluster', 'Clustering', 0, 1, 0.01, 0.55, 'Shape', 1, {
        /* Clustering grows the clump radius, so it moves the tail-reach cap too */
        set: (U, v, ctx) => {
          U.uGlobCluster.value = v;
          U.uGlobElong.value = globElong(ctx.params.radius, ctx.params.elong, v);
        },
      }),
      p('clustFreq', 'Cluster scale', 0.02, 2, 0.01, 0.34, 'Shape', 3, { u: 'uGlobClustFreq' }),
      p('elong', 'Tail elongation', 1, 8, 0.01, 3.4, 'Shape', 2, {
        set: (U, v, ctx) => {
          U.uGlobElong.value = globElong(ctx.params.radius, v, ctx.params.cluster);
        },
      }),
      p('taper', 'Tail taper', 0, 3, 0.01, 0.45, 'Shape', 3, { u: 'uGlobTaper' }),
      p('tailOp', 'Tail opacity', 0, 1, 0.01, 0.7, 'Shape', 2, { u: 'uGlobTailOp' }),
      p('cometary', 'Cometary tails', 0, 1, 1, 1, 'Shape', 2, { kind: 'bool', structural: true }),
      p('detail', 'Detail frequency', 0.5, 6, 0.01, 2.4, 'Erosion', 2, { u: 'uGlobDetail' }),
      p('erode', 'Erosion', 0, 1, 0.01, 0.3, 'Erosion', 2, { u: 'uGlobErode' }),
      p('eroFreq', 'Erosion cells', 1, 12, 0.05, 5.0, 'Erosion', 3, { u: 'uGlobEroFreq' }),
      p('eroFall', 'Erosion falloff', 0.05, 2, 0.01, 0.6, 'Erosion', 3, { u: 'uGlobEroFall' }),
      p('tau', 'Optical depth', 0, 8, 0.01, 3.2, 'Density', 1, { u: 'uGlobTau' }),
      p('threshold', 'Threshold', 0, 1, 0.01, 0.16, 'Density', 2, { u: 'uGlobTh' }),
      /* Wide on purpose: a narrow edge here saturates every clump to one opacity */
      p('softness', 'Edge softness', 0.001, 0.8, 0.001, 0.42, 'Density', 2, { u: 'uGlobSoft' }),
      p('ionRadius', 'Source radius', 0.05, 2, 0.01, 0.9, 'Ionizing Source', 2, {
        set: (U, v) => { U.uGlobIonR2.value = Math.max(v * v, 1e-4); },
      }),
      p('ionSrc.0', 'Source X', -0.5, 2.5, 0.01, 1.05, 'Ionizing Source', 2, aspectX('uGlobIonSrc')),
      p('ionSrc.1', 'Source Y', -0.5, 1.5, 0.01, 0.2, 'Ionizing Source', 2, plainY('uGlobIonSrc')),
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
    rank: 5,
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
      /* Non-zero is what makes an off-frame illuminator (Witch Head) renderable */
      p('ambient', 'Ambient lift', 0, 1, 0.005, 0.08, 'Illumination', 2, { u: 'uReflAmbient' }),
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
      p('dustLo', 'Dust low', 0, 1, 0.01, 0.45, 'Dust', 1, pairLo('uReflDustLo', 'uReflDustHi', 'dustHi')),
      p('dustHi', 'Dust high', 0, 1, 0.01, 0.83, 'Dust', 2, pairHi('uReflDustHi', 'dustLo')),
      p('freq', 'Dust frequency', 0.2, 8, 0.01, 4.2, 'Dust', 2, { u: 'uReflFreq' }),
      p('carve', 'Lit-edge carve', 0, 1, 0.01, 0.3, 'Dust', 3, { u: 'uReflCarve' }),
      p('floor', 'Coverage floor', 0, 1, 0.01, 0.15, 'Dust', 3, { u: 'uReflFloor' }),
      /* 0 restores the symmetric glow ball; asymmetry is the default look */
      p('asym', 'Asymmetry', 0, 1, 0.01, 0.8, 'Dust', 1, { u: 'uReflAsym' }),
      p('asymBite', 'Asymmetry bite', 0, 1, 0.01, 0.42, 'Dust', 2, { u: 'uReflAsymBite' }),
      p('asymAngle', 'Asymmetry angle', -3.1416, 3.1416, 0.01, 0.9, 'Dust', 3, { u: 'uReflAsymAngle', unit: 'rad' }),
      p('asymFreq', 'Asymmetry scale', 0.2, 4, 0.01, 1.1, 'Dust', 3, { u: 'uReflAsymFreq' }),
      p('lane', 'Dust lanes', 0, 1, 0.01, 0.45, 'Dust', 1, { u: 'uReflLane' }),
      p('laneFreq', 'Lane frequency', 0.5, 16, 0.1, 7.0, 'Dust', 2, { u: 'uReflLaneFreq' }),
      p('laneAngle', 'Lane angle', -3.1416, 3.1416, 0.01, 1.65, 'Dust', 3, { u: 'uReflLaneAngle', unit: 'rad' }),
      p('laneTh', 'Lane threshold', 0, 0.99, 0.01, 0.5, 'Dust', 3, { u: 'uReflLaneTh' }),
      p('laneSharp', 'Lane sharpness', 0, 8, 0.01, 3.0, 'Dust', 3, { u: 'uReflLaneSharp' }),
      p('striae', 'Striae relief', 0, 1, 0.01, 0.3, 'Filaments', 1, { u: 'uReflStriae' }),
      p('filAmp', 'Filament gain', 0, 2, 0.01, 0.5, 'Filaments', 2, { u: 'uReflFilAmp' }),
      p('filFreq', 'Comb frequency', 1, 30, 0.1, 11.0, 'Filaments', 2, { u: 'uReflFilFreq' }),
      p('filAngle', 'Comb angle', -3.1416, 3.1416, 0.01, 0.55, 'Filaments', 2, { u: 'uReflFilAngle', unit: 'rad' }),
      /* Below 1 this stretches the comb along one axis; that stretch IS the striae */
      p('filAniso', 'Comb squash', 0.01, 1, 0.005, 0.09, 'Filaments', 3, { u: 'uReflFilAniso' }),
      p('filIn', 'Mask inner', 0.001, 0.5, 0.001, 0.05, 'Filaments', 3, {
        set: (U, v, ctx) => {
          U.uReflFilIn.value = v;
          U.uReflFilOut.value = Math.max(ctx.params.filOut, v + 0.001);
        },
      }),
      p('filOut', 'Mask outer', 0.01, 1.5, 0.005, 0.7, 'Filaments', 3, {
        set: (U, v, ctx) => { U.uReflFilOut.value = Math.max(v, ctx.params.filIn + 0.001); },
      }),
      p('filSharp', 'Ridge sharpness', 0, 8, 0.01, 2.5, 'Filaments', 3, { u: 'uReflFilSharp' }),
      p('filHa', 'Filament Hα', 0, 2, 0.01, 0.35, 'Filaments', 3, { u: 'uReflFilHa' }),
      p('tau', 'Optical depth', 0, 3, 0.01, 0.7, 'Extinction', 2, { u: 'uReflTau' }),
      p('tauSpread', 'Tau spread', 0.1, 12, 0.05, 4.0, 'Extinction', 3, { u: 'uReflTauSpread' }),
      p('morph', 'Morph rate', 0, 1, 0.01, 0.06, 'Evolution', 2, { u: 'uReflMorph' }),
    ],
  },

  {
    type: 'filaments',
    label: 'SNR filaments',
    salt: 7,
    rank: 3,
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
      p('freq', 'Thread frequency', 1, 80, 0.1, 14.0, 'Threads', 2, { u: 'uFilFreq' }),
      p('warp', 'Radial warp', 0, 5, 0.01, 2.2, 'Threads', 2, { u: 'uFilWarp' }),
      p('braid', 'Braiding', 0, 1, 0.01, 0.55, 'Threads', 2, { u: 'uFilBraid' }),
      p('threshold', 'Threshold', 0, 1, 0.01, 0.5, 'Threads', 2, { u: 'uFilTh' }),
      p('fray', 'End feathering', 0, 1.5, 0.01, 0.9, 'Threads', 2, { u: 'uFilFray' }),
      /* Thread aspect: radial frequency over tangential — higher packs the
         threads tighter across the shell */
      p('aniso', 'Radial aniso', 0, 60, 0.05, 12.0, 'Threads', 3, { u: 'uFilAniso' }),
      p('kink', 'Kinking', 0, 3, 0.01, 1.1, 'Threads', 3, { u: 'uFilKink' }),
      /* Must stay a fraction of a thread width or the two species detach into
         separate ropes instead of braiding along one strand */
      p('sep', 'Species offset', 0, 0.02, 0.0001, 0.002, 'Threads', 3, { u: 'uFilSep' }),
      p('sharp', 'Ridge sharpness', 0, 12, 0.01, 3.0, 'Threads', 3, { u: 'uFilSharp' }),
      p('softness', 'Edge softness', 0.001, 1, 0.001, 0.16, 'Threads', 3, { u: 'uFilSoft' }),
      p('frayF', 'Feather frequency', 0.1, 10, 0.05, 2.8, 'Threads', 3, { u: 'uFilFrayF' }),
      p('haze', 'Haze', 0, 1, 0.005, 0.025, 'Haze', 2, { u: 'uFilHaze' }),
      p('hazeW', 'Haze width', 1, 12, 0.05, 2.6, 'Haze', 3, { u: 'uFilHazeW' }),
      p('patch', 'Edge-on patch', 0, 1, 0.01, 0.45, 'Haze', 3, { u: 'uFilPatch' }),
      p('ha', 'Hα strength', 0, 2, 0.01, 1.0, 'Species', 2, { u: 'uFilHa' }),
      p('oiii', 'OIII strength', 0, 2, 0.01, 1.0, 'Species', 2, { u: 'uFilOiii' }),
      p('lace', 'Species lacework', 0, 1, 0.01, 0.72, 'Species', 2, { u: 'uFilLace' }),
      /* How fast the leading species alternates along the shell; too low and the
         whole visible arc comes out one color */
      p('laceF', 'Lacework scale', 0.05, 4, 0.01, 1.8, 'Species', 3, { u: 'uFilLaceF' }),
      p('sii', 'SII strength', 0, 1, 0.01, 0.12, 'Species', 3, { u: 'uFilSii' }),
      p('morphRate', 'Morph rate', 0, 1, 0.01, 0.05, 'Evolution', 2, { u: 'uFilMorph' }),
    ],
  },

  {
    type: 'echo',
    label: 'Light echo',
    salt: 83,
    rank: 6,
    depth: 0.4,
    /* Past 0.58 its tau sits in front of the globules and sky2d warns: the
       compose rim exemption only holds while globules are the nearest tau. */
    depthParam: { u: 'uDepthEcho', max: 0.58 },
    addable: true,
    mute: { lum: 0, tau: 0, ha: 0, starLum: 0 },
    groups: ['Source', 'Flash Cycle', 'Dust Cloud', 'Brightness', 'Tint', 'Species', 'Extinction', 'Depth'],
    params: [
      p('src.0', 'Source X', -0.5, 2.5, 0.01, 0.6, 'Source', 1, aspectX('uEchoSrc')),
      p('src.1', 'Source Y', -0.5, 1.5, 0.01, 0.54, 'Source', 1, plainY('uEchoSrc')),
      p('starLum', 'Star brightness', 0, 6, 0.01, 3.0, 'Source', 1, { u: 'uEchoStarLum' }),
      p('starR', 'Star radius', 0.001, 0.05, 0.0005, 0.005, 'Source', 2, { u: 'uEchoStarR' }),
      p('starHalo', 'Star halo', 0, 0.5, 0.005, 0.2, 'Source', 3, { u: 'uEchoStarHalo' }),
      p('starCol.0', 'Star R', 0, 1.5, 0.01, 1.0, 'Source', 3, { u: 'uEchoStarCol', comp: 'x' }),
      p('starCol.1', 'Star G', 0, 1.5, 0.01, 0.46, 'Source', 3, { u: 'uEchoStarCol', comp: 'y' }),
      p('starCol.2', 'Star B', 0, 1.5, 0.01, 0.3, 'Source', 3, { u: 'uEchoStarCol', comp: 'z' }),
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
      p('shellW', 'Shell width', 0.005, 0.8, 0.005, 0.15, 'Dust Cloud', 1, { u: 'uEchoShellW' }),
      p('shell2', 'Second shell', 0, 1, 0.01, 0.5, 'Dust Cloud', 1, { u: 'uEchoShell2' }),
      p('shell2Off', 'Second shell offset', 0, 1, 0.005, 0.24, 'Dust Cloud', 2, { u: 'uEchoShell2Off' }),
      p('dustXY.0', 'Cloud offset X', -0.6, 0.6, 0.01, 0.09, 'Dust Cloud', 2, { u: 'uEchoDustXY', comp: 'x' }),
      p('dustXY.1', 'Cloud offset Y', -0.6, 0.6, 0.01, -0.06, 'Dust Cloud', 2, { u: 'uEchoDustXY', comp: 'y' }),
      p('dustZ', 'Cloud depth offset', -0.6, 0.6, 0.01, 0.1, 'Dust Cloud', 2, { u: 'uEchoDustZ' }),
      p('th', 'Threshold', 0, 1, 0.01, 0.48, 'Dust Cloud', 2, { u: 'uEchoTh' }),
      /* This cutoff is what bounds the sampled z domain, not decoration */
      p('outer', 'Outer cutoff', 0.1, 1.5, 0.01, 0.9, 'Dust Cloud', 3, { u: 'uEchoOuter' }),
      p('halo', 'Outer halo', 0, 1, 0.01, 0.1, 'Dust Cloud', 3, { u: 'uEchoHalo' }),
      p('freq', 'Frequency', 0.5, 30, 0.1, 10.0, 'Dust Cloud', 2, { u: 'uEchoFreq' }),
      p('zSquash', 'Depth squash', 0.05, 3, 0.01, 0.55, 'Dust Cloud', 3, { u: 'uEchoZSquash' }),
      p('carve', 'Carve', 0, 1, 0.01, 0.45, 'Dust Cloud', 3, { u: 'uEchoCarve' }),
      p('fil', 'Filament relief', 0, 1, 0.01, 0.3, 'Dust Cloud', 2, { u: 'uEchoFil' }),
      p('filFreq', 'Filament frequency', 0.1, 8, 0.05, 2.4, 'Dust Cloud', 3, { u: 'uEchoFilFreq' }),
      p('filSharp', 'Filament sharpness', 0, 8, 0.01, 2.6, 'Dust Cloud', 3, { u: 'uEchoFilSharp' }),
      p('soft', 'Edge softness', 0.001, 0.6, 0.001, 0.2, 'Dust Cloud', 2, { u: 'uEchoSoft' }),
      p('lum', 'Luminosity', 0, 3, 0.01, 0.5, 'Brightness', 1, { u: 'uEchoLum' }),
      p('slab', 'Slab brightening', 0, 1, 0.01, 0.5, 'Brightness', 2, { u: 'uEchoSlab' }),
      p('slabMax', 'Slab cap', 1, 20, 0.1, 3.0, 'Brightness', 3, { u: 'uEchoSlabMax' }),
      /* Which half of the lit annulus is brighter; without it the ring has no
         direction of travel and could be standing still. */
      p('sweep', 'Sweep asymmetry', 0, 1, 0.01, 0.45, 'Brightness', 2, { u: 'uEchoSweep' }),
      p('sweepW', 'Sweep width', 0.01, 1, 0.01, 0.35, 'Brightness', 3, { u: 'uEchoSweepW' }),
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
    rank: 7,
    depth: 0.4,
    depthParam: { u: 'uDepthBeam', max: 0.58 },
    addable: true,
    mute: { lum: 0, tau: 0 },
    groups: ['Beams', 'Illumination', 'Rays', 'Arcs', 'Rungs', 'Torus', 'Evolution', 'Depth'],
    params: [
      p('center.0', 'Center X', -0.5, 2.5, 0.01, 0.5, 'Beams', 1, aspectX('uBeamCenter')),
      p('center.1', 'Center Y', -0.5, 1.5, 0.01, 0.52, 'Beams', 1, plainY('uBeamCenter')),
      p('axis', 'Polar axis', -3.1416, 3.1416, 0.01, 0.55, 'Beams', 1, { u: 'uBeamAxis', unit: 'rad' }),
      /* One angle drives both projection factors: 0 is edge-on, PI/2 face-on */
      p('incl', 'Disk inclination', 0, 1.5708, 0.005, 0.4, 'Beams', 1, {
        unit: 'rad',
        set: (U, v) => {
          const a = Math.min(Math.max(v, 0), Math.PI / 2);
          U.uBeamSinI.value = Math.sin(a);
          U.uBeamCosI.value = Math.cos(a);
        },
      }),
      p('len', 'Beam length', 0.05, 2, 0.01, 0.6, 'Beams', 1, { u: 'uBeamLen' }),
      p('half', 'Cone half-angle', 0.02, 1.45, 0.005, 0.3, 'Beams', 1, { u: 'uBeamHalf', unit: 'rad' }),
      p('throat', 'Throat radius', 0.001, 0.5, 0.001, 0.05, 'Beams', 2, { u: 'uBeamThroat' }),
      p('taper', 'Tip taper', 0, 0.95, 0.01, 0.55, 'Beams', 2, { u: 'uBeamTaper' }),
      p('asym', 'Lobe asymmetry', 0, 0.9, 0.01, 0.22, 'Beams', 2, { u: 'uBeamAsym' }),
      p('wall', 'Wall accent', 0, 1, 0.01, 0.45, 'Beams', 2, { u: 'uBeamWall' }),
      /* This uniform IS the cutoff sharpness; a large value erases the read */
      p('soft', 'Cone edge', 0.001, 0.15, 0.001, 0.035, 'Beams', 3, { u: 'uBeamSoft', unit: 'rad' }),
      p('core', 'Core radius', 0.001, 0.5, 0.001, 0.12, 'Beams', 3, { u: 'uBeamCore' }),
      p('fall', 'Dilution power', 0.05, 5, 0.01, 1.1, 'Beams', 3, { u: 'uBeamFall' }),
      p('wallK', 'Wall power', 0, 8, 0.05, 1.6, 'Beams', 3, { u: 'uBeamWallK' }),
      p('lum', 'Luminosity', 0, 3, 0.01, 1.45, 'Illumination', 1, { u: 'uBeamLum' }),
      p('struct', 'Structure gain', 0, 2, 0.01, 1.0, 'Illumination', 2, { u: 'uBeamStruct' }),
      p('glow', 'Envelope glow', 0, 2, 0.01, 0.35, 'Illumination', 2, { u: 'uBeamGlow' }),
      p('warmAmt', 'Warm core', 0, 1, 0.01, 0.6, 'Illumination', 2, { u: 'uBeamWarmAmt' }),
      p('warmR', 'Warm radius', 0.001, 0.6, 0.001, 0.12, 'Illumination', 3, { u: 'uBeamWarmR' }),
      p('tint.0', 'Tint R', 0, 1.5, 0.01, 1.0, 'Illumination', 3, { u: 'uBeamTint', comp: 'x' }),
      p('tint.1', 'Tint G', 0, 1.5, 0.01, 0.97, 'Illumination', 3, { u: 'uBeamTint', comp: 'y' }),
      p('tint.2', 'Tint B', 0, 1.5, 0.01, 0.9, 'Illumination', 3, { u: 'uBeamTint', comp: 'z' }),
      p('warm.0', 'Warm R', 0, 1.5, 0.01, 1.0, 'Illumination', 3, { u: 'uBeamWarm', comp: 'x' }),
      p('warm.1', 'Warm G', 0, 1.5, 0.01, 0.93, 'Illumination', 3, { u: 'uBeamWarm', comp: 'y' }),
      p('warm.2', 'Warm B', 0, 1.5, 0.01, 0.76, 'Illumination', 3, { u: 'uBeamWarm', comp: 'z' }),
      p('threshold', 'Ray threshold', 0, 1, 0.01, 0.52, 'Rays', 2, { u: 'uBeamTh' }),
      p('rayFreq', 'Ray frequency', 0.5, 60, 0.1, 30.0, 'Rays', 3, { u: 'uBeamRayFreq' }),
      p('rayAniso', 'Ray anisotropy', 0, 3, 0.01, 0.08, 'Rays', 3, { u: 'uBeamRayAniso' }),
      p('raySoft', 'Ray softness', 0.001, 1, 0.001, 0.14, 'Rays', 3, { u: 'uBeamRaySoft' }),
      p('arcs', 'Mass-loss arcs', 0, 1, 1, 1, 'Arcs', 2, { kind: 'bool', structural: true }),
      p('arcAmp', 'Arc amplitude', 0, 0.5, 0.001, 0.2, 'Arcs', 2, { u: 'uBeamArcAmp' }),
      /* 0 keeps the arcs spherical shells, 1 lays them flat in the tilted disk */
      p('arcTilt', 'Arc ellipticity', 0, 1, 0.01, 0.85, 'Arcs', 2, { u: 'uBeamArcTilt' }),
      p('arcR', 'Arc decay radius', 0.01, 1.5, 0.01, 0.12, 'Arcs', 2, { u: 'uBeamArcR' }),
      /* Same 0.0008 dead band as the axis spin: both ride the seamless fold */
      p('arcDrift', 'Arc drift', 0, 0.05, 0.0005, 0.009, 'Arcs', 2, { u: 'uBeamArcDrift' }),
      p('arcFreq', 'Arc frequency', 1, 120, 0.5, 78.0, 'Arcs', 3, { u: 'uBeamArcFreq' }),
      p('arcSharp', 'Arc sharpness', 0, 8, 0.05, 3.0, 'Arcs', 3, { u: 'uBeamArcSharp' }),
      p('arcIn', 'Arc inner radius', 0.001, 0.5, 0.001, 0.06, 'Arcs', 3, { u: 'uBeamArcIn' }),
      p('arcAzimFreq', 'Arc break-up', 0, 20, 0.1, 7.0, 'Arcs', 3, { u: 'uBeamArcAzimFreq' }),
      p('rungs', 'Rung ladder', 0, 1, 1, 0, 'Rungs', 3, { kind: 'bool', structural: true }),
      p('rungAmt', 'Rung amount', 0, 1, 0.01, 0.5, 'Rungs', 3, { u: 'uBeamRungAmt' }),
      p('rungFreq', 'Rung frequency', 1, 120, 0.5, 34.0, 'Rungs', 3, { u: 'uBeamRungFreq' }),
      p('rungSharp', 'Rung sharpness', 0, 8, 0.05, 2.0, 'Rungs', 3, { u: 'uBeamRungSharp' }),
      p('torusR', 'Torus radius', 0.01, 1.5, 0.005, 0.3, 'Torus', 2, { u: 'uBeamTorusR' }),
      p('torusT', 'Torus thickness', 0.001, 0.4, 0.001, 0.05, 'Torus', 2, { u: 'uBeamTorusT' }),
      p('tau', 'Optical depth', 0, 6, 0.01, 3.8, 'Torus', 2, { u: 'uBeamTau' }),
      p('torusFlare', 'Torus flare', 0, 3, 0.01, 0.6, 'Torus', 3, { u: 'uBeamTorusFlare' }),
      p('ansae', 'Ansae deepening', 0, 4, 0.01, 0.8, 'Torus', 3, { u: 'uBeamAnsae' }),
      p('torusFreq', 'Torus frequency', 0.5, 30, 0.1, 7.0, 'Torus', 3, { u: 'uBeamTorusFreq' }),
      p('torusTh', 'Torus threshold', 0, 1, 0.01, 0.42, 'Torus', 3, { u: 'uBeamTorusTh' }),
      p('torusSoft', 'Torus softness', 0.001, 1, 0.001, 0.1, 'Torus', 3, { u: 'uBeamTorusSoft' }),
      p('torusFloor', 'Torus floor', 0, 1, 0.01, 0.6, 'Torus', 3, { u: 'uBeamTorusFloor' }),
      /* Below ~0.0008 rad/h the seamless fold quantizes the spin to a stop */
      p('spin', 'Axis spin', 0, 0.05, 0.0005, 0.003, 'Evolution', 2, { u: 'uBeamSpin' }),
      p('morphRate', 'Morph rate', 0, 1, 0.01, 0.05, 'Evolution', 2, { u: 'uBeamMorph' }),
    ],
  },

  {
    type: 'shadowFan',
    label: 'Shadow fan',
    salt: 89,
    rank: 8,
    depth: 0.42,
    depthParam: { u: 'uDepthFan', max: 0.58 },
    addable: true,
    mute: { lum: 0, tau: 0, starLum: 0 },
    groups: ['Cone', 'Illumination', 'Dust', 'Shadow Bands', 'Evolution', 'Extinction', 'Depth'],
    params: [
      p('apex.0', 'Apex X', -0.5, 2.5, 0.01, 0.74, 'Cone', 1, aspectX('uFanApex')),
      p('apex.1', 'Apex Y', -0.5, 1.5, 0.01, 0.78, 'Cone', 1, plainY('uFanApex')),
      p('angle', 'Bearing', -3.1416, 3.1416, 0.01, -2.15, 'Cone', 1, { u: 'uFanAngle', unit: 'rad' }),
      p('half', 'Half-angle', 0.02, 1.5708, 0.005, 0.34, 'Cone', 1, { u: 'uFanHalf', unit: 'rad' }),
      /* Curl, bulge, and wobble are what keep the silhouette off a ruler */
      p('curl', 'Axis curl', -1.5, 1.5, 0.01, 0.45, 'Cone', 1, { u: 'uFanCurl', unit: 'rad' }),
      p('bulge', 'Mid bulge', 0, 2, 0.01, 0.55, 'Cone', 1, { u: 'uFanBulge' }),
      p('wobble', 'Edge wobble', 0, 0.6, 0.005, 0.16, 'Cone', 2, { u: 'uFanWobble' }),
      p('wobFreq', 'Wobble frequency', 0.2, 12, 0.1, 3.2, 'Cone', 3, { u: 'uFanWobFreq' }),
      p('len', 'Length', 0.01, 2, 0.01, 0.62, 'Cone', 1, { u: 'uFanLen' }),
      p('edge', 'Edge softness', 0.001, 1, 0.001, 0.16, 'Cone', 2, { u: 'uFanEdge', unit: 'rad' }),
      p('fade', 'Tip fade', 0, 0.95, 0.01, 0.45, 'Cone', 2, { u: 'uFanFade' }),
      p('limb', 'Wall limb', 0, 3, 0.01, 0.5, 'Cone', 3, { u: 'uFanLimb' }),
      p('lobe', 'Inner lobe', 0, 4, 0.01, 1.5, 'Illumination', 1, { u: 'uFanLobe' }),
      p('lobeAt', 'Lobe radius', 0, 0.5, 0.005, 0.07, 'Illumination', 2, { u: 'uFanLobeAt' }),
      p('lobeW', 'Lobe width', 0.005, 0.4, 0.005, 0.06, 'Illumination', 3, { u: 'uFanLobeW' }),
      /* R Mon is a bright obvious point at the tip in every reference */
      p('starLum', 'Apex star', 0, 6, 0.01, 1.4, 'Illumination', 1, { u: 'uFanStarLum' }),
      p('starR', 'Star radius', 0.001, 0.05, 0.0005, 0.005, 'Illumination', 2, { u: 'uFanStarR' }),
      p('starHalo', 'Star halo', 0, 0.5, 0.005, 0.06, 'Illumination', 3, { u: 'uFanStarHalo' }),
      p('starCol.0', 'Star R', 0, 1.5, 0.01, 1.0, 'Illumination', 3, { u: 'uFanStarCol', comp: 'x' }),
      p('starCol.1', 'Star G', 0, 1.5, 0.01, 0.94, 'Illumination', 3, { u: 'uFanStarCol', comp: 'y' }),
      p('starCol.2', 'Star B', 0, 1.5, 0.01, 0.86, 'Illumination', 3, { u: 'uFanStarCol', comp: 'z' }),
      p('lum', 'Luminosity', 0, 3, 0.01, 0.85, 'Illumination', 1, { u: 'uFanLum' }),
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
      p('threshold', 'Threshold', 0, 1, 0.01, 0.38, 'Dust', 2, { u: 'uFanTh' }),
      p('floor', 'Body floor', 0, 1, 0.01, 0.42, 'Dust', 2, { u: 'uFanFloor' }),
      p('mottle', 'Mottling', 0, 1, 0.01, 0.45, 'Dust', 2, { u: 'uFanMottle' }),
      p('mottleOn', 'Mottle pass', 0, 1, 1, 1, 'Dust', 3, { kind: 'bool', structural: true }),
      p('freq', 'Frequency', 0.5, 30, 0.1, 9.0, 'Dust', 3, { u: 'uFanFreq' }),
      p('aniso', 'Radial comb', 0, 4, 0.01, 1.0, 'Dust', 3, { u: 'uFanAniso' }),
      p('softness', 'Edge softness', 0.001, 1, 0.001, 0.3, 'Dust', 3, { u: 'uFanSoft' }),
      p('motFreq', 'Mottle frequency', 0.5, 20, 0.1, 9.0, 'Dust', 3, { u: 'uFanMotFreq' }),
      p('shadow', 'Band contrast', 0, 1, 0.01, 0.75, 'Shadow Bands', 1, { u: 'uFanShadow' }),
      p('shadowCount', 'Blocker count', 0, 12, 1, 3, 'Shadow Bands', 2, { structural: true }),
      p('shadowW', 'Band width', 0.001, 0.6, 0.001, 0.2, 'Shadow Bands', 2, { u: 'uFanShadowW', unit: 'rad' }),
      p('bandCurl', 'Band curl', 0, 2, 0.01, 0.6, 'Shadow Bands', 2, { u: 'uFanBandCurl', unit: 'rad' }),
      p('bandWob', 'Band wander', 0, 0.5, 0.005, 0.11, 'Shadow Bands', 3, { u: 'uFanBandWob', unit: 'rad' }),
      p('bandWobFreq', 'Wander frequency', 0.5, 30, 0.1, 9.0, 'Shadow Bands', 3, { u: 'uFanBandWobFreq' }),
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
    rank: 9,
    depth: 0.42,
    depthParam: { u: 'uDepthJet', max: 0.95 },
    addable: true,
    mute: { ha: 0, oiii: 0, sii: 0, starLum: 0 },
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
          for (const key of Object.keys(pick.tune)) setPath(params, key, pick.tune[key]);
        },
      },
      p('look.beam', 'Beam', 0, 1, 1, 1, 'Look', 3, { kind: 'bool', structural: true, refresh: true }),
      p('look.bow', 'Leading bow cap', 0, 1, 1, 1, 'Look', 3, { kind: 'bool', structural: true, refresh: true }),
      p('look.counter', 'Counter cap', 0, 1, 1, 1, 'Look', 3, { kind: 'bool', structural: true, refresh: true }),
      p('look.wake', 'Runaway wake', 0, 1, 1, 0, 'Look', 3, { kind: 'bool', structural: true, refresh: true }),
      p('src.0', 'Source X', -0.5, 2.5, 0.01, 0.58, 'Source', 1, aspectX('uJetSrc')),
      p('src.1', 'Source Y', -0.5, 1.5, 0.01, 0.4, 'Source', 1, plainY('uJetSrc')),
      p('angle', 'Jet angle', -3.1416, 3.1416, 0.01, 0.62, 'Source', 1, { u: 'uJetAngle', unit: 'rad' }),
      p('len', 'Arm length', 0.01, 1.5, 0.005, 0.4, 'Source', 1, { u: 'uJetLen' }),
      p('asym', 'Arm asymmetry', 0.05, 1, 0.01, 0.82, 'Source', 2, { u: 'uJetAsym' }),
      p('gap', 'Birth gap', 0.001, 0.2, 0.001, 0.018, 'Source', 2, { u: 'uJetGap' }),
      p('starLum', 'Star brightness', 0, 6, 0.01, 1.1, 'Source', 1, { u: 'uJetStarLum' }),
      p('starR', 'Star radius', 0.001, 0.05, 0.0005, 0.005, 'Source', 2, { u: 'uJetStarR' }),
      p('starHalo', 'Star halo', 0, 0.5, 0.005, 0.05, 'Source', 3, { u: 'uJetStarHalo' }),
      p('starCol.0', 'Star R', 0, 1.5, 0.01, 1.0, 'Source', 3, { u: 'uJetStarCol', comp: 'x' }),
      p('starCol.1', 'Star G', 0, 1.5, 0.01, 0.82, 'Source', 3, { u: 'uJetStarCol', comp: 'y' }),
      p('starCol.2', 'Star B', 0, 1.5, 0.01, 0.66, 'Source', 3, { u: 'uJetStarCol', comp: 'z' }),
      p('beamGain', 'Beam gain', 0, 3, 0.01, 1.1, 'Beam', 1, { u: 'uJetBeamGain' }),
      p('width', 'Beam width', 0.0005, 0.1, 0.0005, 0.0045, 'Beam', 2, { u: 'uJetWidth' }),
      p('flare', 'Beam flare', 0, 6, 0.01, 1.6, 'Beam', 2, { u: 'uJetFlare' }),
      p('taper', 'Beam taper', 0, 0.95, 0.01, 0.7, 'Beam', 2, { u: 'uJetTaper' }),
      p('precess', 'Precession', 0, 0.2, 0.001, 0.012, 'Beam', 2, { u: 'uJetPrecess' }),
      p('precFreq', 'Precession freq', 0, 30, 0.1, 7.0, 'Beam', 3, { u: 'uJetPrecFreq' }),
      p('precRate', 'Precession rate', 0, 3, 0.01, 0.35, 'Beam', 3, { u: 'uJetPrecRate' }),
      p('beamOiii', 'Beam OIII', 0, 2, 0.01, 0.55, 'Beam', 2, { u: 'uJetBeamOiii' }),
      p('beamSii', 'Beam SII', 0, 2, 0.01, 0.25, 'Beam', 3, { u: 'uJetBeamSii' }),
      p('knotFreq', 'Knot frequency', 0, 60, 0.5, 26.0, 'Knots', 2, { u: 'uJetKnotFreq' }),
      p('drift', 'Knot drift', -20, 20, 0.1, 3.0, 'Knots', 2, { u: 'uJetDrift' }),
      p('knotSharp', 'Knot sharpness', 0, 20, 0.1, 4.0, 'Knots', 3, { u: 'uJetKnotSharp' }),
      p('knotJit', 'Knot jitter', 0, 0.9, 0.01, 0.35, 'Knots', 3, { u: 'uJetKnotJit' }),
      p('knotFloor', 'Inter-knot floor', 0, 1, 0.01, 0.3, 'Knots', 3, { u: 'uJetKnotFloor' }),
      p('knotFade', 'Knot distance fade', 0, 1, 0.01, 0.6, 'Knots', 3, { u: 'uJetKnotFade' }),
      p('threshold', 'Threshold', 0, 1, 0.01, 0.2, 'Texture', 2, { u: 'uJetTh' }),
      /* How much of the envelope the noise may erode; at 1 a thin beam vanishes */
      p('texAmt', 'Erosion depth', 0, 1, 0.01, 0.6, 'Texture', 2, { u: 'uJetTexAmt' }),
      p('texFreq', 'Texture frequency', 0, 60, 0.5, 20.0, 'Texture', 3, { u: 'uJetTexFreq' }),
      p('texAniso', 'Texture anisotropy', 0, 3, 0.01, 0.25, 'Texture', 3, { u: 'uJetTexAniso' }),
      p('softness', 'Edge softness', 0.001, 1, 0.001, 0.45, 'Texture', 3, { u: 'uJetSoft' }),
      p('shockFreq', 'Shock frequency', 0, 60, 0.5, 26.0, 'Texture', 3, { u: 'uJetShockFreq' }),
      p('streak', 'Streaming filaments', 0, 1, 0.01, 0.7, 'Texture', 1, { u: 'uJetStreak' }),
      p('streakFreq', 'Filament frequency', 1, 80, 0.5, 26.0, 'Texture', 2, { u: 'uJetStreakFreq' }),
      p('streakAniso', 'Across-front detail', 0.1, 24, 0.1, 8.0, 'Texture', 3, { u: 'uJetStreakAniso' }),
      p('streakSharp', 'Filament sharpness', 0, 8, 0.01, 2.4, 'Texture', 3, { u: 'uJetStreakSharp' }),
      p('bowGain', 'Bow gain', 0, 2, 0.01, 0.7, 'Bow Shock', 1, { u: 'uJetBowGain' }),
      p('bowStand', 'Standoff', 0, 1.5, 0.005, 0.42, 'Bow Shock', 2, { u: 'uJetBowStand' }),
      p('bowSpan', 'Wing span', 0.001, 1, 0.001, 0.12, 'Bow Shock', 2, { u: 'uJetBowSpan' }),
      p('bowCurv', 'Curvature', 0, 40, 0.1, 11.0, 'Bow Shock', 2, { u: 'uJetBowCurv' }),
      p('bowThick', 'Shell thickness', 0.0005, 0.2, 0.0005, 0.016, 'Bow Shock', 3, { u: 'uJetBowThick' }),
      p('bowSep', 'Strand separation', 0, 0.1, 0.0005, 0.011, 'Bow Shock', 3, { u: 'uJetBowSep' }),
      p('bowFace', 'Facing power', 0, 6, 0.01, 1.4, 'Bow Shock', 3, { u: 'uJetBowFace' }),
      p('bowTh', 'Bow threshold', 0, 1, 0.01, 0.22, 'Bow Shock', 3, { u: 'uJetBowTh' }),
      p('wakeGain', 'Wake gain', 0, 2, 0.01, 0.3, 'Wake', 1, { u: 'uJetWakeGain' }),
      p('wakeLen', 'Wake length', 0.001, 2, 0.001, 0.55, 'Wake', 2, { u: 'uJetWakeLen' }),
      p('wakeW', 'Wake width', 0.001, 0.5, 0.001, 0.04, 'Wake', 2, { u: 'uJetWakeW' }),
      p('wakeFlare', 'Wake flare', 0, 8, 0.05, 1.6, 'Wake', 3, { u: 'uJetWakeFlare' }),
      p('ha', 'Hα strength', 0, 2, 0.01, 0.95, 'Species', 2, { u: 'uJetHa' }),
      p('oiii', 'OIII strength', 0, 2, 0.01, 1.0, 'Species', 2, { u: 'uJetOiii' }),
      p('sii', 'SII strength', 0, 2, 0.01, 0.7, 'Species', 2, { u: 'uJetSii' }),
      p('leadOiii', 'Leading OIII', 0, 2, 0.01, 0.55, 'Species', 3, { u: 'uJetLeadOiii' }),
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
    rank: 10,
    depth: 0.42,
    depthParam: { u: 'uDepthWrb', max: 0.95 },
    addable: true,
    mute: { gain: 0, starLum: 0 },
    groups: ['Shell', 'Bow Shock', 'Completeness', 'Fibers', 'Species', 'Horns', 'Central Star', 'Evolution', 'Depth'],
    params: [
      p('center.0', 'Center X', -0.5, 2.5, 0.01, 0.46, 'Shell', 1, aspectX('uWrbCenter')),
      p('center.1', 'Center Y', -0.5, 1.5, 0.01, 0.52, 'Shell', 1, plainY('uWrbCenter')),
      p('radius', 'Radius', 0.01, 1.5, 0.005, 0.28, 'Shell', 1, { u: 'uWrbRadius' }),
      /* The cauliflower outline: a radius that varies with direction. Past ~0.5
         the lobes pinch off into separate bubbles, which is a look, not a bug. */
      p('lump', 'Lumpiness', 0, 1, 0.01, 0.22, 'Shell', 1, { u: 'uWrbLump' }),
      p('lumpFreq', 'Lump count', 0.2, 8, 0.05, 1.4, 'Shell', 2, { u: 'uWrbLumpFreq' }),
      /* Thins the interior against a limb that is normalized to 1, so the shell
         reads as a transparent bubble rather than a filled disk. */
      p('limbK', 'Interior clarity', 1, 5, 0.01, 2.6, 'Shell', 1, { u: 'uWrbLimbK' }),
      p('ratio', 'OIII shell ratio', 0.15, 0.95, 0.01, 0.9, 'Shell', 2, { u: 'uWrbRatio' }),
      /* Below ~0.05 the chord's sqrt cusp narrows to a crawling one-pixel ring */
      p('thick', 'Hα thickness', 0.02, 0.9, 0.005, 0.2, 'Shell', 2, { u: 'uWrbThick' }),
      p('thickO', 'OIII thickness', 0.02, 0.9, 0.005, 0.38, 'Shell', 2, { u: 'uWrbThickO' }),
      p('expand', 'Expansion rate', 0, 0.0002, 0.000001, 0.000034, 'Shell', 3, { u: 'uWrbExpand' }),
      p('axis', 'Motion axis', -3.1416, 3.1416, 0.01, 0.35, 'Bow Shock', 2, { u: 'uWrbAxis', unit: 'rad' }),
      p('bow', 'Nose flattening', 0, 1.5, 0.01, 0.55, 'Bow Shock', 2, { u: 'uWrbBow' }),
      p('wing', 'Flank flare', 0, 0.8, 0.01, 0.3, 'Bow Shock', 3, { u: 'uWrbWing' }),
      p('comp', 'Completeness', 0, 1, 0.01, 0.8, 'Completeness', 2, { u: 'uWrbComp' }),
      p('gapPhase', 'Gap bearing', -3.1416, 3.1416, 0.01, 2.4, 'Completeness', 2, { u: 'uWrbGapPhase', unit: 'rad' }),
      p('compSoft', 'Gap softness', 0.001, 2, 0.001, 0.5, 'Completeness', 3, { u: 'uWrbCompSoft' }),
      p('compO', 'OIII gap survival', 0, 1, 0.01, 0.4, 'Completeness', 3, { u: 'uWrbCompO' }),
      p('threshold', 'Threshold', 0, 1, 0.01, 0.6, 'Fibers', 2, { u: 'uWrbTh' }),
      p('warp', 'Domain warp', 0, 3, 0.01, 0.85, 'Fibers', 2, { u: 'uWrbWarp' }),
      /* Along-fiber brightness variation; at 0 the ridges read as contour lines */
      p('grain', 'Fiber grain', 0, 1, 0.01, 0.75, 'Fibers', 2, { u: 'uWrbGrain' }),
      /* The diffuse chord under the veins; at 0 the gaps go black (wireframe) */
      p('shell', 'Shell floor', 0, 1.5, 0.01, 0.5, 'Fibers', 2, { u: 'uWrbShell' }),
      /* Past ~60 the fibers alias against the foreshortened limb */
      p('fibFreq', 'Fiber frequency', 0, 60, 0.5, 44.0, 'Fibers', 3, { u: 'uWrbFibFreq' }),
      p('fibAniso', 'Fiber anisotropy', 0, 2, 0.01, 0.55, 'Fibers', 3, { u: 'uWrbFibAniso' }),
      p('fibSharp', 'Ridge sharpness', 0, 8, 0.05, 2.8, 'Fibers', 3, { u: 'uWrbFibSharp' }),
      p('warp2', 'Shear warp', 0, 3, 0.01, 0.9, 'Fibers', 3, { u: 'uWrbWarp2' }),
      p('softness', 'Edge softness', 0.001, 1, 0.001, 0.18, 'Fibers', 3, { u: 'uWrbSoft' }),
      p('patch', 'Patchiness', 0, 1, 0.01, 0.55, 'Fibers', 3, { u: 'uWrbPatch' }),
      p('bleed', 'Species bleed', 0, 1, 0.01, 0.32, 'Fibers', 3, { u: 'uWrbBleed' }),
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
    rank: 11,
    depth: 0.45,
    depthParam: { u: 'uDepthPn', max: 0.95 },
    addable: true,
    mute: { gain: 0, starLum: 0 },
    groups: ['Shell', 'Morphology', 'Rings', 'Striations', 'Coverage', 'Halo', 'FLIERs', 'Central Star', 'Species', 'Evolution', 'Depth'],
    params: [
      p('center.0', 'Center X', -0.5, 2.5, 0.01, 0.62, 'Shell', 1, aspectX('uPnCenter')),
      p('center.1', 'Center Y', -0.5, 1.5, 0.01, 0.52, 'Shell', 1, plainY('uPnCenter')),
      p('radius', 'Radius', 0.01, 1, 0.005, 0.155, 'Shell', 1, { u: 'uPnRadius' }),
      p('cavity', 'Ionized cavity', 0, 2, 0.01, 0.55, 'Shell', 1, { u: 'uPnCavity' }),
      p('thick', 'Shell thickness', 0.001, 0.3, 0.001, 0.05, 'Shell', 2, { u: 'uPnThick' }),
      p('torus', 'Equatorial torus', 0, 3, 0.01, 0.5, 'Shell', 2, { u: 'uPnTorus' }),
      p('sep', 'Species separation', 0, 0.1, 0.0005, 0.007, 'Shell', 3, { u: 'uPnSep' }),
      p('expand', 'Expansion rate', 0, 0.00005, 0.000001, 0.000006, 'Shell', 3, { u: 'uPnExpand' }),
      p('rot', 'Polar rotation', -3.1416, 3.1416, 0.01, 0.55, 'Morphology', 1, { u: 'uPnRot', unit: 'rad' }),
      p('aspect', 'Elongation', 0.05, 4, 0.01, 1.35, 'Morphology', 1, { u: 'uPnAspect' }),
      /* waist 0 reads round, ~0.4 a pinched ring, 0.7+ butterfly lobes */
      p('waist', 'Waist pinch', 0, 0.95, 0.01, 0.6, 'Morphology', 1, { u: 'uPnWaist' }),
      /* Flare opens the lobes into cones; the tip fade is what keeps them open */
      p('flare', 'Lobe flare', 0, 4, 0.01, 1.4, 'Morphology', 1, { u: 'uPnFlare' }),
      p('pinch', 'Pinch power', 0.05, 8, 0.05, 1.7, 'Morphology', 2, { u: 'uPnPinch' }),
      p('tip', 'Tip radius', 0.2, 4, 0.01, 0.95, 'Morphology', 2, { u: 'uPnTip' }),
      p('wobble', 'Shell wobble', 0, 1, 0.01, 0.14, 'Morphology', 2, { u: 'uPnWobble' }),
      p('mottle', 'Mottling', 0, 1, 0.01, 0.6, 'Morphology', 2, { u: 'uPnMottle' }),
      p('tipW', 'Tip dissolve', 1.01, 4, 0.01, 2.6, 'Morphology', 3, { u: 'uPnTipW' }),
      p('motFreq', 'Mottle frequency', 0.5, 30, 0.1, 7.0, 'Morphology', 3, { u: 'uPnMotFreq' }),
      p('ring', 'AGB rings', 0, 1, 0.01, 0.8, 'Rings', 2, { u: 'uPnRing' }),
      p('ringFreq', 'Ring frequency', 10, 400, 1, 150, 'Rings', 3, { u: 'uPnRingFreq' }),
      p('ringPhase', 'Ring phase', -3.1416, 3.1416, 0.01, 1.7, 'Rings', 3, { u: 'uPnRingPhase', unit: 'rad' }),
      p('ringFade', 'Ring fade', 0.001, 2, 0.001, 0.45, 'Rings', 3, { u: 'uPnRingFade' }),
      p('ringSharp', 'Ring sharpness', 0, 8, 0.05, 2.4, 'Rings', 3, { u: 'uPnRingSharp' }),
      /* Inner edge of the ring zone, in shell radii: below the shell they moiré */
      p('ringR', 'Ring inner radius', 1, 4, 0.01, 1.7, 'Rings', 3, { u: 'uPnRingR' }),
      p('striaFreq', 'Striation freq', 0.5, 40, 0.1, 11.0, 'Striations', 3, { u: 'uPnStriaFreq' }),
      p('striaAniso', 'Radial aniso', 0, 3, 0.01, 0.32, 'Striations', 3, { u: 'uPnStriaAniso' }),
      p('striaSharp', 'Ridge sharpness', 0, 8, 0.05, 1.4, 'Striations', 3, { u: 'uPnStriaSharp' }),
      p('striaEro', 'Erosion', 0, 1, 0.01, 0.8, 'Striations', 3, { u: 'uPnStriaEro' }),
      p('cov', 'Coverage', 0.05, 1, 0.01, 0.8, 'Coverage', 2, { u: 'uPnCov' }),
      p('breakup', 'Break-up', 0, 1, 0.01, 0.8, 'Coverage', 2, { u: 'uPnBreakup' }),
      p('halo', 'Halo gain', 0, 1, 0.01, 0.35, 'Halo', 2, { u: 'uPnHalo' }),
      p('haloR', 'Halo radius', 1, 8, 0.05, 4.0, 'Halo', 2, { u: 'uPnHaloR' }),
      p('haloOiii', 'Halo OIII', 0, 2, 0.01, 0.35, 'Halo', 3, { u: 'uPnHaloOiii' }),
      p('fliers', 'Ansae knots', 0, 1, 1, 1, 'FLIERs', 2, { kind: 'bool', structural: true }),
      p('flier', 'Knot gain', 0, 3, 0.01, 0.8, 'FLIERs', 2, { u: 'uPnFlier' }),
      p('flierR', 'Knot radius', 0.5, 4, 0.01, 2.2, 'FLIERs', 3, { u: 'uPnFlierR' }),
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

  {
    type: 'shape',
    label: 'Shape asset',
    salt: 109,
    rank: 12,
    depth: 0.5,
    /* Its tau has to stay behind the globules', which is what compose exempts */
    depthParam: { u: 'uDepthShp', max: 0.58 },
    addable: true,
    mute: { tau: 0, gain: 0 },
    groups: ['Frame', 'Density', 'Erosion', 'Rim Lighting', 'Ionizing Source', 'Glow', 'Evolution', 'Depth'],
    params: [
      {
        key: 'asset',
        label: 'Asset',
        group: 'Frame',
        tier: 1,
        kind: 'enum',
        structural: true,
        /* Which nebula you are editing is a choice, not a parameter: the dice
           reroll its framing and density, never swap the subject out. */
        noRoll: true,
        options: SHAPE_ASSETS,
        def: SHAPE_ASSETS[0].id,
      },
      p('center.0', 'Center X', -0.5, 2.5, 0.005, 0.5, 'Frame', 1, aspectX('uShpCenter')),
      p('center.1', 'Center Y', -0.5, 1.5, 0.005, 0.5, 'Frame', 1, plainY('uShpCenter')),
      /* The frame's extent in sky units. A whole-frame bake has to overhang the
         viewport, so the default is the Horsehead's working framing, not the
         module's test-blob figure; below ~1.9 the frame's own edge shows. */
      p('scale', 'Frame scale', 0.05, 6, 0.005, 2.2, 'Frame', 1, { u: 'uShpScale' }),
      p('rot', 'Rotation', -3.1416, 3.1416, 0.01, 0.0, 'Frame', 1, { u: 'uShpRot', unit: 'rad' }),
      p('feather', 'SDF feather', 0.001, 0.3, 0.001, 0.04, 'Frame', 3, { u: 'uShpFeather' }),
      /* In frame UV, not sky units, so it survives a rescale */
      p('edgeFade', 'Frame edge fade', 0.001, 0.3, 0.001, 0.07, 'Frame', 3, { u: 'uShpEdge' }),
      /* Matches the Horsehead's own suggestedTau (3.73502) on the slider grid, so
         the default asset loads at the density its bake asks for. */
      p('tau', 'Optical depth', 0, 8, 0.005, 3.735, 'Density', 1, { u: 'uShpTau' }),
      p('density', 'Column density', 0, 3, 0.01, 1.0, 'Density', 1, { u: 'uShpDens' }),
      p('veil', 'Eroded floor', 0, 1, 0.01, 0.55, 'Density', 2, { u: 'uShpVeil' }),
      p('core', 'Core opacity', 0, 1, 0.01, 0.25, 'Density', 2, { u: 'uShpCore' }),
      p('threshold', 'Threshold', 0, 1, 0.01, 0.3, 'Density', 2, { u: 'uShpTh' }),
      p('softness', 'Edge softness', 0.001, 0.6, 0.001, 0.1, 'Density', 2, { u: 'uShpSoft' }),
      p('erode', 'Erosion', 0, 1, 0.01, 0.3, 'Erosion', 2, { u: 'uShpErode' }),
      p('freq', 'Noise frequency', 0.2, 20, 0.05, 8.0, 'Erosion', 2, { u: 'uShpFreq' }),
      p('eroFreq', 'Erosion cells', 1, 40, 0.1, 18.0, 'Erosion', 3, { u: 'uShpEroFreq' }),
      p('eroFall', 'Erosion falloff', 0.05, 2, 0.01, 0.6, 'Erosion', 3, { u: 'uShpEroFall' }),
      p('rimGain', 'Rim gain', 0, 8, 0.01, 2.4, 'Rim Lighting', 2, { u: 'uShpRimGain' }),
      p('rimW', 'Rim width', 0.001, 0.2, 0.001, 0.012, 'Rim Lighting', 2, { u: 'uShpRimW' }),
      p('rimAt', 'Rim position', -0.1, 0.2, 0.001, 0.004, 'Rim Lighting', 2, { u: 'uShpRimAt' }),
      p('gain', 'Emission gain', 0, 3, 0.01, 1.0, 'Rim Lighting', 3, { u: 'uShpGain' }),
      p('rimEps', 'Slope epsilon', 0.001, 0.05, 0.001, 0.006, 'Rim Lighting', 3, { u: 'uShpRimEps' }),
      p('rimDens', 'Column feed', 0, 1, 0.01, 0.7, 'Rim Lighting', 3, { u: 'uShpRimDens' }),
      p('rimJit', 'Rim jitter', 0, 0.1, 0.001, 0.008, 'Rim Lighting', 3, { u: 'uShpRimJit' }),
      p('rimKnot', 'Rim beading', 0, 1, 0.01, 0.6, 'Rim Lighting', 3, { u: 'uShpRimKnot' }),
      p('rimKnotFreq', 'Bead frequency', 1, 60, 0.5, 12.0, 'Rim Lighting', 3, { u: 'uShpRimKnotFreq' }),
      /* Zero drops the wide second exp from the built graph, so it rebuilds */
      p('rimHalo', 'Rim halo', 0, 1, 0.01, 0.25, 'Rim Lighting', 3, { structural: true }),
      p('rimFacing', 'Facing falloff', 0.05, 20, 0.05, 0.5, 'Rim Lighting', 3, { u: 'uShpRimFacing' }),
      p('rimOiii', 'Rim OIII', 0, 2, 0.01, 0.5, 'Rim Lighting', 3, { u: 'uShpRimOiii' }),
      p('rimSii', 'Rim SII', 0, 2, 0.01, 0.15, 'Rim Lighting', 3, { u: 'uShpRimSii' }),
      /* Advanced, not Expert: the whole rim look reads off where the source sits */
      p('ionSrc.0', 'Source X', -0.5, 2.5, 0.01, 1.05, 'Ionizing Source', 2, aspectX('uShpIonSrc')),
      p('ionSrc.1', 'Source Y', -0.5, 1.5, 0.01, 0.2, 'Ionizing Source', 2, plainY('uShpIonSrc')),
      p('ionRadius', 'Source radius', 0.05, 3, 0.01, 0.9, 'Ionizing Source', 2, {
        set: (U, v) => { U.uShpIonR2.value = Math.max(v * v, 1e-4); },
      }),
      p('hotLo', 'Hot zone low', 0, 1, 0.01, 0.5, 'Ionizing Source', 2, pairLo('uShpHotLo', 'uShpHotHi', 'hotHi')),
      p('hotHi', 'Hot zone high', 0, 1, 0.01, 0.85, 'Ionizing Source', 2, pairHi('uShpHotHi', 'hotLo')),
      /* Zero drops the whole interior-emission chain, so it rebuilds */
      p('glow', 'Interior glow', 0, 3, 0.01, 0.0, 'Glow', 3, { structural: true }),
      p('glowFall', 'Glow falloff', 0.001, 0.5, 0.001, 0.06, 'Glow', 3, { u: 'uShpGlowFall' }),
      p('oiii', 'Glow OIII', 0, 2, 0.01, 0.35, 'Glow', 3, { u: 'uShpOiii' }),
      p('sii', 'Glow SII', 0, 2, 0.01, 0.1, 'Glow', 3, { u: 'uShpSii' }),
      p('morphRate', 'Morph rate', 0, 1, 0.01, 0.06, 'Evolution', 3, { u: 'uShpMorph' }),
    ],
  },

  {
    type: 'galaxies',
    label: 'Galaxies',
    salt: 120,
    /* Sits just behind IFN, which lands the field at the back of the stack
       without shuffling any other type's default depth. */
    rank: 2,
    depth: 0.13,
    depthParam: { u: 'uDepthGx', max: 0.95 },
    addable: true,
    mute: { gain: 0, fieldLum: 0, hii: 0, flowerGain: 0, starsGain: 0 },
    groups: [
      'Tiers', 'Deep Field', 'Clustering', 'Redshift', 'Showpiece', 'Spiral Arms',
      'Bar', 'Granulation', 'Resolved Stars', 'Sprite Arms', 'Bulge', 'Dust Lane',
      'HII Knots', 'Shells', 'Ring', 'Spokes', 'Polar Ring', 'Evolution', 'Depth',
    ],
    params: [
      p('field', 'Deep-field tier', 0, 1, 1, 1, 'Tiers', 1, { kind: 'bool', structural: true }),
      p('showpiece', 'Showpiece tier', 0, 1, 1, 1, 'Tiers', 1, { kind: 'bool', structural: true }),
      p('fieldLum', 'Field luminosity', 0, 0.4, 0.001, 0.03, 'Deep Field', 1, { u: 'uGxfLum' }),
      p('fieldCells', 'Cell frequency', 1, 40, 0.5, 5.0, 'Deep Field', 1, { u: 'uGxfCells' }),
      p('fieldDensity', 'Occupancy', 0, 1, 0.01, 0.1, 'Deep Field', 1, { u: 'uGxfDensity' }),
      /* In cell units, not sky units: past ~0.45 the 3×3 search clips the disk */
      p('fieldRadius', 'Galaxy radius', 0.01, 0.45, 0.005, 0.13, 'Deep Field', 1, { u: 'uGxfRadius' }),
      p('fieldFlat', 'Edge-on ratio', 0.02, 1, 0.01, 0.16, 'Deep Field', 2, { u: 'uGxfFlat' }),
      p('fieldCoreAmt', 'Core weight', 0, 5, 0.01, 1.1, 'Deep Field', 2, { u: 'uGxfCoreAmt' }),
      p('fieldLaneDepth', 'Lane depth', 0, 1, 0.01, 0.55, 'Deep Field', 2, { u: 'uGxfLaneDepth' }),
      p('fieldCoreFall', 'Core falloff', 0.5, 15, 0.05, 5.5, 'Deep Field', 3, { u: 'uGxfCoreFall' }),
      p('fieldDiskFall', 'Disk falloff', 0.2, 10, 0.05, 2.2, 'Deep Field', 3, { u: 'uGxfDiskFall' }),
      p('fieldCoreR', 'Core tint radius', 0.05, 2, 0.01, 0.55, 'Deep Field', 3, { u: 'uGxfCoreR' }),
      p('fieldFeather', 'Edge feather', 0.05, 2, 0.01, 0.55, 'Deep Field', 3, { u: 'uGxfFeather' }),
      p('fieldLaneAt', 'Lane gate', 0, 1, 0.01, 0.3, 'Deep Field', 3, { u: 'uGxfLaneAt' }),
      p('fieldLaneW', 'Lane width', 0.02, 2, 0.01, 0.42, 'Deep Field', 3, { u: 'uGxfLaneW' }),
      p('fieldCore.0', 'Core R', 0, 1.5, 0.01, 1.0, 'Deep Field', 3, { u: 'uGxfCore', comp: 'x' }),
      p('fieldCore.1', 'Core G', 0, 1.5, 0.01, 0.8, 'Deep Field', 3, { u: 'uGxfCore', comp: 'y' }),
      p('fieldCore.2', 'Core B', 0, 1.5, 0.01, 0.58, 'Deep Field', 3, { u: 'uGxfCore', comp: 'z' }),
      p('fieldDisk.0', 'Disk R', 0, 1.5, 0.01, 0.62, 'Deep Field', 3, { u: 'uGxfDisk', comp: 'x' }),
      p('fieldDisk.1', 'Disk G', 0, 1.5, 0.01, 0.74, 'Deep Field', 3, { u: 'uGxfDisk', comp: 'y' }),
      p('fieldDisk.2', 'Disk B', 0, 1.5, 0.01, 1.0, 'Deep Field', 3, { u: 'uGxfDisk', comp: 'z' }),
      p('cluster', 'Clustering', 0, 1, 0.01, 0, 'Clustering', 1, { u: 'uGxfCluster' }),
      p('clusterPeak', 'Core crowding', 1, 20, 0.1, 6.0, 'Clustering', 2, { u: 'uGxfClusterPeak' }),
      p('clusterR', 'Core radius', 0.05, 2, 0.01, 0.45, 'Clustering', 2, { u: 'uGxfClusterR' }),
      p('clusterAt.0', 'Center X', -0.5, 2.5, 0.01, 0.5, 'Clustering', 2, aspectX('uGxfAt')),
      p('clusterAt.1', 'Center Y', -0.5, 1.5, 0.01, 0.5, 'Clustering', 2, plainY('uGxfAt')),
      {
        key: 'ramp',
        label: 'z → color ramp',
        group: 'Redshift',
        tier: 1,
        kind: 'enum',
        /* Writes ramp.0–8 and stores nothing of its own, so a tuned ramp
           survives in the preset instead of collapsing back to a preset name. */
        derived: true,
        structural: true,
        refresh: true,
        options: Z_RAMPS,
        read: (params) => Z_RAMPS.find(
          (o) => o.stops.every((v, i) => getPath(params, `ramp.${i}`) === v),
        )?.id ?? Z_RAMPS[0].id,
        write: (params, id) => {
          const pick = Z_RAMPS.find((o) => o.id === id) ?? Z_RAMPS[0];
          pick.stops.forEach((v, i) => setPath(params, `ramp.${i}`, v));
        },
      },
      p('zTint', 'Ramp blend', 0, 1, 0.01, 0, 'Redshift', 1, { u: 'uGxfZTint' }),
      p('zLo', 'Nearest z', 0, 8, 0.01, 0.2, 'Redshift', 2, pairLo('uGxfZLo', 'uGxfZHi', 'zHi')),
      p('zHi', 'Farthest z', 0, 12, 0.01, 3.0, 'Redshift', 2, pairHi('uGxfZHi', 'zLo')),
      p('zSize', 'Size dimming', 0, 3, 0.01, 0, 'Redshift', 2, { u: 'uGxfZSize' }),
      p('zDim', 'Surface dimming', 0, 6, 0.01, 0, 'Redshift', 2, { u: 'uGxfZDim' }),
      p('ramp.0', 'Near R', 0, 1.5, 0.01, 0.72, 'Redshift', 3, { u: 'uGxfZNear', comp: 'x' }),
      p('ramp.1', 'Near G', 0, 1.5, 0.01, 0.84, 'Redshift', 3, { u: 'uGxfZNear', comp: 'y' }),
      p('ramp.2', 'Near B', 0, 1.5, 0.01, 1.0, 'Redshift', 3, { u: 'uGxfZNear', comp: 'z' }),
      p('ramp.3', 'Mid R', 0, 1.5, 0.01, 1.0, 'Redshift', 3, { u: 'uGxfZMid', comp: 'x' }),
      p('ramp.4', 'Mid G', 0, 1.5, 0.01, 0.88, 'Redshift', 3, { u: 'uGxfZMid', comp: 'y' }),
      p('ramp.5', 'Mid B', 0, 1.5, 0.01, 0.6, 'Redshift', 3, { u: 'uGxfZMid', comp: 'z' }),
      p('ramp.6', 'Far R', 0, 1.5, 0.01, 1.0, 'Redshift', 3, { u: 'uGxfZFar', comp: 'x' }),
      p('ramp.7', 'Far G', 0, 1.5, 0.01, 0.55, 'Redshift', 3, { u: 'uGxfZFar', comp: 'y' }),
      p('ramp.8', 'Far B', 0, 1.5, 0.01, 0.34, 'Redshift', 3, { u: 'uGxfZFar', comp: 'z' }),
      {
        key: 'look',
        label: 'Morphology',
        group: 'Showpiece',
        tier: 1,
        kind: 'enum',
        derived: true,
        structural: true,
        refresh: true,
        options: GALAXY_LOOKS,
        read: (params) => {
          if (getPath(params, 'look.shell')) return 'shell';
          if (!getPath(params, 'look.ring')) return 'spiral';
          if (getPath(params, 'look.polar')) return 'polar';
          return getPath(params, 'look.spokes') ? 'cartwheel' : 'hoag';
        },
        write: (params, id) => {
          const pick = GALAXY_LOOKS.find((o) => o.id === id) ?? GALAXY_LOOKS[0];
          for (const key of Object.keys(pick.look)) setPath(params, `look.${key}`, pick.look[key]);
        },
      },
      p('look.shell', 'Merger shells', 0, 1, 1, 0, 'Showpiece', 3, { kind: 'bool', structural: true, refresh: true }),
      p('look.ring', 'Detached ring', 0, 1, 1, 0, 'Showpiece', 3, { kind: 'bool', structural: true, refresh: true }),
      p('look.spokes', 'Cartwheel spokes', 0, 1, 1, 0, 'Showpiece', 3, { kind: 'bool', structural: true, refresh: true }),
      p('look.polar', 'Second ring plane', 0, 1, 1, 0, 'Showpiece', 3, { kind: 'bool', structural: true, refresh: true }),
      p('gain', 'Gain', 0, 2, 0.01, 0.17, 'Showpiece', 1, { u: 'uGxGain' }),
      p('center.0', 'Center X', -0.5, 2.5, 0.01, 0.72, 'Showpiece', 1, aspectX('uGxCenter')),
      p('center.1', 'Center Y', -0.5, 1.5, 0.01, 0.34, 'Showpiece', 1, plainY('uGxCenter')),
      p('size', 'Radius', 0.01, 1, 0.005, 0.16, 'Showpiece', 1, { u: 'uGxSize' }),
      p('cosI', 'Inclination', 0.06, 1, 0.01, 0.42, 'Showpiece', 1, { u: 'uGxCosI' }),
      p('pa', 'Position angle', -3.1416, 3.1416, 0.01, 0.55, 'Showpiece', 1, { u: 'uGxPa', unit: 'rad' }),
      p('cutIn', 'Fade start', 0.1, 4, 0.01, 1.15, 'Showpiece', 3, pairLo('uGxCutIn', 'uGxCutOut', 'cutOut')),
      p('cutOut', 'Fade end', 0.1, 6, 0.01, 1.75, 'Showpiece', 3, pairHi('uGxCutOut', 'cutIn')),
      p('armAmt', 'Arm contrast', 0, 1, 0.01, 0.85, 'Spiral Arms', 1, { u: 'uGxArmAmt' }),
      p('wind', 'Winding', 0.2, 12, 0.01, 3.0, 'Spiral Arms', 1, { u: 'uGxWind' }),
      p('armSharp', 'Arm sharpness', 0, 8, 0.01, 1.6, 'Spiral Arms', 2, { u: 'uGxArmSharp' }),
      p('armCount', 'Arm count', 1, 6, 0.05, 2, 'Spiral Arms', 2, { u: 'uGxArmCount' }),
      p('armAsym', 'Lopsidedness', 0, 1, 0.01, 0, 'Spiral Arms', 2, { u: 'uGxArmAsym' }),
      p('diskFall', 'Disk falloff', 0.2, 10, 0.01, 3.2, 'Spiral Arms', 2, { u: 'uGxDiskFall' }),
      p('motAmt', 'Flocculence', 0, 1, 0.01, 0.45, 'Spiral Arms', 2, { u: 'uGxMotAmt' }),
      p('motFreq', 'Mottle frequency', 0.2, 12, 0.01, 3.2, 'Spiral Arms', 3, { u: 'uGxMotFreq' }),
      p('phase', 'Arm phase', -3.1416, 3.1416, 0.01, 0, 'Spiral Arms', 3, { u: 'uGxPhase', unit: 'rad' }),
      /* Zero drops the whole bar chain, so it rebuilds */
      p('barAmt', 'Bar strength', 0, 3, 0.01, 0, 'Bar', 2, { structural: true }),
      /* The bar IS the arm pattern held at this radius, so its length also sets
         where the arms appear to root; it is not a free cosmetic dial. */
      p('barLen', 'Bar length', 0.05, 1.5, 0.005, 0.45, 'Bar', 2, { u: 'uGxBarLen' }),
      p('barSharp', 'Bar sharpness', 0, 12, 0.1, 3.0, 'Bar', 3, { u: 'uGxBarSharp' }),
      p('granBright', 'Star clouds', 0, 2, 0.01, 0.55, 'Granulation', 2, { u: 'uGxGranBright' }),
      /* Past ~0.6 the summed coverage floor pins at its cap and the arms stop
         carving; the cells also degenerate to salt-and-pepper past ~400 on 1080p. */
      p('granDark', 'Dust mottling', 0, 0.6, 0.01, 0.2, 'Granulation', 2, { u: 'uGxGranDark' }),
      p('granFreq', 'Grain frequency', 20, 400, 1, 200, 'Granulation', 2, { u: 'uGxGranFreq' }),
      p('granTh', 'Grain threshold', 0.05, 0.95, 0.01, 0.7, 'Granulation', 3, { u: 'uGxGranTh' }),
      /* Count and the bulge split resample CPU-side, so they rebuild; noRoll
         because the dice tune a population, they never switch the tier on. */
      p('starsN', 'Star count', 0, 24000, 100, 0, 'Resolved Stars', 1, { structural: true, noRoll: true }),
      p('starsGain', 'Star gain', 0, 3, 0.01, 0.42, 'Resolved Stars', 1, { u: 'uGxsGain' }),
      /* Linked, the sprite arms derive pitch, phase, and rotation from the
         glow's Spiral Arms dials; the group collapses to this one row. */
      p('starsLink', 'Link to glow arms', 0, 1, 1, 1, 'Sprite Arms', 1,
        { kind: 'link', structural: true, noRoll: true }),
      /* Tilt per unit semi-major axis: this alone sets the arm pitch, because
         the arms are only where the nested ellipses crowd. */
      p('starsWind', 'Ellipse winding', 0, 12, 0.01, 2.0, 'Sprite Arms', 1, { u: 'uGxsWind' }),
      p('starsBulgeFrac', 'Bulge fraction', 0, 1, 0.01, 0.22, 'Resolved Stars', 2, { structural: true }),
      p('starsAxis', 'Ellipse axis ratio', 0.3, 1, 0.01, 0.68, 'Resolved Stars', 2, { u: 'uGxsAxis' }),
      p('starsSize', 'Star size', 0.3, 4, 0.05, 1.1, 'Resolved Stars', 2, { u: 'uGxsSize' }),
      p('starsZH', 'Scale height', 0.002, 0.3, 0.001, 0.035, 'Resolved Stars', 2, { u: 'uGxsZH' }),
      p('starsLaneTau', 'Far-side extinction', 0, 4, 0.01, 1.2, 'Resolved Stars', 2, { u: 'uGxsLaneTau' }),
      p('starsSpin', 'Orbital rate', 0, 0.05, 0.00001, 0.02, 'Resolved Stars', 2, { u: 'uGxsSpin' }),
      /* 1 is a flat rotation curve; 0 makes the whole disk turn rigidly */
      p('starsRotExp', 'Rotation curve', 0, 2, 0.01, 1.0, 'Resolved Stars', 3, { u: 'uGxsRotExp' }),
      p('bulgeAmt', 'Bulge weight', 0, 6, 0.01, 1.6, 'Bulge', 1, { u: 'uGxBulgeAmt' }),
      p('bulgeR', 'Bulge radius', 0.005, 1, 0.005, 0.16, 'Bulge', 1, { u: 'uGxBulgeR' }),
      p('bulgeBeta', 'Moffat beta', 0.5, 6, 0.01, 1.5, 'Bulge', 2, { u: 'uGxBulgeBeta' }),
      p('tintLo', 'Tint low', 0, 1, 0.01, 0.18, 'Bulge', 3, pairLo('uGxTintLo', 'uGxTintHi', 'tintHi')),
      p('tintHi', 'Tint high', 0, 1, 0.01, 0.62, 'Bulge', 3, pairHi('uGxTintHi', 'tintLo')),
      p('bulge.0', 'Bulge R', 0, 1.5, 0.01, 1.0, 'Bulge', 3, { u: 'uGxBulge', comp: 'x' }),
      p('bulge.1', 'Bulge G', 0, 1.5, 0.01, 0.78, 'Bulge', 3, { u: 'uGxBulge', comp: 'y' }),
      p('bulge.2', 'Bulge B', 0, 1.5, 0.01, 0.5, 'Bulge', 3, { u: 'uGxBulge', comp: 'z' }),
      p('disk.0', 'Disk R', 0, 1.5, 0.01, 0.6, 'Bulge', 3, { u: 'uGxDisk', comp: 'x' }),
      p('disk.1', 'Disk G', 0, 1.5, 0.01, 0.74, 'Bulge', 3, { u: 'uGxDisk', comp: 'y' }),
      p('disk.2', 'Disk B', 0, 1.5, 0.01, 1.0, 'Bulge', 3, { u: 'uGxDisk', comp: 'z' }),
      p('laneDepth', 'Lane depth', 0, 1, 0.01, 0.45, 'Dust Lane', 2, { u: 'uGxLaneDepth' }),
      p('lanePhase', 'Lane lag', -3.1416, 3.1416, 0.01, 0.55, 'Dust Lane', 2, { u: 'uGxLanePhase', unit: 'rad' }),
      p('laneSharp', 'Lane sharpness', 0, 8, 0.01, 2.4, 'Dust Lane', 3, { u: 'uGxLaneSharp' }),
      p('laneFil', 'Filament depth', 0, 1, 0.01, 0.45, 'Dust Lane', 2, { u: 'uGxLaneFil', structural: true }),
      p('laneFilFreq', 'Filament frequency', 0, 24, 0.1, 3.5, 'Dust Lane', 3, { u: 'uGxLaneFilFreq' }),
      p('laneFilAlong', 'Filament winding', 0, 12, 0.1, 1.8, 'Dust Lane', 3, { u: 'uGxLaneFilAlong' }),
      p('laneFilSharp', 'Filament sharpness', 0, 12, 0.1, 4.0, 'Dust Lane', 3, { u: 'uGxLaneFilSharp' }),
      p('laneWob', 'Lane wobble', 0, 2, 0.01, 0, 'Dust Lane', 2, { u: 'uGxLaneWob', unit: 'rad', structural: true }),
      p('spurAmt', 'Spur strength', 0, 1, 0.01, 0, 'Dust Lane', 2, { structural: true }),
      p('spurPhase', 'Spur lead', -3.1416, 3.1416, 0.01, -0.7, 'Dust Lane', 3, { u: 'uGxSpurPhase', unit: 'rad' }),
      p('spurSharp', 'Spur sharpness', 0, 8, 0.01, 1.1, 'Dust Lane', 3, { u: 'uGxSpurSharp' }),
      p('spurFreq', 'Spur frequency', 0, 30, 0.1, 9.0, 'Dust Lane', 3, { u: 'uGxSpurFreq' }),
      p('spurFilSharp', 'Spur ridge sharpness', 0, 12, 0.1, 6.0, 'Dust Lane', 3, { u: 'uGxSpurFilSharp' }),
      p('nearSide', 'Near side', -1, 1, 0.01, 1.0, 'Dust Lane', 3, { u: 'uGxNearSide' }),
      p('nearSoft', 'Near-side softness', 0.01, 2, 0.01, 0.45, 'Dust Lane', 3, { u: 'uGxNearSoft' }),
      p('hii', 'Knot gain', 0, 2, 0.01, 0.3, 'HII Knots', 1, { u: 'uGxHii' }),
      p('hiiTh', 'Knot threshold', 0, 1, 0.01, 0.62, 'HII Knots', 2, { u: 'uGxHiiTh' }),
      p('hiiFreq', 'Knot frequency', 1, 60, 0.5, 24.0, 'HII Knots', 2, { u: 'uGxHiiFreq' }),
      p('hiiOiii', 'Knot OIII', 0, 2, 0.01, 0.25, 'HII Knots', 3, { u: 'uGxHiiOiii' }),
      p('hiiSii', 'Knot SII', 0, 2, 0.01, 0.08, 'HII Knots', 3, { u: 'uGxHiiSii' }),
      p('flowerGain', 'Complex gain', 0, 3, 0.01, 0.9, 'HII Knots', 2, { u: 'uGxFlowerGain' }),
      p('flowerTh', 'Complex threshold', 0, 1, 0.01, 0.78, 'HII Knots', 2, { u: 'uGxFlowerTh' }),
      p('flowerSoft', 'Complex skirt', 0.005, 0.5, 0.005, 0.12, 'HII Knots', 3, { u: 'uGxFlowerSoft' }),
      p('flowerLo', 'Inner cutoff', 0, 2, 0.01, 0.25, 'HII Knots', 3, pairLo('uGxFlowerLo', 'uGxFlowerHi', 'flowerHi')),
      p('flowerHi', 'Outer cutoff', 0, 3, 0.01, 0.7, 'HII Knots', 3, pairHi('uGxFlowerHi', 'flowerLo')),
      p('flowerTint.0', 'Complex Hα', 0, 2, 0.01, 1.0, 'HII Knots', 3, { u: 'uGxFlowerTint', comp: 'x' }),
      p('flowerTint.1', 'Complex OIII', 0, 2, 0.01, 0.24, 'HII Knots', 3, { u: 'uGxFlowerTint', comp: 'y' }),
      p('flowerTint.2', 'Complex SII', 0, 2, 0.01, 0.1, 'HII Knots', 3, { u: 'uGxFlowerTint', comp: 'z' }),
      p('shellAmt', 'Shell amount', 0, 2, 0.01, 0.5, 'Shells', 1, { u: 'uGxShellAmt' }),
      p('shellFreq', 'Shell count', 1, 40, 0.1, 9.0, 'Shells', 1, { u: 'uGxShellFreq' }),
      p('shellSharp', 'Shell sharpness', 0, 40, 0.1, 10.0, 'Shells', 2, { u: 'uGxShellSharp' }),
      p('shellRot', 'Alternation axis', -3.1416, 3.1416, 0.01, 0.4, 'Shells', 2, { u: 'uGxShellRot', unit: 'rad' }),
      /* At 0 the alternation smoothstep collapses and every arc closes into a
         full annulus, which is the one thing shell galaxies never do. */
      p('shellCut', 'Arc taper', 0.005, 1, 0.005, 0.3, 'Shells', 2, { u: 'uGxShellCut' }),
      p('shellFall', 'Shell falloff', 0, 6, 0.01, 1.1, 'Shells', 2, { u: 'uGxShellFall' }),
      p('shellIn', 'Inner cutoff', 0.01, 2, 0.01, 0.35, 'Shells', 3, { u: 'uGxShellIn' }),
      p('shellPhase', 'Shell phase', -3.1416, 3.1416, 0.01, 0, 'Shells', 3, { u: 'uGxShellPhase', unit: 'rad' }),
      p('devRe', 'Effective radius', 0.05, 2, 0.005, 0.55, 'Shells', 3, { u: 'uGxDevRe' }),
      p('devFloor', 'Profile floor', 0.005, 0.3, 0.001, 0.04, 'Shells', 3, {
        /* The r^1/4 law is singular at 0; the floor bounds it and the peak
           normalizer keeps gain meaning the same thing at any floor. */
        set: (U, v) => {
          const f = Math.max(v, 1e-4);
          U.uGxDevFloor.value = f;
          U.uGxDevNorm.value = 1 / Math.exp(-7.669 * (f ** 0.25 - 1));
        },
      }),
      p('shellTint.0', 'Shell R', 0, 1.5, 0.01, 0.78, 'Shells', 3, { u: 'uGxShellTint', comp: 'x' }),
      p('shellTint.1', 'Shell G', 0, 1.5, 0.01, 0.86, 'Shells', 3, { u: 'uGxShellTint', comp: 'y' }),
      p('shellTint.2', 'Shell B', 0, 1.5, 0.01, 1.0, 'Shells', 3, { u: 'uGxShellTint', comp: 'z' }),
      p('ringAmt', 'Ring gain', 0, 3, 0.01, 1.0, 'Ring', 1, { u: 'uGxRingAmt' }),
      p('ringR', 'Ring radius', 0.05, 3, 0.005, 0.78, 'Ring', 1, { u: 'uGxRingR' }),
      p('ringW', 'Ring width', 0.005, 1, 0.005, 0.09, 'Ring', 1, { u: 'uGxRingW' }),
      p('knotAmt', 'Ring beading', 0, 1, 0.01, 0.65, 'Ring', 2, { u: 'uGxKnotAmt' }),
      p('knotFreq', 'Bead frequency', 1, 40, 0.1, 9.0, 'Ring', 2, { u: 'uGxKnotFreq' }),
      p('ring.0', 'Ring R', 0, 1.5, 0.01, 0.55, 'Ring', 3, { u: 'uGxRing', comp: 'x' }),
      p('ring.1', 'Ring G', 0, 1.5, 0.01, 0.78, 'Ring', 3, { u: 'uGxRing', comp: 'y' }),
      p('ring.2', 'Ring B', 0, 1.5, 0.01, 1.0, 'Ring', 3, { u: 'uGxRing', comp: 'z' }),
      p('spokeAmt', 'Spoke gain', 0, 2, 0.01, 0.35, 'Spokes', 1, { u: 'uGxSpokeAmt' }),
      p('spokeFreq', 'Spoke count', 1, 40, 0.1, 7.0, 'Spokes', 2, { u: 'uGxSpokeFreq' }),
      p('spokeTh', 'Spoke threshold', 0, 1, 0.01, 0.52, 'Spokes', 2, { u: 'uGxSpokeTh' }),
      p('spokeIn', 'Hub radius', 0.01, 1.5, 0.005, 0.22, 'Spokes', 3, { u: 'uGxSpokeIn' }),
      p('spokeAniso', 'Radial drift', 0, 3, 0.01, 0.35, 'Spokes', 3, { u: 'uGxSpokeAniso' }),
      p('polarAmt', 'Polar gain', 0, 3, 0.01, 0.8, 'Polar Ring', 1, { u: 'uGxPolarAmt' }),
      p('polarR', 'Polar radius', 0.05, 3, 0.005, 0.8, 'Polar Ring', 1, { u: 'uGxPolarR' }),
      p('polarW', 'Polar width', 0.005, 1, 0.005, 0.09, 'Polar Ring', 2, { u: 'uGxPolarW' }),
      p('polarPa', 'Plane offset', -3.1416, 3.1416, 0.01, 1.5708, 'Polar Ring', 2, { u: 'uGxPolarPa', unit: 'rad' }),
      p('polarCosI', 'Polar inclination', 0.06, 1, 0.01, 0.25, 'Polar Ring', 2, { u: 'uGxPolarCosI' }),
      /* Below ~0.0008 rad/h the 4096 h wrap quantizes the pattern to a stop */
      p('spin', 'Arm rotation', 0, 0.02, 0.000001, 0.001534, 'Evolution', 2, { u: 'uGxSpin' }),
      p('morphRate', 'Morph rate', 0, 1, 0.01, 0.03, 'Evolution', 2, { u: 'uGxMorph' }),
    ],
  },

  {
    type: 'ionCloud',
    label: 'Ionization Cloud',
    salt: 131,
    rank: 13,
    depth: 0.5,
    depthParam: { u: 'uDepthIon', max: 0.95 },
    addable: true,
    mute: { gain: 0 },
    groups: ['Cloud', 'Hole', 'Ionization Cone', 'Lacework', 'Species', 'Evolution', 'Depth'],
    params: [
      p('gain', 'Gain', 0, 3, 0.01, 1.35, 'Cloud', 1, { u: 'uIonGain' }),
      p('center.0', 'Center X', -0.5, 2.5, 0.01, 0.5, 'Cloud', 1, aspectX('uIonCenter')),
      p('center.1', 'Center Y', -0.5, 1.5, 0.01, 0.58, 'Cloud', 1, plainY('uIonCenter')),
      p('size', 'Cloud radius', 0.01, 1, 0.005, 0.18, 'Cloud', 1, { u: 'uIonSize' }),
      p('squash', 'Ellipticity', 0.05, 3, 0.01, 0.8, 'Cloud', 2, { u: 'uIonSquash' }),
      p('rot', 'Rotation', -3.1416, 3.1416, 0.01, -0.35, 'Cloud', 2, { u: 'uIonRot', unit: 'rad' }),
      /* Both are in cloud radii, so resizing never re-tunes the silhouette */
      p('ragged', 'Edge raggedness', 0, 1.5, 0.01, 0.34, 'Cloud', 2, { u: 'uIonRagged' }),
      p('ragFreq', 'Raggedness freq', 0.2, 8, 0.05, 1.9, 'Cloud', 3, { u: 'uIonRagFreq' }),
      p('feather', 'Edge feather', 0.005, 1, 0.005, 0.16, 'Cloud', 3, { u: 'uIonFeather' }),
      p('holeR', 'Hole radius', 0, 1, 0.005, 0.3, 'Hole', 1, { u: 'uIonHoleR' }),
      /* Offsets, not framed positions, so the aspect scale must not reach these */
      p('holeAt.0', 'Hole offset X', -1.5, 1.5, 0.01, -0.14, 'Hole', 2, { u: 'uIonHoleAt', comp: 'x' }),
      p('holeAt.1', 'Hole offset Y', -1.5, 1.5, 0.01, -0.3, 'Hole', 2, { u: 'uIonHoleAt', comp: 'y' }),
      p('holeSoft', 'Hole edge', 0.0001, 0.1, 0.0001, 0.006, 'Hole', 3, { u: 'uIonHoleSoft' }),
      /* Where the cone is thrown from, which need not be any illuminator in the
         scene: an echo cone arrives from where the source was, not where it is. */
      p('apex.0', 'Apex X', -0.5, 2.5, 0.01, 0.62, 'Ionization Cone', 1, aspectX('uIonApex')),
      p('apex.1', 'Apex Y', -0.5, 1.5, 0.01, 0.18, 'Ionization Cone', 1, plainY('uIonApex')),
      p('cone', 'Cone bearing', -3.1416, 3.1416, 0.01, 2.04, 'Ionization Cone', 1, { u: 'uIonCone', unit: 'rad' }),
      p('half', 'Cone half-angle', 0.02, 1.5, 0.005, 0.3, 'Ionization Cone', 1, { u: 'uIonHalf', unit: 'rad' }),
      p('litR', 'Flux radius', 0.01, 2, 0.01, 0.34, 'Ionization Cone', 2, { u: 'uIonLitR' }),
      /* This uniform IS the cone's sharpness; a large value erases the read */
      p('coneSoft', 'Cone edge', 0.001, 0.3, 0.001, 0.045, 'Ionization Cone', 3, { u: 'uIonConeSoft', unit: 'rad' }),
      p('fall', 'Flux falloff', 0, 5, 0.01, 1.3, 'Ionization Cone', 3, { u: 'uIonFall' }),
      p('threshold', 'Threshold', 0, 1, 0.01, 0.55, 'Lacework', 2, { u: 'uIonTh' }),
      p('freq', 'Lace frequency', 0.5, 40, 0.1, 13.0, 'Lacework', 2, { u: 'uIonFreq' }),
      p('clump', 'Knot break-up', 0, 1, 0.01, 0.5, 'Lacework', 2, { u: 'uIonClump' }),
      p('shade', 'Patch shading', 0, 1, 0.01, 0.7, 'Lacework', 2, { u: 'uIonShade' }),
      p('glow', 'Inter-knot glow', 0, 1, 0.005, 0.05, 'Lacework', 2, { u: 'uIonGlow' }),
      p('blob', 'Lyman-alpha blob', 0, 1, 1, 0, 'Lacework', 2, { kind: 'bool', structural: true }),
      p('sharp', 'Ridge sharpness', 0, 8, 0.01, 2.2, 'Lacework', 3, { u: 'uIonSharp' }),
      p('softness', 'Edge softness', 0.001, 1, 0.001, 0.36, 'Lacework', 3, { u: 'uIonSoft' }),
      p('clumpFreq', 'Break-up freq', 0.2, 12, 0.05, 3.0, 'Lacework', 3, { u: 'uIonClumpFreq' }),
      p('oiii', 'OIII strength', 0, 2, 0.01, 1.0, 'Species', 1, { u: 'uIonOiii' }),
      p('ha', 'Knot Hα', 0, 2, 0.01, 0.16, 'Species', 2, { u: 'uIonHa' }),
      p('sii', 'SII strength', 0, 2, 0.01, 0.0, 'Species', 3, { u: 'uIonSii' }),
      p('morphRate', 'Morph rate', 0, 1, 0.01, 0.03, 'Evolution', 2, { u: 'uIonMorph' }),
    ],
  },

  /* Half-step ranks: these two slot between types whose integers are already
     taken, and normalizeOrder replaces every order with a dense index anyway. */
  {
    type: 'starcloud',
    label: 'Milky Way band',
    salt: 71,
    rank: 0.5,
    depth: 0.1,
    /* The rift is extinction, so the same depth ceiling the other tau layers
       take: past 0.6 it would sit in front of globules and break the rim exemption. */
    /* Compose takes one exp over the summed tau, so the rift dims every layer
       whatever depth it sits at; band amplitude is the lever, not this. */
    depthParam: { u: 'uDepthSC', max: 0.58 },
    /* One per scene in the engine, but addable rather than base: a fresh sky is
       the hero's four layers, and forcing a band into it would change every scene. */
    addable: true,
    mute: { gain: 0, riftTau: 0 },
    groups: ['Band', 'Mottling', 'Great Rift', 'Evolution', 'Depth'],
    params: [
      /* Deep-background gain: the band is a luminosity gradient under the compose
         stretch, and overshooting clips it flat rather than making it brighter. */
      p('gain', 'Band gain', 0, 0.4, 0.001, 0.02, 'Band', 1, { u: 'uSCGain' }),
      p('width', 'Band width', 0.02, 1.5, 0.005, 0.25, 'Band', 1, { u: 'uSCWidth' }),
      /* The band line itself is the stars entity's Band offset and Band tilt:
         one galactic plane, one pair of dials. */
      p('falloff', 'Edge falloff', 0.05, 6, 0.01, 1.6, 'Band', 2, { u: 'uSCFalloff' }),
      p('wing', 'Outer wing', 0, 2, 0.01, 0.12, 'Band', 2, { u: 'uSCWing' }),
      p('wingScale', 'Wing width', 1, 8, 0.05, 2.6, 'Band', 3, { u: 'uSCWingScale' }),
      p('tint.0', 'Tint R', 0, 1.5, 0.01, 1.0, 'Band', 3, { u: 'uSCTint', comp: 'x' }),
      p('tint.1', 'Tint G', 0, 1.5, 0.01, 0.93, 'Band', 3, { u: 'uSCTint', comp: 'y' }),
      p('tint.2', 'Tint B', 0, 1.5, 0.01, 0.8, 'Band', 3, { u: 'uSCTint', comp: 'z' }),
      /* All three gate whole fbm chains out of the graph at 0, so they rebuild
         rather than poke; the rift's eight compose-pass octaves are the big one. */
      p('patch', 'Star clouds', 0, 2, 0.01, 0.45, 'Mottling', 1, { u: 'uSCPatch', structural: true }),
      p('grain', 'Graininess', 0, 2, 0.01, 0.55, 'Mottling', 1, { u: 'uSCGrain', structural: true }),
      p('patchFreq', 'Cloud scale', 0.2, 20, 0.05, 3.4, 'Mottling', 2, { u: 'uSCPatchFreq' }),
      p('patchTh', 'Cloud threshold', 0, 1, 0.01, 0.52, 'Mottling', 2, { u: 'uSCPatchTh' }),
      p('grainFreq', 'Grain frequency', 1, 80, 0.5, 22.0, 'Mottling', 2, { u: 'uSCGrainFreq' }),
      p('patchSoft', 'Cloud edge', 0.001, 1, 0.001, 0.3, 'Mottling', 3, { u: 'uSCPatchSoft' }),
      p('riftTau', 'Optical depth', 0, 8, 0.01, 1.6, 'Great Rift', 1, { u: 'uRiftTau', structural: true }),
      p('riftW', 'Rift width', 0.005, 0.8, 0.005, 0.12, 'Great Rift', 1, { u: 'uRiftW' }),
      p('riftCenter', 'Rift offset', -0.5, 0.5, 0.005, 0.03, 'Great Rift', 1, { u: 'uRiftCenter' }),
      p('riftTh', 'Threshold', 0, 1, 0.01, 0.36, 'Great Rift', 2, { u: 'uRiftTh' }),
      p('riftSoft', 'Edge softness', 0.001, 0.6, 0.001, 0.16, 'Great Rift', 2, { u: 'uRiftSoft' }),
      /* A straight lane reads as a drawn stripe however the interior is textured */
      p('riftWander', 'Meander', 0, 0.6, 0.005, 0.12, 'Great Rift', 2, { u: 'uRiftWander' }),
      p('riftFreq', 'Lane frequency', 0.2, 20, 0.05, 4.2, 'Great Rift', 2, { u: 'uRiftFreq' }),
      p('riftWanderFreq', 'Meander scale', 0.1, 8, 0.05, 1.4, 'Great Rift', 3, { u: 'uRiftWanderFreq' }),
      /* Below 1 the domain compresses along the band, which is the braiding */
      p('riftAniso', 'Lane stretch', 0.02, 2, 0.01, 0.28, 'Great Rift', 3, { u: 'uRiftAniso' }),
      p('morphRate', 'Band morph', 0, 1, 0.01, 0.04, 'Evolution', 2, { u: 'uSCMorph' }),
      p('riftMorph', 'Rift morph', 0, 1, 0.01, 0.04, 'Evolution', 3, { u: 'uRiftMorph' }),
    ],
  },

  {
    type: 'clusters',
    label: 'Star cluster',
    salt: 61,
    rank: 2.5,
    depth: 0.2,
    depthParam: { u: 'uDepthClu', max: 0.95 },
    addable: true,
    /* Members carry their own gain, so muting the fused glow alone would leave
       the whole field of resolved points behind. */
    mute: { lum: 0, memGain: 0 },
    groups: ['Profile', 'Members', 'Depth'],
    params: [
      p('lum', 'Core glow', 0, 8, 0.01, 2.4, 'Profile', 1, { u: 'uCluLum' }),
      p('center.0', 'Center X', -0.5, 2.5, 0.01, 0.72, 'Profile', 1, aspectX('uCluCenter')),
      p('center.1', 'Center Y', -0.5, 1.5, 0.01, 0.62, 'Profile', 1, plainY('uCluCenter')),
      p('core', 'Core radius', 0.002, 0.3, 0.001, 0.018, 'Profile', 1, { u: 'uCluCore' }),
      p('tidal', 'Tidal radius', 0.01, 1, 0.005, 0.13, 'Profile', 1, { u: 'uCluTidal' }),
      p('squash', 'Ellipticity', 0.05, 3, 0.01, 0.94, 'Profile', 2, { u: 'uCluSquash' }),
      p('rot', 'Rotation', -3.1416, 3.1416, 0.01, 0.4, 'Profile', 2, { u: 'uCluRot', unit: 'rad' }),
      /* King truncates to exactly zero at the tidal radius; this wing is what
         keeps the cluster from ending on a visible circle. */
      p('halo', 'Outer halo', 0, 2, 0.01, 0.1, 'Profile', 2, { u: 'uCluHalo' }),
      p('haloR', 'Halo radius', 0.005, 1, 0.005, 0.075, 'Profile', 3, { u: 'uCluHaloR' }),
      p('tint.0', 'Glow R', 0, 1.5, 0.01, 1.0, 'Profile', 3, { u: 'uCluTint', comp: 'x' }),
      p('tint.1', 'Glow G', 0, 1.5, 0.01, 0.86, 'Profile', 3, { u: 'uCluTint', comp: 'y' }),
      p('tint.2', 'Glow B', 0, 1.5, 0.01, 0.62, 'Profile', 3, { u: 'uCluTint', comp: 'z' }),
      p('memGain', 'Member gain', 0, 6, 0.01, 1.8, 'Members', 1, { u: 'uCluMemGain' }),
      /* pxPerUnit / (4 × sprite radius), where the shader clamps that radius up
         to 0.7 px: below memSize 0.56 the floor, not memSize, sets the cap. */
      p('cells', 'Member cells', 4, 400, 1, 190, 'Members', 1, {
        set: (U, v, ctx) => {
          U.uCluCells.value = Math.min(
            v, U.uPxPerUnit.value / Math.max(5 * ctx.params.memSize, 2.8));
        },
      }),
      p('rich', 'Richness', 0, 4, 0.01, 1.0, 'Members', 1, { u: 'uCluRich' }),
      p('memSize', 'Member size', 0.05, 3, 0.01, 0.85, 'Members', 2, {
        set: (U, v, ctx) => {
          U.uCluMemSize.value = v;
          U.uCluCells.value = Math.min(
            ctx.params.cells, U.uPxPerUnit.value / Math.max(5 * v, 2.8));
        },
      }),
      /* Inside this radius the crowding is total, so points would read as sprite
         pileup on top of the fused core rather than as stars. */
      p('resolve', 'Fusion radius', 0, 0.3, 0.001, 0.032, 'Members', 2, { u: 'uCluResolve' }),
      p('memFall', 'Density falloff', 0.05, 3, 0.01, 0.55, 'Members', 2, { u: 'uCluMemFall' }),
      p('memMix', 'Second population', 0, 1, 0.01, 0.14, 'Members', 2, { u: 'uCluMemMix' }),
      p('clump', 'Clumping', 0, 1, 0.01, 0, 'Members', 2, { u: 'uCluClump', structural: true }),
      p('clumpFreq', 'Clump scale', 1, 80, 0.5, 30.0, 'Members', 3, { u: 'uCluClumpFreq' }),
      p('memTint.0', 'Member R', 0, 1.5, 0.01, 1.0, 'Members', 3, { u: 'uCluMemTint', comp: 'x' }),
      p('memTint.1', 'Member G', 0, 1.5, 0.01, 0.88, 'Members', 3, { u: 'uCluMemTint', comp: 'y' }),
      p('memTint.2', 'Member B', 0, 1.5, 0.01, 0.7, 'Members', 3, { u: 'uCluMemTint', comp: 'z' }),
      p('memTint2.0', 'Second pop R', 0, 1.5, 0.01, 0.74, 'Members', 3, { u: 'uCluMemTint2', comp: 'x' }),
      p('memTint2.1', 'Second pop G', 0, 1.5, 0.01, 0.82, 'Members', 3, { u: 'uCluMemTint2', comp: 'y' }),
      p('memTint2.2', 'Second pop B', 0, 1.5, 0.01, 1.0, 'Members', 3, { u: 'uCluMemTint2', comp: 'z' }),
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

/* Which boolean gates a group's dials answer to, keyed entity type → group.
   A value is one param key or a list that must all hold; a leading "!" inverts.
   Every entry mirrors a real build gate in the shader, so a group listed here
   genuinely renders nothing while its gate is off. "scene" holds SCENE_PARAMS.
   The studio only enforces a gate whose own control the current tier exposes,
   so a hidden row always has a visible checkbox that brings it back. */
export const GROUP_GATES = {
  scene: { Lensing: 'lens' },
  searchlight: { Arcs: 'arcs', Rungs: 'rungs' },
  wrbubble: { Horns: 'horns' },
  planetary: { FLIERs: 'fliers' },
  jets: { Beam: 'look.beam', 'Bow Shock': 'look.bow', Wake: 'look.wake' },
  galaxies: {
    'Deep Field': 'field',
    Clustering: 'field',
    Redshift: 'field',
    Showpiece: 'showpiece',
    Bulge: 'showpiece',
    'HII Knots': 'showpiece',
    /* showpieceGalaxy branches ring first, then shell, else spiral */
    'Spiral Arms': ['showpiece', '!look.ring', '!look.shell'],
    Bar: ['showpiece', '!look.ring', '!look.shell'],
    Granulation: ['showpiece', '!look.ring', '!look.shell'],
    'Resolved Stars': ['showpiece', '!look.ring', '!look.shell'],
    'Sprite Arms': ['showpiece', '!look.ring', '!look.shell', '!starsLink'],
    'Dust Lane': ['showpiece', '!look.ring', '!look.shell'],
    Shells: ['showpiece', '!look.ring', 'look.shell'],
    Ring: ['showpiece', 'look.ring'],
    Spokes: ['showpiece', 'look.ring', 'look.spokes'],
    'Polar Ring': ['showpiece', 'look.ring', 'look.polar'],
  },
};
