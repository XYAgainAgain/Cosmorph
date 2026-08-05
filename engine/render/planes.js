/* Depth-plane bucketing for the baked path. Four planes is all believable
   parallax needs; every entity joins one by its depth and shares its coefficient. */

export const PLANE_NAMES = ['deep', 'distant', 'far', 'close'];

/* Chosen so the type-default depths land as: starcloud/ifn/galaxies deep,
   clusters/filaments/emission distant, reflection through planetary far. */
export const PLANE_BOUNDS = [0.20, 0.35, 0.475];

export function planeFor(depth) {
  if (depth < PLANE_BOUNDS[0]) return 0;
  if (depth < PLANE_BOUNDS[1]) return 1;
  if (depth < PLANE_BOUNDS[2]) return 2;
  return 3;
}

/* ΔT × morph-rate that trips a rebake, and the rate a type with no morphRate
   default is assumed to drift at. Both are eye-tuned later. */
export const REBAKE_EPS = 0.01;
export const RATE_FLOOR = 0.05;
