# AEROSTRIKE — HIGH-FIDELITY AIR & AEROSPACE SIMULATION REQUIREMENTS V2.0

## CORE VISION

Transform the existing AeroStrike project into a technically grounded, high-fidelity aerial combat and aerospace simulation game.

**Repository:** https://github.com/ninjasharingan1-ai/aerostrike

The primary reference is the systemic depth, gameplay immersion, aircraft individuality, simulation complexity, and audiovisual quality of War Thunder's aerial experience.

AeroStrike must retain its own original identity, codebase, interface design, and assets.

The objective is not to create an impressive-looking prototype. It is to build a functional, interconnected simulation in which aircraft behavior, vehicle configuration, damage, environmental conditions, navigation, sound, and visual feedback derive from coherent underlying systems.

**Fundamental rule:** Do not confuse visual complexity with engineering depth.

---

## 0. MANDATORY REPOSITORY AUDIT

Before implementing new systems:

1. Inspect the existing repository and identify all functional modules.
2. Trace the relationship between the simulation state, user input, rendering engine, aircraft definitions, equipment, AI, networking, and interface.
3. Identify incomplete implementations, hardcoded shortcuts, duplicated logic, inaccurate technical claims, and architectural weaknesses.
4. Record the current Git commit and establish a reproducible baseline.
5. Identify existing tests and determine their actual coverage.
6. Distinguish implemented features from visually represented or partially simulated ones.
7. Document the expected impact of each proposed change.

Use actual source files and functions as evidence.

Do not claim to have executed tests or inspected runtime behavior unless those actions were actually performed.

Do not modify the existing project during this initial audit.

---

## 1. REAL-WORLD REFERENCE INTEGRATION

Use reputable, publicly available sources to research aircraft and aerospace systems, including:

- Aircraft manufacturer publications
- Public aerospace documentation
- Historical and museum archives
- Civil aviation references
- Academic aerospace literature
- Publicly documented visual references
- Official technical publications suitable for non-operational simulation

For each aircraft or represented vehicle, investigate:

- Publicly documented role and classification
- External geometry and proportions
- Propulsion category
- Broad flight characteristics
- General control configuration
- Visible equipment arrangements
- Material appearance
- Publicly documented environmental operating characteristics

### DATA PROVENANCE

Create a central Source Registry.

Each parameter must be classified as:

- `VERIFIED_PUBLIC_DATA`
- `ENGINEERING_ESTIMATE`
- `GAME_BALANCE_PARAMETER`
- `UNKNOWN`

Verified public facts must be accompanied by sources.

Estimates must have documented assumptions.

Game-balancing parameters must be explicitly distinguished from verified physical specifications.

Unknown values must never be silently presented as authentic.

Where reliable public information is insufficient, implement clearly identified approximations rather than fabricating manufacturer specifications.

Real-world aerospace references may inform the educational, visual, and general flight-model aspects of the game. Combat capabilities must not become operational weapon-engineering or targeting tools.

---

## 2. SIMULATION FOUNDATION

Establish a consistent simulation architecture before expanding gameplay.

### REQUIRED PRINCIPLES

- Fixed-timestep simulation updates
- Rendering independent from simulation frequency
- Accumulator-based time management
- Safe handling of long frames and inactive browser tabs
- Consistent unit conventions
- Documented world and local coordinate systems
- Reproducible simulation states
- Seeded randomness where deterministic testing is required
- Centralized simulation events
- Consistent state ownership
- Stable numerical behavior

### TIME CONSISTENCY

Equivalent simulation scenarios must produce equivalent outcomes when rendered at different frame rates.

Test the simulation under controlled 30, 60, and 144 FPS rendering scenarios.

Record numerical differences and establish justified tolerances.

Prevent frame-rate changes from silently altering simulation speed, energy consumption, aircraft motion, or event timing.

### TELEMETRY CONSISTENCY

All flight telemetry must derive from authoritative simulation state.

Distinguish:

- Ground speed
- Airspeed
- Altitude above mean sea level
- Altitude above terrain
- Heading and attitude
- Vertical motion
- Vehicle energy state
- Environmental conditions

Never substitute arbitrary values solely to make the cockpit or HUD appear realistic.

---

## 3. ADVANCED FLIGHT SIMULATION

Create specialized flight-dynamics implementations behind a shared vehicle-simulation interface.

Support at minimum:

- Fixed-wing aircraft
- Multirotor aircraft
- Additional aircraft classes when justified by the existing roster

Each class must use appropriate physical behavior rather than sharing an incompatible generic movement model.

### GENERAL FLIGHT PHYSICS

Implement suitable representations of:

- Aerodynamic lift and drag
- Gravity and atmospheric variation
- Translational momentum
- Rotational inertia
- Control-response dynamics
- Environmental turbulence
- Wind-relative motion
- Propulsion responsiveness
- Energy consumption
- Flight stability
- Aircraft-specific handling
- Component degradation

Use public aerospace science and clearly documented approximations.

### FLIGHT MODES

Provide three distinct experiences:

**Arcade:** Accessible controls, assistance systems, simplified management, and responsive gameplay.

**Realistic:** Reduced assistance, more meaningful energy and vehicle limitations, and greater consequences from environmental conditions and damage.

**Simulator:** Advanced manual control, immersive aircraft viewpoints, instrument-based feedback, and minimal artificial assistance.

These modes should share authoritative simulation infrastructure. Assistance settings and explicitly defined gameplay modifiers may vary between modes.

Do not implement the modes as disconnected animations or unrelated movement systems.

---

## 4. COMPONENT-BASED VEHICLE DAMAGE

Replace dependence on a single vehicle HP value with a structured component-state system.

Represent suitable components such as:

- Structural sections
- Wings or rotor assemblies
- Propulsion system
- Energy storage
- Flight control systems
- Sensors and avionics
- Landing equipment

Component condition must affect gameplay where appropriate.

Examples include:

- Reduced control responsiveness
- Visible structural damage
- Changed engine audio
- Increased vibration
- Reduced simulated propulsion
- Degraded instrument availability
- Altered handling
- Mechanical failure states

All gameplay effects must use documented game-simulation rules.

Visual damage, audio feedback, flight behavior, and HUD warnings must remain synchronized with the same underlying component state.

Provide repair, inspection, and recovery workflows in the hangar.

---

## 5. AEROSPACE & SPACEFLIGHT DIVISION

Build an independent aerospace flight experience using shared foundational services where appropriate.

The division must support original spacecraft and publicly documented aerospace visual references.

### ATMOSPHERIC & SPACE ENVIRONMENTS

Represent:

- Atmospheric layers
- Density and pressure variation
- Gravity variation with altitude
- High-altitude environmental transitions
- Earth curvature
- Planetary-scale visualization
- Upper-atmosphere illumination
- Spaceflight visualization
- General orbital-motion principles
- Environmental changes across flight phases

### LAUNCH & FLIGHT EXPERIENCE

Include:

- High-fidelity launch environment
- Fictional vehicle assembly and inspection
- Interactive launch-control visualization
- Cinematic flight cameras
- Live simulation-state telemetry
- Flight-event timeline
- Atmospheric transition effects
- Scientific visualization
- Replay and debriefing

Ballistic military systems may be represented through historical appearance, general classification, visual flight phases, and abstract game behavior.

Do not turn these systems into real-world military targeting, operational missile guidance, launch engineering, weapon construction, or attack-planning utilities.

### ARCHITECTURAL SEPARATION

The spaceflight division should reuse common simulation-clock, rendering, environment, event, and telemetry interfaces where suitable.

Its specialized environmental and vehicle systems must remain separately testable.

Avoid inserting unrelated spaceflight logic directly into the existing aircraft flight loop.

---

## 6. ENGINEERING HANGAR & CONFIGURATION SYSTEM

Expand the existing hangar rather than replacing it unnecessarily.

The hangar must become a functional engineering workspace with synchronized visual and simulation states.

### MAIN CAPABILITIES

- High-fidelity 3D aircraft inspection
- Component identification
- Interactive visible-part installation and removal
- Vehicle appearance customization
- Propulsion and avionics configuration
- Virtual equipment selection
- Saved configuration presets
- Damage inspection and repair
- Test-flight integration
- Original fictional launch-platform galleries
- Configuration comparisons

### EQUIPMENT COMPATIBILITY

Implement a dedicated game-defined compatibility system.

The system must validate equipment configurations before applying them.

Reject unsupported combinations and explain the reason in the interface.

Do not assume that every vehicle supports every equipment slot or attachment.

### STATE INTEGRITY

All visually relevant equipment changes must update the 3D representation.

All behaviorally relevant configuration changes must update the appropriate simulation state.

Use a centralized configuration schema to prevent disagreement between the hangar, HUD, and active game simulation.

### TEST LAB

Provide an engineering sandbox for:

- Aircraft-handling evaluation
- Energy and endurance comparison
- Component-state inspection
- Configuration comparison
- Environmental testing
- Replay and diagnostics

Test results must be generated by the simulation rather than invented for display.

---

## 7. WEAPON GAMEPLAY & VIRTUAL EQUIPMENT FIDELITY

Develop distinct game-only behaviors for different virtual equipment and weapon categories.

Represent meaningful differences in:

- 3D geometry
- Visual effects
- Audio presentation
- Game-defined firing states
- Ammunition management
- Cooldown states
- Virtual projectile behavior
- Equipment availability
- Collision interaction
- Gameplay damage response
- Replay and event records

Do not implement every equipment category as an identical underlying object with different names or textures.

### GLIDE EQUIPMENT EXPERIENCE

Include a dedicated virtual glide-weapon category with:

- Distinct 3D models
- Animated visual components
- Separation and flight cinematics
- Abstract in-game flight behavior
- Environmental visual feedback
- Replay cameras
- Game-event analysis

All numerical combat behavior must use explicitly identified game parameters.

Public information may support visual representation and general categorization, but must not be used to construct operational targeting, guidance optimization, or weapon-design models.

---

## 8. MISSION PLANNING & SCENARIO SYSTEM

Implement a complete in-game scenario planning laboratory.

Support real geographic terrain datasets when appropriately sourced and licensed, as well as fully procedural fictional environments.

### CORE FEATURES

- Interactive scenario maps
- Weather selection
- Aircraft and equipment selection
- Mission objectives
- AI behavior presets
- Scenario timeline configuration
- Team configuration
- Game-only mission execution
- Telemetry analysis
- Replay and debriefing

### GEOGRAPHIC DATA INTEGRITY

Distinguish clearly between:

- Authentic geographic datasets
- Derived terrain data
- Procedurally generated landscapes
- Fictional scenario elements

Never label procedurally generated geometry as authentic satellite or digital elevation data.

All geographic coordinate transformations must use consistent reference systems.

Real geographic data must not convert the editor into a tool for planning or executing actual military strikes.

---

## 9. AI & MULTIPLAYER ARCHITECTURE

### AI SYSTEMS

Create understandable, testable AI behavior systems.

AI aircraft should respect their assigned game flight characteristics rather than using unrestricted position changes.

Include:

- State-driven behavior
- Team coordination
- Environmental awareness
- Distinct difficulty profiles
- Collision avoidance
- Vehicle capability constraints
- Reproducible AI test scenarios

### MULTIPLAYER

Create an authoritative server model for competitive gameplay.

Required capabilities:

- Server-side state validation
- Consistent simulation ownership
- Client input validation
- Event ordering
- State reconciliation
- Latency handling
- Disconnect recovery
- Session integrity
- Multiplayer regression testing

The server must not blindly accept client-reported vehicle positions, damage, scores, or authoritative gameplay events.

Validate the system through actual multiplayer tests, not just successful WebSocket connection messages.

---

## 10. VISUAL & AUDIO PRODUCTION

### GRAPHICS

Develop a consistent, high-fidelity real-time rendering pipeline.

Include:

- High-quality GLB/glTF vehicle assets
- Accurate visual proportions based on available references
- PBR materials
- Appropriate surface texture detail
- Level-of-detail management
- Realistic scene lighting
- Contact shadows
- Atmospheric perspective
- Weather effects
- Particle systems
- Camera stabilization and movement
- Performance-aware rendering
- Configurable graphics presets

Replace procedural placeholder meshes progressively, without breaking functional game features.

Do not claim that visual assets match real aircraft precisely unless their references and dimensions have been verified.

### SOUND

Develop a spatial audio system with:

- Distinct propulsion sound profiles
- Engine-state-responsive sound
- Layered environmental audio
- Distance-based attenuation
- Spatial positioning
- Mechanical feedback
- Surface and collision audio
- Weather ambience
- Camera-dependent listening perspectives

Prefer properly licensed recordings or authored sound assets when they materially improve fidelity.

Audio effects must be driven by actual game-state events, rather than unrelated random playback.

---

## 11. ZERO-FAKE IMPLEMENTATION CONTRACT

Every significant feature must have:

1. An authoritative state or verified external data source
2. Defined system ownership
3. Documented inputs and outputs
4. A real implementation
5. Appropriate automated tests
6. Runtime validation
7. Explicit limitations
8. Supporting evidence

### IMPLEMENTATION STATUS

Use these classifications consistently:

- `VERIFIED_IMPLEMENTED`
- `IMPLEMENTED_UNVERIFIED`
- `PROTOTYPE`
- `MOCK_ONLY`
- `BLOCKED`
- `NOT_IMPLEMENTED`

Mock implementations are permitted inside explicitly labeled development tests and prototypes.

They must never be reported as verified production functionality.

### EVIDENCE REQUIREMENTS

For each completed feature, provide:

- Modified source files
- Relevant functions or modules
- Test commands
- Actual test results
- Runtime evidence when applicable
- Known limitations
- Regression impact

Do not fabricate test results, network responses, performance measurements, or external source data.

Do not claim successful verification when testing was not performed.

---

## 12. PERFORMANCE & QUALITY ASSURANCE

Create an evidence-driven quality system.

### PERFORMANCE

Measure:

- Frame rate and frame-time stability
- CPU usage
- GPU workload where measurable
- Memory consumption
- Scene loading time
- Resource disposal
- Rendering scalability
- Simulation update consistency
- Multiplayer synchronization behavior

Establish realistic performance targets using measured baseline results and specified test hardware.

Do not invent benchmark improvements.

### TEST COVERAGE

Include:

- Unit tests
- Deterministic physics regression tests
- Integration tests
- Browser-based end-to-end tests
- Multiplayer validation
- Visual regression checks
- Audio behavior checks
- Configuration validation
- Performance regression measurements

Use automated testing where technically appropriate and documented manual verification where automation is insufficient.

Implement a repeatable build and test workflow.

---

## 13. PROJECT INTEGRITY & DEVELOPMENT CONTROL

Preserve the existing AeroStrike source code and working gameplay systems.

### DEVELOPMENT RULES

1. Never rewrite the entire project without documented technical justification.
2. Develop on isolated Git branches.
3. Preserve a known-working baseline.
4. Review architectural dependencies before changing shared systems.
5. Prefer minimal, testable modifications.
6. Maintain backward compatibility where practical.
7. Separate simulation, rendering, UI, networking, assets, and audio.
8. Document breaking changes and migrations.
9. Do not introduce incomplete features as finished functionality.
10. Do not proceed automatically to unrelated development stages.

### IMPLEMENTATION ORDER

**Phase 0 — Repository Audit**

Inspect the complete source, identify technical gaps, and establish the baseline.

**Phase 1 — Simulation Foundation**

Correct timing, state consistency, physics update separation, and regression testing.

**Phase 2 — Aircraft Flight Dynamics**

Implement distinct vehicle-class behaviors and refine flight-mode handling.

**Phase 3 — Engineering Hangar**

Develop configuration management, 3D inspection, and game-defined equipment compatibility.

**Phase 4 — Damage & Combat Gameplay**

Implement component damage and differentiated virtual equipment behavior.

**Phase 5 — Visual & Audio Fidelity**

Improve assets, rendering, spatial audio, and environmental presentation.

**Phase 6 — Aerospace & Spaceflight**

Introduce the independent high-altitude and spaceflight simulation experience.

**Phase 7 — Mission Scenario Laboratory**

Implement scenario creation, environment integration, and replay analysis.

**Phase 8 — Multiplayer & Release Quality**

Strengthen server authority, synchronization, regression testing, and performance readiness.

Each phase requires documented acceptance criteria before it can be considered complete.

---

## 14. FIRST REQUIRED DELIVERY

**Initial execution mode: READ-ONLY ARCHITECTURAL AUDIT.**

Inspect the actual AeroStrike repository.

Produce:

1. Verified architecture map
2. Source-backed feature inventory
3. Confirmed implementation gaps
4. Risk and dependency analysis
5. Proposed module boundaries
6. Technical migration strategy
7. Test and performance baseline plan
8. Phase-by-phase acceptance criteria
9. Recommended first implementation changes

Do not modify the repository during this delivery.

Do not claim readiness based on descriptions, comments, or passing isolated tests alone.

Wait for explicit authorization before beginning implementation.

---

## FINAL SUCCESS CRITERION

AeroStrike must evolve into a coherent aerial and aerospace simulation game in which each major feature has a functional, testable implementation.

The project must demonstrate:

**Physical consistency, vehicle individuality, engineering coherence, immersive audiovisual quality, gameplay depth, measured performance, and independently verifiable functionality.**

No feature may be declared complete solely because it looks impressive.

**ENGINEERING EVIDENCE TAKES PRIORITY OVER PRESENTATION.**
