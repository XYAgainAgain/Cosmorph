/* Emission nebula, 2D field. Writes line channels vec3(Hα, OIII, SII) only —
   never RGB. The palette matrix touches these once, in compose. */

import { Fn, float, vec3, vec4, dot, smoothstep } from 'three/tsl';
import { fbm3o2, fbm3o4, fbm3o5 } from './noise.js';

/* Structure at three scales, not more amplitude: illumination gradient from
   the ionizing source, one domain warp, striations as slight extinction. */
export function buildEmissionNodes(skyU, U) {
  return Fn(() => {
    const zEvo = U.uTev.mul(U.uMorphRate);
    const p3 = vec3(skyU.mul(U.uNebFreq), zEvo).add(U.uNebOff);

    const q1 = fbm3o4(p3.mul(1.7));
    const q2 = fbm3o4(p3.mul(1.7).add(vec3(5.2, 1.3, 2.8)));
    const M = fbm3o5(p3.mul(2.4).add(vec3(q1, q2, float(0)).mul(U.uWarp)));

    const d = skyU.sub(U.uIonSrc);
    const G = float(1).div(dot(d, d).div(U.uIonR2).add(1.0));

    /* Bounded extent: a nebula is a cloud, not a gradient. Low-frequency
       coverage carves real black sky with a billowy boundary. */
    const cov = smoothstep(
      U.uCovLo, U.uCovHi,
      fbm3o2(vec3(skyU.mul(U.uNebFreq).mul(0.9), zEvo.mul(0.4)).add(U.uNebOff.mul(2.0))),
    );

    /* Striations are anisotropy, not a noise type: squash one axis ~30:1 */
    const sp = vec3(skyU.x.mul(9.0), skyU.y.mul(0.3), zEvo.mul(0.3)).add(U.uNebOff.mul(0.5));
    const S = fbm3o2(sp);

    const E = G.mul(M.sub(0.5).mul(U.uMottle).add(1.0))
      .mul(cov)
      .mul(float(1).sub(S.mul(U.uStria)))
      .max(1e-5)
      .pow(U.uNebContrast)
      .mul(U.uNebGain);

    /* OIII stays confined to the hottest inner zone; letting it leak across
       the field turns crimson Hα into rust */
    const hot = smoothstep(U.uHotLo, U.uHotHi, G);
    return vec4(E, E.mul(hot.mul(U.uOiii).add(0.015)), E.mul(U.uSii), 1.0);
  })();
}
