/* Shape asset loader: a baked whole-frame field (`.bin`, RGBA half-float,
   row-major from top-left) plus its sidecar JSON, as a DataTexture. */

import * as THREE from 'three/webgpu';

const TEXEL_BYTES = 8; // four float16 channels

/* Asset paths resolve against the repo root, never the page: a root-absolute
   '/assets/...' misses under file:// and on any non-root host. */
const ASSET_ROOT = new URL('../../', import.meta.url);

/* Pre-densityMode bakes never wrote the key, and there the two always agreed */
function densityMode(meta) {
  if (meta.densityMode === 'emission' || meta.densityMode === 'extinction') return meta.densityMode;
  return meta.polarity === 'bright' ? 'emission' : 'extinction';
}

/* Format v2, all in frame UV: R = signed distance / spread, G = normalized column
   density, B duplicates R (reserved morph target), A = 0. */
export async function loadShapeAsset(src) {
  const url = new URL(src, ASSET_ROOT).href;
  const metaRes = await fetch(url);
  if (!metaRes.ok) throw new Error(`shape asset ${url}: HTTP ${metaRes.status}`);
  const meta = await metaRes.json();

  /* Hard gate, not a fallback: a v1 bake puts a gradient where the shader now
     reads column density, which renders as garbage rather than failing. */
  if (meta.formatVersion !== 2) {
    throw new Error(`shape asset ${url}: formatVersion ${meta.formatVersion ?? 1} is not supported; rebake as v2.`);
  }

  const binUrl = url.replace(/\.json$/i, '.bin');
  const binRes = await fetch(binUrl);
  if (!binRes.ok) throw new Error(`shape asset ${binUrl}: HTTP ${binRes.status}`);
  const buf = await binRes.arrayBuffer();

  const texels = buf.byteLength / TEXEL_BYTES;
  const size = Math.round(Math.sqrt(texels));
  if (!Number.isInteger(texels) || size * size !== texels) {
    throw new Error(`shape asset ${binUrl}: ${buf.byteLength} bytes is not a square RGBA16F image.`);
  }

  const spread = Number(meta.spread);
  if (!Number.isFinite(spread) || spread <= 0) {
    throw new Error(`shape asset ${url}: "spread" must be a positive number.`);
  }

  /* The contract is little-endian and so is every target platform, so the
     half-float words go straight to the GPU with no repacking pass. */
  const texture = new THREE.DataTexture(
    new Uint16Array(buf), size, size, THREE.RGBAFormat, THREE.HalfFloatType,
  );
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  /* Mips would average the boundary against the far field and drag the zero
     crossing inward; the shape is authored at one scale anyway. */
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;

  /* The optical depth a fully saturated column stands for; the entity's own
     tau overrides it. Absent means "the host's default is fine". */
  const ds = Number(meta.densityScale);
  const st = Number(meta.suggestedTau);

  return {
    texture,
    size,
    spread,
    densityScale: Number.isFinite(ds) && ds > 0 ? ds : 0,
    suggestedTau: Number.isFinite(st) && st > 0 ? st : 0,
    name: meta.name ?? 'shape',
    polarity: meta.polarity === 'bright' ? 'bright' : 'dark',
    /* What the G channel measured, which is not the silhouette's polarity: a dark
       crag can carry an emission column (opaque core, glowing skin). */
    densityMode: densityMode(meta),
    maxInscribedRadius: Number(meta.maxInscribedRadius) || 0,
    credit: meta.credit ?? null,
    /* The attribution the license actually requires, alongside the statement of
       changes; both are top-level sidecar keys, not part of `credit`. */
    creditVerbatim: meta.credit_verbatim ?? null,
    derivation: meta.derivation ?? null,
  };
}
