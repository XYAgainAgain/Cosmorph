/* Integer-hash (PCG) noise: bit-identical on WebGPU, WebGL2, and GLES 3.0.
   Seeds become CPU-chosen integer domain offsets, never hash perturbation. */

import {
  Fn, float, vec2, vec3, uint, uvec3, fract, floor, dot, mix, mul,
} from 'three/tsl';

/* pcg3d (Jarzynski & Olano) — the workhorse integer hash */
export const pcg3d = /*@__PURE__*/ Fn(([vIn]) => {
  const v = vIn.toVar();
  v.assign(v.mul(uint(1664525)).add(uint(1013904223)));
  v.x.addAssign(v.y.mul(v.z));
  v.y.addAssign(v.z.mul(v.x));
  v.z.addAssign(v.x.mul(v.y));
  /* WGSL rejects vecN >> scalar; the shift amount must be a matching vector */
  v.assign(v.bitXor(v.shiftRight(uvec3(uint(16), uint(16), uint(16)))));
  v.x.addAssign(v.y.mul(v.z));
  v.y.addAssign(v.z.mul(v.x));
  v.z.addAssign(v.x.mul(v.y));
  return v;
});

/* Lattice point → three floats in [0,1). +1024 keeps practical domains
   positive before the uint conversion, so WGSL and GLSL agree. */
export const hash3 = /*@__PURE__*/ Fn(([ip]) => {
  const q = ip.add(vec3(1024.0));
  const h = pcg3d(uvec3(uint(q.x), uint(q.y), uint(q.z)));
  return vec3(h.x.toFloat(), h.y.toFloat(), h.z.toFloat()).mul(2.3283064365386963e-10);
});

/* Single-lane PCG for scalar lattice values — a third of the hash work of
   pcg3d when only one channel is consumed */
export const hash1 = /*@__PURE__*/ Fn(([ip]) => {
  const q = ip.add(vec3(1024.0));
  const n = uint(q.x).add(uint(q.y).mul(uint(198491317))).add(uint(q.z).mul(uint(6542989)));
  const s = n.mul(uint(747796405)).add(uint(2891336453));
  const w = s.shiftRight(s.shiftRight(uint(28)).add(uint(4))).bitXor(s).mul(uint(277803737));
  return w.shiftRight(uint(22)).bitXor(w).toFloat().mul(2.3283064365386963e-10);
});

/* 3D value noise in [0,1] — trilinear blend of hashed lattice values */
export const valueNoise3 = /*@__PURE__*/ Fn(([p]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2.0).add(3.0));

  const n000 = hash1(i);
  const n100 = hash1(i.add(vec3(1, 0, 0)));
  const n010 = hash1(i.add(vec3(0, 1, 0)));
  const n110 = hash1(i.add(vec3(1, 1, 0)));
  const n001 = hash1(i.add(vec3(0, 0, 1)));
  const n101 = hash1(i.add(vec3(1, 0, 1)));
  const n011 = hash1(i.add(vec3(0, 1, 1)));
  const n111 = hash1(i.add(vec3(1, 1, 1)));

  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z,
  );
});

/* JS-unrolled octave count, no runtime loop. Gain 0.5 suits gas. */
export function makeFbm3(octaves) {
  return Fn(([pIn]) => {
    const p = pIn.toVar();
    const sum = float(0).toVar();
    const amp = float(0.5).toVar();
    for (let o = 0; o < octaves; o++) {
      sum.addAssign(valueNoise3(p).mul(amp));
      p.mulAssign(2.02);
      amp.mulAssign(0.5);
    }
    return sum;
  });
}

export const fbm3o2 = /*@__PURE__*/ makeFbm3(2);
export const fbm3o4 = /*@__PURE__*/ makeFbm3(4);
export const fbm3o5 = /*@__PURE__*/ makeFbm3(5);

/* Octave amplitude sums, for rescaling raw fbm to [0,1]; the 2-octave mean */
export const FBM2_NORM = 1 / 0.75;
export const FBM4_NORM = 1 / 0.9375;
export const FBM5_NORM = 1 / 0.96875;
export const FBM2_MID = 0.375;

/* Domain bias for cell grids centered on a point: indices go negative and
   outrun hash3's internal +1024, wrapping the uint cast. Grids add this first. */
export const CELL_BIAS = 65536.0;

/* Ridged noise in [0,1]: 1 - |2n-1| turns mid-level iso-contours into thin
   crests, so n must be normalized or the crest misses the fbm's mean. */
export function makeRidged(octaves) {
  /* Reuse the shared fbm instances or the shader emits duplicate fbm bodies */
  const shared = { 2: fbm3o2, 4: fbm3o4, 5: fbm3o5 };
  const fbm = shared[octaves] ?? makeFbm3(octaves);
  let norm = 0;
  for (let k = 1; k <= octaves; k++) norm += 0.5 ** k;
  const inv = 1 / norm;
  return Fn(([p, sharp]) => {
    const n = fbm(p).mul(inv);
    const r = float(1).sub(n.mul(2.0).sub(1.0).abs());
    return r.max(1e-4).pow(sharp.max(0.0));
  });
}

/* Shared instances: one ridge wrapper body in the generated shader, however
   many modules ride it. makeRidged stays exported for odd octave counts. */
export const ridged2 = /*@__PURE__*/ makeRidged(2);
export const ridged4 = /*@__PURE__*/ makeRidged(4);

/* Jimenez interleaved gradient noise. Takes pixel coordinates, never uv. */
export const ign = /*@__PURE__*/ Fn(([px]) => {
  return fract(mul(52.9829189, fract(dot(px, vec2(0.06711056, 0.00583715)))));
});

/* asinh(x) = ln(x + sqrt(x² + 1)), componentwise; not a shader builtin */
export const asinh3 = /*@__PURE__*/ Fn(([x]) => {
  return x.add(x.mul(x).add(1.0).sqrt()).log();
});
