/* Integer-hash (PCG) noise: bit-identical on WebGPU, WebGL2, and GLES 3.0.
   Seeds become CPU-chosen integer domain offsets, never hash perturbation. */

import {
  Fn, Loop, array, float, int, vec2, vec3, vec4, uint, uvec2, uvec3, uvec4,
  fract, floor, dot, mix, mul,
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
}).setLayout({ name: 'pcg3d', type: 'uvec3', inputs: [{ name: 'vIn', type: 'uvec3' }] });

/* Lattice point → three floats in [0,1). A negative float to uint is undefined
   in GLSL, so the clamp pins everything below −1024 to lattice 0 on every backend. */
export const hash3 = /*@__PURE__*/ Fn(([ip]) => {
  const q = ip.add(vec3(1024.0)).max(0.0);
  const h = pcg3d(uvec3(uint(q.x), uint(q.y), uint(q.z)));
  return vec3(h.x.toFloat(), h.y.toFloat(), h.z.toFloat()).mul(2.3283064365386963e-10);
}).setLayout({ name: 'hash3', type: 'vec3', inputs: [{ name: 'ip', type: 'vec3' }] });

/* Single-lane PCG for scalar lattice values — a third of the hash work of
   pcg3d when only one channel is consumed */
export const hash1 = /*@__PURE__*/ Fn(([ip]) => {
  const q = ip.add(vec3(1024.0)).max(0.0);
  const n = uint(q.x).add(uint(q.y).mul(uint(198491317))).add(uint(q.z).mul(uint(6542989)));
  const s = n.mul(uint(747796405)).add(uint(2891336453));
  const w = s.shiftRight(s.shiftRight(uint(28)).add(uint(4))).bitXor(s).mul(uint(277803737));
  return w.shiftRight(uint(22)).bitXor(w).toFloat().mul(2.3283064365386963e-10);
}).setLayout({ name: 'hash1', type: 'float', inputs: [{ name: 'ip', type: 'vec3' }] });

/* hash1's lattice mix constants, shared so the lane hash matches it bit for bit */
const LATTICE_Y = 198491317;
const LATTICE_Z = 6542989;
const lanes = (v) => uvec4(uint(v), uint(v), uint(v), uint(v));

/* hash1's finisher on four mixed lattice integers at once: the same bits per
   lane in a quarter of the code the shader compiler has to chew through. */
const hashLanes = /*@__PURE__*/ Fn(([n]) => {
  const s = n.mul(uint(747796405)).add(lanes(2891336453));
  const w = s.shiftRight(s.shiftRight(lanes(28)).add(lanes(4))).bitXor(s).mul(uint(277803737));
  return vec4(w.shiftRight(lanes(22)).bitXor(w)).mul(2.3283064365386963e-10);
}).setLayout({ name: 'hashLanes', type: 'vec4', inputs: [{ name: 'n', type: 'uvec4' }] });

/* 3D value noise in [0,1] — trilinear blend of hashed lattice values.
   Both corners convert from float, as hash1 does, so out-of-window lattices clamp alike. */
export const valueNoise3 = /*@__PURE__*/ Fn(([p]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2.0).add(3.0));

  const lo = uvec3(i.add(vec3(1024.0)).max(0.0)).toVar();
  const hi = uvec3(i.add(vec3(1.0)).add(vec3(1024.0)).max(0.0)).toVar();
  const xy = uvec4(lo.x, hi.x, lo.x, hi.x)
    .add(uvec4(lo.y, lo.y, hi.y, hi.y).mul(uint(LATTICE_Y)));
  const h0 = hashLanes(xy.add(lo.z.mul(uint(LATTICE_Z))));
  const h1 = hashLanes(xy.add(hi.z.mul(uint(LATTICE_Z))));

  /* Blend order is x, y, z per lane, so the bits match eight hash1 calls */
  const x0 = mix(h0.xz, h0.yw, u.x);
  const x1 = mix(h1.xz, h1.yw, u.x);
  return mix(mix(x0.x, x0.y, u.y), mix(x1.x, x1.y, u.y), u.z);
}).setLayout({ name: 'valueNoise3', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

/* 2D value noise in [0,1] — half the lattice hashes of valueNoise3 with z = 0 */
export const valueNoise2 = /*@__PURE__*/ Fn(([p]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2.0).add(3.0));

  const lo = uvec2(i.add(vec2(1024.0)).max(0.0)).toVar();
  const hi = uvec2(i.add(vec2(1.0)).add(vec2(1024.0)).max(0.0)).toVar();
  const h = hashLanes(uvec4(lo.x, hi.x, lo.x, hi.x)
    .add(uvec4(lo.y, lo.y, hi.y, hi.y).mul(uint(LATTICE_Y)))
    .add(uint((1024 * LATTICE_Z) % 4294967296)));

  const x0 = mix(h.xz, h.yw, u.x);
  return mix(x0.x, x0.y, u.y);
}).setLayout({ name: 'valueNoise2', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

/* A shader loop compiles faster through WebGPU's translator and slower through
   ANGLE's on D3D, so only a WebGPU build loops; WebGL2 unrolls here in JS. */
const loops = (builder) => builder.renderer.backend.isWebGPUBackend === true;
const repeat = (builder, count, body) => {
  if (loops(builder)) Loop(count, body);
  else for (let k = 0; k < count; k++) body();
};

/* Gain 0.5 suits gas */
export function makeFbm3(octaves) {
  return Fn(([pIn], builder) => {
    const p = pIn.toVar();
    const sum = float(0).toVar();
    const amp = float(0.5).toVar();
    repeat(builder, octaves, () => {
      sum.addAssign(valueNoise3(p).mul(amp));
      p.mulAssign(2.02);
      amp.mulAssign(0.5);
    });
    return sum;
  });
}

export const fbm3o2 = /*@__PURE__*/ makeFbm3(2);
export const fbm3o4 = /*@__PURE__*/ makeFbm3(4);
export const fbm3o5 = /*@__PURE__*/ makeFbm3(5);

/* Golden-angle rotation coefficients, folded with the lacunarity in JS so the
   shader sees plain constants and every backend agrees bit-for-bit. */
const ROT_C = Math.cos(2.39996322972865332) * 2.02;
const ROT_S = Math.sin(2.39996322972865332) * 2.02;

/* fbm with each octave's xy lattice rotated by the golden angle and its z
   phase slid: aligned octaves share seam axes, and those seams read as soft
   rectangles — or, through any gradient or pow, a maze. */
export function makeFbm3Rot(octaves) {
  return Fn(([pIn], builder) => {
    const p = pIn.toVar();
    const sum = float(0).toVar();
    const amp = float(0.5).toVar();
    repeat(builder, octaves, () => {
      sum.addAssign(valueNoise3(p).mul(amp));
      /* vec3 constructor args evaluate before the assign lands, so reading p
         on the right side is safe in both GLSL and WGSL. */
      p.assign(vec3(
        p.x.mul(ROT_C).sub(p.y.mul(ROT_S)),
        p.x.mul(ROT_S).add(p.y.mul(ROT_C)),
        p.z.mul(2.02).add(17.7),
      ));
      amp.mulAssign(0.5);
    });
    return sum;
  });
}

export const fbm3o2r = /*@__PURE__*/ makeFbm3Rot(2);
export const fbm3o4r = /*@__PURE__*/ makeFbm3Rot(4);
export const fbm3o5r = /*@__PURE__*/ makeFbm3Rot(5);

/* Octave amplitude sums, for rescaling raw fbm to [0,1]; the 2-octave mean */
export const FBM2_NORM = 1 / 0.75;
export const FBM4_NORM = 1 / 0.9375;
export const FBM5_NORM = 1 / 0.96875;
export const FBM2_MID = 0.375;

/* Domain bias for cell grids centered on a point: without it, indices below −1024
   all clamp to one lattice in hash3. Grids add this first. */
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

/* Shared instances for the common octave counts; makeRidged is exported for odd ones */
export const ridged2 = /*@__PURE__*/ makeRidged(2);
export const ridged4 = /*@__PURE__*/ makeRidged(4);

/* 3×3 neighborhood as one shader loop, dx outer and dy inner, so the body
   compiles once. Flat on purpose: a two-index Loop rendered wrong through FXC. */
export function eachNeighbor(body) {
  Loop({ start: 0, end: 9, name: 'cell' }, ({ cell }) => {
    const row = cell.div(int(3)).toVar();
    body(vec2(float(row.sub(int(1))), float(cell.sub(row.mul(int(3))).sub(int(1)))), cell);
  });
}

/* Runs fn over every point in one shader loop where the backend loops. The compiler
   inlines each call site, so N sites of a noise would otherwise emit N bodies. */
export function batched(builder, fn, points) {
  if (!loops(builder)) return points.map((pt) => fn(pt).toVar());
  const pts = array(points).toVar();
  const res = array('float', points.length).toVar();
  /* Named: fn may carry its own loop, and an inner default index would shadow this one */
  Loop({ start: 0, end: points.length, name: 'site' }, ({ site }) => {
    res.element(site).assign(fn(pts.element(site)));
  });
  return points.map((_, k) => res.element(int(k)));
}

/* Jimenez interleaved gradient noise. Takes pixel coordinates, never uv. */
export const ign = /*@__PURE__*/ Fn(([px]) => {
  return fract(mul(52.9829189, fract(dot(px, vec2(0.06711056, 0.00583715)))));
});

/* asinh(x) = ln(x + sqrt(x² + 1)), componentwise; not a shader builtin */
export const asinh3 = /*@__PURE__*/ Fn(([x]) => {
  return x.add(x.mul(x).add(1.0).sqrt()).log();
});
