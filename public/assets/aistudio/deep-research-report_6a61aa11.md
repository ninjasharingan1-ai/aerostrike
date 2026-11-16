# AeroStrike Visual, Engineering & Audio Reference Pack for Gemini Hydrogen

## Executive Assessment

The research confirms the central issue you identified: **AeroStrike’s simulation architecture has advanced faster than its audiovisual production layer**. The public repository now contains the Phase 1 `SimWorld`/fixed-timestep foundation, but the presentation stack is still built largely around procedural aircraft geometry, generated canvas textures, procedural terrain/clouds, and synthesized Web Audio rather than a mature asset/audio pipeline. The current `droneModels.ts` is still dominated by primitive Three.js geometry; `terrainEngine.ts` still generates terrain and cloud textures procedurally; and `audioSynth.ts` still relies heavily on oscillators and generated noise. The current `FlightViewport.tsx` does delegate simulation to `SimWorld`, so the right next move is **not another major simulation rewrite**; it is a production-quality visual/audio vertical slice. citeturn495680view1turn495680view2turn495680view3turn797075view0turn797075view1

That conclusion is also consistent with the earlier Phase 0 audit, which classified the original 3D viewport/hangar as a prototype and the synthesized audio engine as a prototype rather than production fidelity. The audit specifically noted procedural meshes, non-spatial audio, and the absence of a glTF/LOD production asset workflow. fileciteturn0file0 The V2.0 master specification already calls for high-quality GLB/glTF assets, PBR materials, spatial audio, weather effects, LOD, and explicit source provenance, so the next production phase is fully aligned with the existing design document rather than a change of direction. fileciteturn0file1

The visual benchmark should be interpreted as a **quality bar**, not a source of reusable assets. War Thunder’s recent official updates emphasize exactly the areas AeroStrike is currently weakest in: improved firing effects, wind-carried smoke, aircraft damage fire/smoke, local tone mapping, more natural distant gunfire, cockpit/exterior acoustic differences, and richer engine/cockpit feedback. Those features illustrate the presentation gap without implying that any proprietary War Thunder asset should be copied. citeturn675463search0turn675463search1turn675463search2turn675463search3

iturn308958image0turn308958image2turn308958image1turn308958image5

These are **reference examples only**, not AeroStrike game assets: they illustrate hangar presentation, HALE-UAV scale/proportion, armored maintenance environments, and UAV scale diversity. Each image remains governed by its original source rights; visual-reference access is not the same thing as permission to redistribute or ship the image in the game.

## Repository Audit and the Actual Experience Gap

The current repository is structurally ready for a presentation overhaul. `FlightViewport.tsx` now consumes a headless `SimWorld`; `SimWorld` owns simulation events; and Phase 1 introduced deterministic timing and seeded simulation behavior. This means rendering and sound can increasingly become consumers of authoritative simulation events instead of containing gameplay logic. citeturn797075view0turn797075view1

The weak point is the presentation implementation. `droneModels.ts` constructs visible aircraft from objects such as `BoxGeometry`, `CylinderGeometry`, `SphereGeometry`, and `ConeGeometry`, with generated canvas textures for visual detail. That is appropriate for a prototype/fallback but cannot supply convincing panel work, control-surface seams, landing-gear complexity, nacelle geometry, sensor housings, or material response at close range. citeturn495680view2 `terrainEngine.ts` similarly creates procedural albedo/bump/cloud textures and uses generated geometry rather than a production environment library, so improvements to lighting alone will not produce the material richness or environmental scale you want. citeturn495680view3

The sound problem is even more direct. `audioSynth.ts` creates propulsion and combat sounds through oscillators, filters, and generated noise. That can work for stylized synthesis, but it cannot reproduce the transient/body/tail complexity of convincing gunfire, mechanical engine character, long-range propagation, indoor/outdoor contrast, or layered explosions by itself. citeturn495680view1 The current simulation event design also needs richer spatial payloads for sound events so the audio engine can derive source position from the actual world rather than playing a generic non-positional cue. `PannerNode` and `AudioListener` are specifically designed for 3D source/listener placement, and Web Audio provides distance models and dynamics compression suitable for the new architecture. citeturn151897search0turn151897search1turn151897search2turn151897search4

There is one additional design issue worth correcting during the visual pass. The current geographic definitions include named real-world regions and military landmarks while the terrain itself is procedural. `geoTheaters.ts` uses deterministic generated terrain and contains named theater/landmark data. For the new production environments, the cleanest approach is to use **fictional composite bases and fictional objective layouts**, while borrowing only generic visual language from public hangar, runway, radar, logistics, and vehicle imagery. That preserves atmosphere without turning the scenario editor into a replica of a real military site. citeturn797075view2

The earlier V2.0 document also contains resource-management language such as energy consumption and endurance comparisons. Because the current gameplay decision is that AeroStrike should not be a fuel/battery management game, the implementation prompt below explicitly overrides those parts for active gameplay while retaining flight physics, propulsion response, damage, ammunition, and cooldowns. fileciteturn0file1

## Visual Reference Catalog and Provenance Strategy

This catalog is intentionally broad rather than pretending to represent “every drone in the world.” The best production strategy is to cover **distinct silhouette families** first, because that gives the game much more visual diversity than building many near-duplicates. Official manufacturer pages are best used for broad published dimensions and external configuration; Wikimedia Commons is particularly useful for reusable/reference photographs where each file’s exact creator and license can be logged. Baykar, TUSAŞ, Elbit Systems, and IAI all maintain official public product pages for major UAV families. citeturn404942search0turn404942search1turn404942search2turn404942search3turn404942search4

| Priority | Platform | Class / Origin | External modeling cues | Recommended source strategy |
|---|---|---|---|---|
| A | Bayraktar TB2 | MALE / Türkiye, Baykar | long high-aspect wing, central fuselage pod, rear pusher prop, distinctive tail/boom silhouette, visible EO/IR turret and fixed gear | Official Baykar data + Commons multi-angle photos. A Commons TB2 image by Adam Pech oficial is CC BY-SA 4.0. citeturn404942search0turn418388search0 |
| A | MQ-9 Reaper | MALE / USA, General Atomics | bulbous nose, long wing, rear pusher, distinctive tail surfaces, ventral sensor turret, tall tricycle gear | Commons category has multiple front/side views; ILA images by Boevaya mashina are CC BY-SA 4.0. citeturn349187search1turn418388search4turn418388search5 |
| A | RQ-4 Global Hawk | HALE ISR / USA, Northrop Grumman | extremely long slender wing, bulbous forward fuselage, high-mounted jet installation, V-tail | Commons has U.S. Air Force imagery; the Stacey Knott file is a U.S. federal public-domain work. citeturn349187search2turn418388search6 |
| A | Bayraktar Akıncı | heavy MALE / Türkiye, Baykar | twin wing-mounted propulsors, large wing, tall landing gear, large forward fuselage/sensor volume | Baykar documentation + Commons; one Akıncı file by emirhandr is CC BY-SA 4.0. citeturn404942search5turn349187search3turn418388search3 |
| A | TAI ANKA | MALE ISR / Türkiye, TUSAŞ | long wing, rear pusher configuration, slender fuselage, prominent forward sensor installation, tricycle gear | Official TUSAŞ page publishes broad dimensions; Commons ANKA-B image by N13s013 is CC BY-SA 4.0. citeturn404942search4turn852881search0turn864106search0 |
| A | Hermes 900 | MALE ISR / Israel, Elbit | long high wing, narrow fuselage, pusher propulsion, distinct tail shape and ventral sensor form | Official Elbit product reference + Commons; Tio Skill image is CC BY-SA 4.0. citeturn404942search2turn852881search1turn864106search3 |
| A | IAI Heron | MALE ISR / Israel, IAI | high wing, central fuselage, rear pusher, twin-boom tail family and ventral sensor | IAI official page + Commons; Calips image is CC BY-SA 3.0. citeturn404942search3turn852881search2turn864106search6 |
| A | Wing Loong II | MALE / China, AVIC | long wing, bulbous nose, pusher propulsion, V-tail, ventral sensor ball | Commons category contains front/side views; Mztourist side-view file is CC BY-SA 4.0. citeturn516169search7turn864106search7 |
| B | MQ-1 Predator | MALE ISR / USA, General Atomics | narrower fuselage than MQ-9, high-aspect wing, rear pusher, recognizable tail geometry | Commons museum/operational imagery; a preserved Udvar-Hazy image is CC BY 4.0. citeturn516169search0turn383316search31 |
| B | RQ-7B Shadow | tactical ISR / USA, AAI | compact high wing, twin-boom tail, rear pusher, fixed landing gear | Commons has public-domain U.S. military imagery. citeturn516169search2turn516169search3turn383316search24 |
| B | Orlan-10 | tactical ISR / Russia | small high/shoulder wing, conventional tail, front tractor prop, compact field-launch scale | Commons category and Army-2022 images; Mike1979 Russia file is CC BY-SA 4.0. citeturn763151search2turn641823search4 |
| B | Mohajer-6 | tactical UAV / Iran | compact fuselage, high wing, rear propulsion/twin-boom visual family | Commons image by Erfan Kouchari/Tasnim is CC BY 4.0. Use exterior appearance only. citeturn852881search3turn383316search0 |
| B | Bayraktar Mini UAV | small ISR / Türkiye | small hand-portable pusher UAV, minimal structure and compact sensor/airframe packaging | Commons category includes side/top references; verify exact file license before embedding the selected image. citeturn763151search3turn383316search37 |
| C | Hermes 450 | tactical ISR / Israel, Elbit | smaller pusher UAV with slender wing/fuselage proportions | Commons has a dedicated category/gallery; verify per-file rights. citeturn516169search5turn516169search6 |
| C | ZALA Lancet | loitering UAV visual class / Russia | compact cylindrical body with two cruciform/X-like wing sets | Commons provides several external views; one Nickel nitride file is CC0. Use silhouette/material reference only and keep game behavior abstract. citeturn763151search1turn641823search6turn641823search9 |
| C | Shahed-136 | one-way UAV visual class / Iran | tailless delta-wing silhouette with rear pusher | Commons category provides external visual material. Use exterior geometry only; do not use internal component imagery or convert references into guidance/construction modeling. citeturn763151search0 |

For orthographic work, the safest workflow is: use a published 3-view drawing only when its individual license is recorded; otherwise build an original model from multiple external photographs plus published overall dimensions. Commons categories for platforms such as TB2 and Heron include line-drawing/diagram material, while the BMP-3 category includes public side/top drawing references; each individual file still needs its own rights check before inclusion. citeturn349187search0turn852881search2turn996598search4

For ground units, the first library should cover **visual categories**, not armor engineering: MBTs, IFVs/APCs, MRAP/wheeled vehicles, logistics trucks, radar vehicles, recovery vehicles, command vans, and convoy support props. Commons has strong discovery collections for M1 Abrams, Leopard 2, Bradley, BMP-3, APCs, and military convoys. These should be used for silhouette, paint, weathering, stowage, wheels/tracks, and scale reference — not armor weak-point or vulnerability modeling. citeturn996598search1turn996598search2turn996598search3turn996598search4turn774075search3turn774075search4

For bases and environmental props, suitable public reference hubs include aircraft-in-hangar imagery, military radar categories, and radar-station imagery. The game should extract visual archetypes — hangar doors, apron lights, radomes, mobile arrays, maintenance stands, barriers, generators, service trucks — and recombine them into fictional base layouts rather than replicating a real installation. citeturn774075search1turn774075search2turn774075search6

For generic materials and non-branded props, the licensing picture is much cleaner: Poly Haven makes its assets available under CC0; ambientCG likewise distributes its downloadable assets under CC0; and Kenney publishes assets under CC0. Sketchfab can be valuable, and its API supports glTF/GLB delivery, but individual model licenses vary and editorial-license content cannot simply be treated as commercially reusable. citeturn843993search0turn843993search1turn843993search2turn843993search4turn843993search5turn843993search6

The actionable visual manifest is already prepared in both machine-readable formats:

[Visual Asset Manifest — JSON](sandbox:/mnt/data/AeroStrike_Visual_Asset_Manifest.json)

[Visual Asset Manifest — CSV](sandbox:/mnt/data/AeroStrike_Visual_Asset_Manifest.csv)

## Audio Reference Pack and Sound Architecture

The best practical solution is **not** to search for a single “perfect machine-gun sound.” Production combat audio should be assembled from layers: a short transient, a mid-frequency body, mechanical texture where appropriate, a low-frequency impact layer, and one or more near/far tails. Engine audio should likewise use separate near/far/exterior layers and smooth continuous parameters rather than repeatedly triggering isolated clips.

Freesound is useful, but its files can be CC0, CC BY, or CC BY-NC, so the license must be checked at the **individual sound** level. OpenGameArt also mixes licenses and requires attention to attribution and license-specific distribution rules. Pixabay allows broad use and modification under its content license but prohibits standalone redistribution and warns that other IP rights may still apply. citeturn609386search0turn609386search1turn609386search2

The following candidate files were verified as practical **CC0 starting material**, which makes them unusually convenient for a game production pipeline:

| Role | Candidate | Production use |
|---|---|---|
| gun transient/body | qubodup — Cannon Shot | one layer of a composite shot, not the entire finished weapon identity. citeturn172211search0 |
| secondary cannon transient | craigsmith — S21-02 Cannon Shot | blend/edit with another body/tail to avoid a thin one-shot result. citeturn172211search1 |
| distant explosion | Kostrava — distant explosions | distant battlefield tail and long-range explosion layer. citeturn172211search3 |
| propeller layer | Breviceps — Propeller Plane | propulsion timbre reference/layer; do not claim it is the exact real UAV engine. citeturn172211search5 |
| distant prop loop | gis_sweden — Distant Airplane Loop | exterior/far engine bed. citeturn172211search4 |
| multirotor | hoshisato — Drone taking off and landing | electric rotor texture for multirotor classes. citeturn432116search17 |
| general flyby | deadrobotmusic — Plane Flyby | flyby texture, spatialized by the game engine rather than baked into weapon behavior. citeturn432116search6 |
| jet/far flyby | craigsmith — Distant Jet Fly By | candidate for jet-powered UAV/flyby ambience. citeturn432116search24 |
| airfield ambience | craigsmith — Small Airport Ambience | environmental bed after editing/loop cleanup. citeturn172211search6 |
| desert wind | PLukx — strong desert wind | long environmental layer for a desert theater. citeturn172211search7 |
| metallic impact | BennettFilmTeacher — Metal Impact | structural/vehicle impact component. citeturn432116search9 |
| warning tone | SamsterBirdies — Beep warning | starting point for an AeroStrike-specific alert sound rather than a final unedited UI identity. citeturn432116search47 |

Sonniss GDC bundles are attractive because the current license grants broad royalty-free project use without attribution, but the 2026 license also contains an explicit restriction on AI use. Therefore, **do not upload Sonniss raw files into Gemini/Hydrogen or any AI workflow unless the rights holder confirms that the intended processing is permitted**. They can instead be considered for a later manual production step after rights review. citeturn609386search3

The implementation should use cached decoded `AudioBuffer`s, disposable one-shot `AudioBufferSourceNode`s, per-source gain/filter chains, `PannerNode` for 3D position, and `AudioListener` driven by the active camera. Web Audio supports inverse/linear/exponential distance models, while `DynamicsCompressorNode` can protect the master bus from clipping when gunfire, engines, explosions, and ambience overlap. `AudioBufferSourceNode` is designed for one-shot playback while the underlying decoded buffer can be reused efficiently. citeturn151897search0turn151897search1turn151897search2turn151897search4turn151897search6

Doppler should be **perceptual**, not a weapon-physics feature: modest playback-rate modulation can be driven by relative radial velocity between camera and source. This improves the sense of a fast flyby without turning the audio system into a ballistic propagation model.

The audio manifest is also prepared:

[Audio Asset Manifest — JSON](sandbox:/mnt/data/AeroStrike_Audio_Asset_Manifest.json)

[Audio Asset Manifest — CSV](sandbox:/mnt/data/AeroStrike_Audio_Asset_Manifest.csv)

## Production Pipeline and WebGL Budgets

Three.js already has the right underlying loaders for a production workflow. `GLTFLoader` supports glTF 2.0 and relevant compression/extensions, including Draco mesh compression, Meshopt, and KTX2/Basis texture workflows when the corresponding decoders/loaders are configured. `KTX2Loader` is specifically intended to transcode Basis Universal textures into GPU-supported compressed formats. Three.js documentation also recommends glTF/GLB as a runtime delivery format and stresses texture-memory costs and explicit resource disposal. citeturn525214search0turn525214search1turn525214search3turn525214search4turn525214search5

The following are **starting production targets, not verified universal limits**. They should be profiled and revised on the actual AeroStrike build:

| Area | Starting target |
|---|---|
| Hero UAV LOD0 | roughly 80k–150k visible triangles |
| Hero UAV LOD1 | roughly 30k–60k |
| Hero UAV LOD2 | roughly 8k–20k |
| Major ground vehicle LOD0 | roughly 50k–120k depending on screen importance |
| Vehicle textures | typically 2K PBR; reserve 4K selectively for close hangar inspection |
| Runtime textures | KTX2/Basis where practical; pack ORM channels where appropriate |
| Repeated props | instancing for barriers, rocks, vegetation, crates and repeated service objects |
| Draw-call strategy | profile aggressively; batch/instance repeated environment objects rather than chasing an arbitrary universal number |
| Shadows | tightly limit expensive shadow-casting lights and high-resolution shadow maps |
| VFX | scalable density/tails by quality tier and distance |
| Performance goal | establish a measured 1080p baseline on the actual test hardware, then tune quality tiers around measured frame time rather than invented FPS claims |

The production work should be split into three stages. **Stage A** is a proof-of-quality vertical slice: one hero UAV, one fictional high-desert theater, and one short representative combat scenario. TB2 is a sensible first hero because the project already uses that identity and public visual references are strong. Stage A must include a real GLB/glTF path, PBR/LOD, improved terrain/materials, upgraded lighting/cloud/haze, layered sample-based audio, spatial sound positions, VFX, better camera feel, and before/after evidence. **Stage B** expands the reusable library across the silhouette families, ground vehicles, fictional-base modules, materials, audio variations, and generic props. **Stage C** focuses on integration, asset streaming, performance tiers, memory/resource disposal, visual regressions, sound-event tests, replay/camera QA, and a licensing audit.

The key acceptance philosophy is simple: **architecture alone does not complete the audiovisual phase**. The player must be able to load the same scenario before and after the work and immediately hear and see a substantial difference.

## Gemini Hydrogen Master Prompt

The complete sendable pack is available here:

[AeroStrike Gemini Reference Pack — Markdown](sandbox:/mnt/data/AeroStrike_Gemini_Reference_Pack.md)

The following is the principal execution prompt to send together with the Markdown pack and both manifest files:

```text
AEROSTRIKE — AUDIOVISUAL PRODUCTION OVERHAUL / STAGE A EXECUTION

Read the attached AeroStrike Visual, Engineering & Audio Reference Pack and both attached asset manifests completely before changing the project.

You are working on the existing AeroStrike AI Studio repository.

The Phase 1 simulation foundation already exists and must be preserved. The immediate task is NOT another large simulation refactor. The task is to produce an immediately perceptible audiovisual quality improvement in the playable game.

Use modern premium aerial-combat games only as a QUALITY REFERENCE. Do not copy War Thunder assets, recordings, textures, maps, UI, code, or proprietary data.

CORE OBJECTIVE

Transform one representative AeroStrike combat scenario from a procedural/prototype presentation into a convincing production-quality vertical slice.

The result must materially improve:

- aircraft visual fidelity
- environment atmosphere
- gunfire and explosion sound
- propulsion sound
- spatial audio
- combat VFX
- camera feel
- lighting and material response
- scene depth
- HUD visual hierarchy

Do not claim success based on architecture work alone.

SOURCE AND LICENSING RULES

Every imported visual, audio, model, texture, HDRI, or other third-party asset must have recorded provenance.

Before importing an asset, record:

- asset ID
- source URL
- original creator
- exact license
- attribution requirement
- whether commercial game use is allowed
- whether modification is allowed
- whether redistribution restrictions apply
- verification date

A photograph or manufacturer image that is publicly viewable is NOT automatically licensed for game inclusion.

Use official/manufacturer imagery as visual reference only unless reuse permission is explicitly documented.

Prefer:

- CC0
- public-domain
- clearly compatible CC BY / CC BY-SA
- original AeroStrike-authored assets

Do not claim that an asset is licensed unless the license has actually been verified.

Do not bundle copyrighted reference photographs as game textures or project assets unless their license permits it.

Do not use any proprietary War Thunder asset.

Do not upload third-party files into AI tooling if the source license prohibits AI use.

MILITARY REFERENCE BOUNDARY

Real UAVs and military vehicles may be used only to inform public EXTERNAL visual characteristics such as:

- silhouette
- overall proportions
- wings and tail shapes
- landing gear
- visible propulsion arrangement
- visible sensor housings
- exterior materials
- paint
- surface weathering
- broad public role/category

Do not implement or infer:

- real operational targeting
- real weapon guidance optimization
- attack planning
- weapon construction
- classified/non-public performance
- military-site vulnerability
- real defensive-layout analysis
- sensitive military coordinates
- armor weak-point modeling

All military bases and combat environments must be FICTIONAL COMPOSITES.

They may use generic public references for:

- runways
- taxiways
- hangars
- maintenance aprons
- radar/radome silhouettes
- lighting towers
- service vehicles
- logistics props
- barriers
- generators
- control-tower forms

Do not reproduce the actual layout of a sensitive real military installation.

Loitering or one-way UAVs such as Lancet or Shahed-136 may be represented only through external visual/silhouette reference and abstract game behavior.

REPOSITORY PRIORITY

Inspect and improve these systems first:

- src/engine/droneModels.ts
- src/engine/terrainEngine.ts
- src/engine/FlightViewport.tsx
- src/engine/audioSynth.ts
- src/sim/core/simWorld.ts
- src/sim/geoTheaters.ts
- src/sim/settings.ts
- package.json

Preserve the existing fixed-timestep simulation, SimWorld state ownership, deterministic tests, and Phase 1 behavior.

GAMEPLAY DESIGN OVERRIDE

AeroStrike is a high-fidelity GAME, not a fuel/endurance-management simulator.

Do not introduce:

- gameplay fuel depletion
- gameplay battery depletion
- solar-charge requirements
- engine shutdown caused by resource exhaustion

Preserve:

- aerodynamics
- inertia
- gravity
- propulsion response
- aircraft-specific handling
- weather effects
- damage
- ammunition
- cooldown gameplay

STAGE A — EXECUTE NOW

Build one Proof-of-Quality vertical slice only.

Use:

- one hero UAV
- one fictional high-desert theater
- one representative combat scenario

Recommended hero platform: Bayraktar TB2.

VEHICLE PRESENTATION

Replace or bypass the primitive-only hero-aircraft presentation with a production GLB/glTF asset pipeline.

Requirements:

- original or legally reusable hero model
- documented external visual references
- broadly correct external proportions
- PBR materials
- normal/roughness/metallic detail
- visible material variation
- animated propeller where supported
- animated external control surfaces where supported
- LOD0 / LOD1 / LOD2
- clean pivots and transforms
- reliable resource disposal
- fallback procedural model only when the production asset is unavailable

Never describe a primitive placeholder as a completed high-fidelity model.

If a production-quality legal model cannot be obtained, build the asset-loading pipeline and clearly report the hero model as MISSING rather than pretending the placeholder satisfies the requirement.

ENVIRONMENT

Create a FICTIONAL high-desert training/combat environment inspired by generic public airfield architecture.

Improve:

- terrain material variation
- terrain macro/micro detail
- runway and taxiway visuals
- hangars
- maintenance props
- generic radar/radome props
- service vehicles
- rocks and ground clutter
- atmospheric haze
- clouds
- natural lighting
- contact/depth shadows
- distant depth cues
- weather identity
- scene color balance

Do not call procedural terrain “real satellite” or “authentic DEM” unless actual licensed geographic data is being used.

AUDIO

Replace the simplistic combat one-shot oscillator/noise approach with a layered sample-based spatial audio system.

Procedural synthesis may remain only where it genuinely improves the sound.

Implement:

- decoded AudioBuffer cache
- layered gunfire
- layered explosions
- propulsion near/far layers
- multirotor/propeller/jet category identities
- ambient wind
- airfield ambience
- impact layers
- UI warning layers
- PannerNode spatialization
- sound-source coordinates from SimWorld events
- AudioListener position/orientation from the active camera
- distance attenuation
- distance filtering
- camera-dependent external/interior filtering
- conservative perceptual Doppler through playback-rate modulation
- category buses
- ducking
- master dynamic-range protection
- clean resource disposal
- licensing manifest

Verify every sample license immediately before importing it.

The attached Audio Asset Manifest contains CC0 starting candidates. Treat them as ingredients, not final one-file weapon identities.

Do not claim that a generic recording is the authentic sound of a specific real UAV engine unless there is reliable source evidence.

COMBAT VFX

Upgrade the primitive explosion and firing presentation.

Implement a reusable event-driven VFX system for:

- muzzle flash
- firing smoke
- impact flash
- ground impact
- debris
- persistent smoke
- persistent fire where appropriate
- surface dust
- near/far effect variants
- wind-responsive visual drift where appropriate
- scalable quality tiers

Every world-space effect must use authoritative SimWorld event coordinates.

Do not substitute screen-space UI effects for world-space event placement.

CAMERA AND REPLAY FEEL

Improve:

- chase-camera damping
- camera lag
- FOV response
- zoom transition
- flyby camera
- close inspection
- impact readability
- replay-ready camera hooks

Avoid excessive shake or effects that make piloting harder.

HUD

Reduce clutter.

Prioritize:

- flight state
- target/threat information
- weapon state
- warnings
- mission-critical information

Do not display engineering telemetry merely to make the screen look “technical.”

THREE.JS ASSET PIPELINE

Use glTF/GLB as the runtime 3D format.

Where appropriate implement:

- GLTFLoader
- Draco support
- Meshopt support
- KTX2 texture compression
- asynchronous loading
- cache
- loading/error states
- LOD
- instancing for repeated props
- deterministic resource disposal
- performance instrumentation
- graphics quality tiers

The triangle/texture budgets in the attached research report are STARTING TARGETS, not guaranteed performance limits.

Profile the actual game.

PRODUCTION EVIDENCE

Do not declare Stage A complete from source changes alone.

Required evidence:

- modified-file inventory
- imported-asset inventory
- source/creator/license for every third-party asset
- before/after screenshots from the SAME representative scenario
- actual browser-run evidence
- TypeScript result
- production build result
- existing simulation regression results
- console error/warning result
- measured FPS and frame-time on the test environment
- renderer resource/memory observations where practical
- repeated vehicle/theater swap resource-disposal test
- proof that sounds use world positions
- proof that VFX use SimWorld positions
- list of remaining placeholders
- list of missing production assets
- explicit limitations

If an asset is unavailable or its license is unclear, report it as missing.

Do not silently substitute copyrighted material.

Do not fabricate screenshots, benchmark results, licensing information, source inspection, or test outcomes.

STOP CONDITION

Complete Stage A only.

Do not automatically proceed to:

- the full UAV library
- Stage B library expansion
- Stage C integration
- Phase 2 flight-dynamics work
- later master-plan phases

Stop after Stage A and provide the complete evidence package for review.
```

## Deliverables and Recommended Use

The package is designed so Gemini can distinguish between **reference-only material** and **assets that may actually be integrated**. Wikimedia Commons is particularly valuable because individual file pages expose creator/license metadata; however, category pages are only discovery hubs and every selected file still needs its individual rights record. Manufacturer photographs should generally remain reference-only unless their license explicitly grants reuse. Poly Haven, ambientCG, and Kenney are much safer sources for generic production assets because of their CC0 policies. citeturn843993search0turn843993search1turn843993search2

The four manifest files and the Markdown master pack are ready to send together:

[Complete Gemini Reference Pack](sandbox:/mnt/data/AeroStrike_Gemini_Reference_Pack.md)

[Visual Manifest — JSON](sandbox:/mnt/data/AeroStrike_Visual_Asset_Manifest.json)

[Visual Manifest — CSV](sandbox:/mnt/data/AeroStrike_Visual_Asset_Manifest.csv)

[Audio Manifest — JSON](sandbox:/mnt/data/AeroStrike_Audio_Asset_Manifest.json)

[Audio Manifest — CSV](sandbox:/mnt/data/AeroStrike_Audio_Asset_Manifest.csv)

This pack deliberately does **not** include copyrighted manufacturer photography as redistributed files, nor does it include detailed internal weapon diagrams, real military-site layouts, targeting information, or operational performance models. The visual material is focused on publicly observable external design, art direction, materials, scale, and generic environmental architecture; the audio plan is focused on licensed game-production sound design rather than real weapon-performance modeling.