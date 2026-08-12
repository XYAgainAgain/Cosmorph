//! Loads the real dumped bundle when COSMORPH_BUNDLE points at it. No GL here:
//! this covers parsing, blob slicing, and validation only.

use std::path::PathBuf;

use cosmorph_native_core::bundle::{Bundle, SamplerSource, ARTIFACT_VERSION};

const HERO_SEED: u64 = 40451906;

fn bundle_dir() -> Option<PathBuf> {
    let raw = std::env::var_os("COSMORPH_BUNDLE")?;
    let path = PathBuf::from(raw);
    if path.extension().is_some_and(|e| e == "json") {
        path.parent().map(PathBuf::from)
    } else {
        Some(path)
    }
}

#[test]
fn loads_and_validates_the_hero_bundle() {
    let Some(dir) = bundle_dir() else {
        eprintln!(
            "skipping bundle_load: set COSMORPH_BUNDLE to the directory holding \
             bundle.json and bundle.bin (run .dev/tools/glsl-dump to produce them)"
        );
        return;
    };

    let manifest_path = dir.join("bundle.json");
    let blob_path = dir.join("bundle.bin");
    let manifest = std::fs::read(&manifest_path)
        .unwrap_or_else(|e| panic!("reading {}: {e}", manifest_path.display()));
    let blobs = std::fs::read(&blob_path)
        .unwrap_or_else(|e| panic!("reading {}: {e}", blob_path.display()));

    let bundle = Bundle::load(&manifest, blobs).expect("bundle failed to load");
    let m = &bundle.manifest;

    assert_eq!(m.artifact_version, ARTIFACT_VERSION);
    assert_eq!(m.scene.seed, HERO_SEED, "hero seed");
    // 3 planes × a/b, the plane-0 galaxy sprite pass, bright, compose
    assert_eq!(m.programs.len(), 9, "hero program count");

    for blob in &m.blobs {
        let bytes = bundle.blob(blob.id).expect("blob out of range");
        assert_eq!(bytes.len(), blob.len, "blob {} length", blob.id);
    }

    for program in &m.programs {
        for sampler in &program.samplers {
            match &sampler.source {
                SamplerSource::Target { target, attachment } => {
                    let t = bundle
                        .target(target)
                        .unwrap_or_else(|e| panic!("{}.{}: {e}", program.id, sampler.name));
                    assert!(
                        *attachment < t.attachments,
                        "{}.{} reads attachment {} of '{}'",
                        program.id,
                        sampler.name,
                        attachment,
                        t.id
                    );
                }
                SamplerSource::Texture { texture } => {
                    bundle
                        .texture(texture)
                        .unwrap_or_else(|e| panic!("{}.{}: {e}", program.id, sampler.name));
                }
            }
        }
    }
}
