/* Shared volumetric dust pass: one fullscreen draw, two RGBA16F attachments
   (0 = line Hα/OIII/SII + summed tau in A, 1 = continuum). Built only when a
   scene carries a marched darkDust entity; absent, it costs nothing. */

import * as THREE from 'three/webgpu';
import { mrt, uv } from 'three/tsl';
import { buildDustMarchNodes } from '../shaders/tsl/dustmarch.js';

/* instances: dust bags (uDm* uniforms + dustOpts + uDepthDm); skyAt maps a
   depth uniform to that entity's pre-shifted sky coords, the sky2d pattern. */
export function buildDustPass({ instances, U, skyAt }) {
  const rt = new THREE.RenderTarget(2, 2, {
    count: 2,
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  /* mrt() routes members to attachments by texture NAME, not insertion order */
  rt.textures[0].name = 'dustLine';
  rt.textures[1].name = 'dustCont';

  const ents = instances.map((bag) => ({
    sky: skyAt(bag.uDepthDm),
    U: bag,
    opts: bag.dustOpts,
  }));
  const res = buildDustMarchNodes(ents, U, uv().mul(U.uResolution));

  /* mrtNode, not fragmentNode: a set fragmentNode bypasses MRT entirely. The
     two members read one struct-returning call, so the march runs once. */
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.mrtNode = mrt({
    dustLine: res.get('lineTau'),
    dustCont: res.get('cont'),
  });
  mat.depthTest = false;
  mat.depthWrite = false;

  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

  return {
    rt,
    scene,
    lineTex: rt.textures[0],
    contTex: rt.textures[1],
    setSize(w, h) { rt.setSize(w, h); },
    dispose() { rt.dispose(); },
  };
}
