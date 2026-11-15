import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CyberWarfareModal } from './components/CyberWarfareModal';
import { FlightHud } from './components/FlightHud';
import { HangarSandboxModal } from './components/HangarSandboxModal';
import { MultiplayerModal } from './components/MultiplayerModal';
import { OrdnanceInfographicsModal } from './components/OrdnanceInfographicsModal';
import { PauseAndDebriefModal } from './components/PauseAndDebriefModal';
import { SettingsModal } from './components/SettingsModal';
import { TacticalGeoMapModal } from './components/TacticalGeoMapModal';
import { ThreatWarningOverlay } from './components/ThreatWarningOverlay';
import { TitleScreen } from './components/TitleScreen';
import { WeatherSolarModal } from './components/WeatherSolarModal';
import { FlightViewport, SimCommandBridge } from './engine/FlightViewport';
import { GameSettings, loadSettings, saveSettings } from './sim/settings';
import { AIRFRAMES, DEFAULT_LOADOUT } from './sim/arsenalData';
import {
  AarEventType,
  AarSortieReport,
  appendAarEvent,
  appendAarSample,
  createAarReport,
} from './sim/aarLogger';
import { CYBER_PAYLOADS } from './sim/cyberWarfare';
import { THEATERS } from './sim/geoTheaters';
import {
  awardSortieRewards,
  computePilotSkillBonuses,
  loadProgression,
  PILOT_SKILLS,
  resetPilotSkills,
  saveProgression,
  unlockTechItem,
  upgradePilotSkill,
} from './sim/progression';
import {
  CameraMode,
  CyberPayloadId,
  DroneFlightState,
  GamePhase,
  HudSnapshot,
  KillFeedEntry,
  LoadoutConfig,
  PilotProgression,
  PilotSkillId,
  RemotePilotState,
  SandboxConfig,
  TheaterId,
  WeaponId,
  WeatherId,
} from './sim/types';

const INITIAL_SANDBOX: SandboxConfig = {
  enabled: false,
  gravityMultiplier: 1.0,
  airDensityMultiplier: 1.0,
  thrustMultiplier: 1.0,
  wingAreaMultiplier: 1.0,
  massMultiplier: 1.0,
  guidanceGainMultiplier: 1.0,
  timeScale: 1.0,
  infiniteAmmo: false,
  unlockAllInSandbox: false,
};

const INITIAL_HUD: HudSnapshot = {
  airspeedKnots: 178,
  mach: 0.27,
  altitudeMsl: 1120,
  altitudeAgl: 420,
  headingDeg: 0,
  pitchDeg: 1,
  rollDeg: 0,
  gLoad: 1.0,
  throttlePct: 72,
  hp: 120,
  maxHp: 120,
  fuelPct: 100,
  stalling: false,
  activeSlot: 0,
  slotAmmo: [4, 4, 2, 60],
  slotCooldowns: [0, 0, 0, 0],
  lockedTargetId: 'ed-radar',
  lockedTargetKind: 'base',
  lockedTargetName: 'Rogers Dry Lake Control',
  lockedTargetDistM: 1150,
  lockedTargetHpPct: 100,
  lockedTargetCompromisedSec: 0,
  incomingCyberThreat: null,
  playerCyberDisruptedSec: 0,
  cyberCooldownSec: 0,
  predictedCepM: 2,
  predictedApogeeM: 1150,
  score: 0,
  targetsDestroyed: 0,
  totalTargets: 6,
  localGravityMs2: 9.8,
  solarElevationDeg: 62,
  solarChargeW: 480,
  windSpeedKnots: 8,
  sortieTimeSec: 0,
  missilesIncoming: 0,
  radarLocked: false,
  flaresRemaining: 12,
  flareCooldownSec: 0,
  mouseAimScreenX: 50,
  mouseAimScreenY: 50,
  noseScreenX: 50,
  noseScreenY: 50,
  targetScreenX: null,
  targetScreenY: null,
  leadScreenX: null,
  leadScreenY: null,
  zoomed: false,
  wepActive: false,
  kamikazeArmed: false,
  kamikazeCapable: true,
  reserveDrones: 3,
  blueTickets: 1000,
  redTickets: 1000,
  freeLooking: false,
  combatHitCallout: null,
  airContacts: [],
};

export default function App() {
  const autostart =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const [phase, setPhase] = useState<GamePhase>(autostart ? 'playing' : 'title');
  const [theaterId, setTheaterId] = useState<TheaterId>('edwards');
  const [weatherId, setWeatherId] = useState<WeatherId>('clear');
  const [utcHours, setUtcHours] = useState<number>(19.2);
  const [loadout, setLoadout] = useState<LoadoutConfig>(DEFAULT_LOADOUT);
  const [sandbox, setSandbox] = useState<SandboxConfig>(INITIAL_SANDBOX);
  const [settings, setSettings] = useState<GameSettings>(() => loadSettings());
  const [cameraMode, setCameraMode] = useState<CameraMode>('chase');
  const [muted, setMuted] = useState(false);

  const [progression, setProgression] = useState<PilotProgression>(() => loadProgression());
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [dronePos, setDronePos] = useState<{ x: number; z: number; alt: number }>({
    x: 0,
    z: 950,
    alt: 1120,
  });

  // Modals
  const [showHangar, setShowHangar] = useState(false);
  const [showGeoMap, setShowGeoMap] = useState(false);
  const [showInfographics, setShowInfographics] = useState(false);
  const [showWeatherSolar, setShowWeatherSolar] = useState(false);
  const [showMultiplayer, setShowMultiplayer] = useState(false);
  const [showCyberDeck, setShowCyberDeck] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selfArenaId, setSelfArenaId] = useState<string | null>(null);

  // End-of-sortie summary
  const [debrief, setDebrief] = useState<{
    victory: boolean;
    summary: {
      score: number;
      targetsDestroyed: number;
      totalTargets: number;
      bestCep: number | null;
      xpEarned: number;
      rcEarned: number;
    };
  } | null>(null);

  // After Action Report (AAR) Flight Recorder State
  const [aarReport, setAarReport] = useState<AarSortieReport>(() => {
    const base = createAarReport(
      'edwards',
      DEFAULT_LOADOUT.airframeId,
      AIRFRAMES[DEFAULT_LOADOUT.airframeId].maxFuelKg,
    );
    return appendAarEvent(base, {
      tSec: 0,
      type: 'launch',
      title: 'Sortie Airborne',
      detail: `${AIRFRAMES[DEFAULT_LOADOUT.airframeId].name} launched in ${THEATERS.edwards.name.split('/')[0]}`,
      x: 0,
      z: 950,
      altMsl: THEATERS.edwards.baseElevationM + 420,
      fuelKg: AIRFRAMES[DEFAULT_LOADOUT.airframeId].maxFuelKg,
    });
  });

  // Multiplayer WebSocket State
  const [callsign, setCallsign] = useState(() => `PILOT-${Math.floor(100 + Math.random() * 899)}`);
  const [wsConnected, setWsConnected] = useState(false);
  const [remotePilots, setRemotePilots] = useState<RemotePilotState[]>([]);
  const [killFeed, setKillFeed] = useState<KillFeedEntry[]>([]);

  const bridgeRef = useRef<SimCommandBridge | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const pushKillFeed = useCallback((text: string, kind: KillFeedEntry['kind'] = 'system') => {
    setKillFeed((prev) => [
      { id: `${Date.now()}-${Math.random()}`, text, timestamp: Date.now(), kind },
      ...prev.slice(0, 4),
    ]);
  }, []);

  // Mirror phase to document.body.dataset.state
  useEffect(() => {
    document.body.dataset.state = phase;
  }, [phase]);

  // Persist progression & settings
  useEffect(() => {
    saveProgression(progression);
  }, [progression]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // WebSocket Multiplayer Client with auto-reconnect
  useEffect(() => {
    let closedByUnmount = false;
    let reconnectTimer: number | undefined;

    const connect = () => {
      if (closedByUnmount) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        ws.send(
          JSON.stringify({
            type: 'arena:join',
            theaterId,
            callsign,
            airframeId: loadout.airframeId,
            maxHp: AIRFRAMES[loadout.airframeId].maxHp,
          }),
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
          const type = String(msg.type ?? '');

          if (type === 'arena:init') {
            if (typeof msg.selfId === 'string') setSelfArenaId(msg.selfId);
            setRemotePilots((msg.pilots as RemotePilotState[]) ?? []);
            if (msg.targetHp && bridgeRef.current) {
              bridgeRef.current.applyTargetHpSync(msg.targetHp as Record<string, number>);
            }
          } else if (type === 'pilot:joined') {
            const p = msg.pilot as RemotePilotState;
            if (!p) return;
            setRemotePilots((prev) =>
              prev.some((x) => x.id === p.id) ? prev : [...prev, p],
            );
            pushKillFeed(`${p.callsign} entered ${THEATERS[theaterId].name.split('/')[0]}`, 'system');
          } else if (type === 'pilot:left') {
            const leftId = String(msg.id ?? '');
            setRemotePilots((prev) => prev.filter((p) => p.id !== leftId));
          } else if (type === 'pilot:state') {
            const id = String(msg.id ?? '');
            setRemotePilots((prev) =>
              prev.map((p) =>
                p.id === id
                  ? {
                      ...p,
                      x: Number(msg.x),
                      y: Number(msg.y),
                      z: Number(msg.z),
                      vx: Number(msg.vx),
                      vy: Number(msg.vy),
                      vz: Number(msg.vz),
                      pitch: Number(msg.pitch),
                      yaw: Number(msg.yaw),
                      roll: Number(msg.roll),
                      hp: Number(msg.hp),
                      airframeId: (msg.airframeId as LoadoutConfig['airframeId']) || p.airframeId,
                    }
                  : p,
              ),
            );
          } else if (type === 'ordnance:fire') {
            bridgeRef.current?.spawnRemoteOrdnance({
              ownerId: String(msg.ownerId),
              weaponId: msg.weaponId as WeaponId,
              x: Number(msg.x),
              y: Number(msg.y),
              z: Number(msg.z),
              vx: Number(msg.vx),
              vy: Number(msg.vy),
              vz: Number(msg.vz),
              targetX: Number(msg.targetX),
              targetY: Number(msg.targetY),
              targetZ: Number(msg.targetZ),
            });
          } else if (type === 'target:hp') {
            const tid = String(msg.targetId ?? '');
            const hp = Number(msg.hp ?? 0);
            bridgeRef.current?.applyTargetHpSync({ [tid]: hp });
            if (hp === 0) {
              pushKillFeed(`${String(msg.attackerCallsign ?? 'Allied')} destroyed target`, 'strike');
            }
          } else if (type === 'target:reset') {
            if (msg.targetHp) {
              bridgeRef.current?.applyTargetHpSync(msg.targetHp as Record<string, number>);
              pushKillFeed('Theater targets respawned', 'system');
            }
          } else if (type === 'env:sync') {
            if (typeof msg.weatherId === 'string') setWeatherId(msg.weatherId as WeatherId);
            if (typeof msg.utcHours === 'number') setUtcHours(msg.utcHours);
          } else if (type === 'cyber:attack') {
            const payloadId = String(msg.payloadId ?? 'radar_spoof') as CyberPayloadId;
            const attacker = String(msg.attackerCallsign ?? 'Hostile UAV');
            const targetId = String(msg.targetId ?? '');
            const spec = CYBER_PAYLOADS[payloadId];
            if (targetId && selfArenaId && targetId === selfArenaId) {
              bridgeRef.current?.receiveRemoteCyberAttack(payloadId, attacker);
              pushKillFeed(`${attacker} launched ${spec.name} at you!`, 'system');
            } else {
              pushKillFeed(`${attacker} executed ${spec.name}`, 'system');
            }
          }
        } catch {
          // Ignore malformed ws packet
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!closedByUnmount) {
          reconnectTimer = window.setTimeout(connect, 2500);
        }
      };
    };

    connect();

    return () => {
      closedByUnmount = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [theaterId, callsign, loadout.airframeId, selfArenaId, pushKillFeed]);

  const anyModalOpen =
    showHangar ||
    showGeoMap ||
    showInfographics ||
    showWeatherSolar ||
    showMultiplayer ||
    showCyberDeck ||
    showSettings;

  // Global keyboard shortcuts for HUD/Pause/Modals
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'Escape') {
        if (anyModalOpen) {
          setShowHangar(false);
          setShowGeoMap(false);
          setShowInfographics(false);
          setShowWeatherSolar(false);
          setShowMultiplayer(false);
          setShowCyberDeck(false);
          setShowSettings(false);
        } else if (phase === 'playing') {
          setPhase('paused');
        } else if (phase === 'paused') {
          setPhase('playing');
        }
      } else if (e.code === 'KeyP' && (phase === 'playing' || phase === 'paused') && !anyModalOpen) {
        setPhase((prev) => (prev === 'playing' ? 'paused' : 'playing'));
      } else if (e.code === 'KeyM') {
        setMuted((m) => !m);
      } else if (e.code === 'KeyO') {
        setShowSettings((s) => !s);
      } else if (e.code === 'KeyU' && phase === 'playing' && !anyModalOpen) {
        setCameraMode((prev) => (prev === 'chase' ? 'eoir' : prev === 'eoir' ? 'orbit' : 'chase'));
      } else if (e.code === 'KeyH' && phase !== 'title') {
        setShowHangar((s) => !s);
      } else if (e.code === 'KeyG' && phase !== 'title') {
        setShowGeoMap((s) => !s);
      } else if (e.code === 'KeyI' && phase !== 'title') {
        setShowInfographics((s) => !s);
      } else if (e.code === 'KeyV' && phase !== 'title') {
        setShowWeatherSolar((s) => !s);
      } else if (e.code === 'KeyK' && phase !== 'title') {
        setShowCyberDeck((s) => !s);
      } else if (e.code === 'KeyX' && phase === 'playing' && !anyModalOpen) {
        if (bridgeRef.current?.purgeCyberIntrusion()) {
          pushKillFeed('Rotated C2 Encryption Keys — Intrusion Purged', 'system');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, anyModalOpen, pushKillFeed]);

  const resetAarForSortie = useCallback(
    (tId: TheaterId, afId: LoadoutConfig['airframeId']) => {
      const af = AIRFRAMES[afId];
      const th = THEATERS[tId];
      let fresh = createAarReport(tId, afId, af.maxFuelKg);
      fresh = appendAarSample(
        fresh,
        {
          tSec: 0,
          x: 0,
          yMsl: th.baseElevationM + 420,
          z: 950,
          aglM: 420,
          airspeedKnots: 178,
          mach: 0.27,
          fuelKg: af.maxFuelKg,
          fuelPct: 100,
          hp: af.maxHp,
          throttlePct: 72,
          gLoad: 1.0,
        },
        0,
      );
      setAarReport(
        appendAarEvent(fresh, {
          tSec: 0,
          type: 'launch',
          title: 'Sortie Airborne',
          detail: `${af.name} launched in ${th.name.split('/')[0]}`,
          x: 0,
          z: 950,
          altMsl: th.baseElevationM + 420,
          fuelKg: af.maxFuelKg,
        }),
      );
    },
    [],
  );

  const handleStartMission = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setDebrief(null);
    resetAarForSortie(theaterId, loadout.airframeId);
    bridgeRef.current?.resetSortie(theaterId);
    setPhase('playing');
  }, [theaterId, loadout.airframeId, resetAarForSortie]);

  const handleSelectTheater = useCallback(
    (id: TheaterId) => {
      setTheaterId(id);
      setWeatherId(THEATERS[id].defaultWeather);
      resetAarForSortie(id, loadout.airframeId);
      bridgeRef.current?.resetSortie(id);
    },
    [loadout.airframeId, resetAarForSortie],
  );

  const handleUnlockItem = useCallback(
    (cat: 'airframe' | 'propulsion' | 'sensor' | 'weapon' | 'cyber', id: string) => {
      setProgression((prev) => {
        const res = unlockTechItem(prev, cat, id);
        if (res.ok) {
          pushKillFeed(`Unlocked ${id.toUpperCase()}`, 'system');
        }
        return res.progression;
      });
    },
    [pushKillFeed],
  );

  const skillBonuses = useMemo(() => computePilotSkillBonuses(progression), [progression]);

  const handleUpgradeSkill = useCallback(
    (skillId: PilotSkillId) => {
      setProgression((prev) => {
        const res = upgradePilotSkill(prev, skillId);
        if (res.ok) {
          const spec = PILOT_SKILLS[skillId];
          const lvl = res.progression.skillLevels[skillId] ?? 1;
          pushKillFeed(`Trained ${spec.name} (Lv ${lvl})`, 'system');
        }
        return res.progression;
      });
    },
    [pushKillFeed],
  );

  const handleResetSkills = useCallback(() => {
    setProgression((prev) => resetPilotSkills(prev));
    pushKillFeed('Reset Pilot Skill Specializations', 'system');
  }, [pushKillFeed]);

  const handleCyberSuccess = useCallback(
    (info: {
      targetId: string;
      targetName: string;
      targetKind: 'base' | 'drone';
      payloadId: CyberPayloadId;
      damageDealt: number;
      destroyed: boolean;
      isRemotePilot: boolean;
    }) => {
      const spec = CYBER_PAYLOADS[info.payloadId];
      pushKillFeed(`CYBER BREACH: ${spec.name} → ${info.targetName}`, 'system');
      setProgression((prev) =>
        awardSortieRewards(prev, {
          xpEarned: 140 + info.damageDealt,
          rcEarned: 95 + Math.round(info.damageDealt * 0.5),
          cyberBreaches: 1,
        }),
      );
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'cyber:attack',
            targetId: info.targetId,
            payloadId: info.payloadId,
            damageDealt: info.damageDealt,
          }),
        );
      }
    },
    [pushKillFeed],
  );

  const handleTargetDestroyed = useCallback(
    (info: { targetId: string; name: string; points: number; cepMeters: number; weaponId: WeaponId }) => {
      pushKillFeed(`Destroyed ${info.name} (CEP ${info.cepMeters}m)`, 'strike');
      setProgression((prev) =>
        awardSortieRewards(prev, {
          xpEarned: info.points,
          rcEarned: Math.round(info.points * 0.65),
          groundStrikes: 1,
          cepMeters: info.cepMeters,
        }),
      );
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: 'target:damage', targetId: info.targetId, damage: 999 }),
        );
      }
    },
    [pushKillFeed],
  );

  const handleAirKill = useCallback(
    (info: { victimName: string; points: number; weaponId: WeaponId }) => {
      pushKillFeed(`Air Kill: ${info.victimName}`, 'air');
      setProgression((prev) =>
        awardSortieRewards(prev, {
          xpEarned: info.points,
          rcEarned: Math.round(info.points * 0.8),
          kills: 1,
        }),
      );
    },
    [pushKillFeed],
  );

  const handleGameOver = useCallback(
    (
      victory: boolean,
      summary: { score: number; targetsDestroyed: number; totalTargets: number; bestCep: number | null },
    ) => {
      const xpEarned = victory ? 500 + summary.score : Math.round(summary.score * 0.4);
      const rcEarned = victory ? 350 + Math.round(summary.score * 0.5) : Math.round(summary.score * 0.25);
      setProgression((prev) =>
        awardSortieRewards(prev, {
          xpEarned,
          rcEarned,
          cepMeters: summary.bestCep,
          completed: victory,
        }),
      );
      setDebrief({
        victory,
        summary: { ...summary, xpEarned, rcEarned },
      });
      setPhase('gameover');
    },
    [],
  );

  const handleAarEvent = useCallback(
    (ev: {
      type: AarEventType;
      title: string;
      detail: string;
      tSec: number;
      x: number;
      z: number;
      altMsl: number;
      fuelKg: number;
    }) => {
      setAarReport((prev) => appendAarEvent(prev, ev));
    },
    [],
  );

  const handleBroadcastState = useCallback(
    (d: DroneFlightState, sortieTimeSec: number) => {
      setDronePos({ x: d.x, z: d.z, alt: d.y });
      const baseElev = THEATERS[theaterId].baseElevationM;
      setAarReport((prev) =>
        appendAarSample(
          prev,
          {
            tSec: Number(sortieTimeSec.toFixed(1)),
            x: Math.round(d.x),
            yMsl: Math.round(d.y + baseElev),
            z: Math.round(d.z),
            aglM: Math.round(d.aglMeters),
            airspeedKnots: Math.round(d.airspeedMs * 1.94384),
            mach: Number(d.mach.toFixed(2)),
            fuelKg: Math.round(d.fuelKg * 10) / 10,
            fuelPct: Math.round((d.fuelKg / Math.max(1, d.maxFuelKg)) * 100),
            hp: Math.round(d.hp),
            throttlePct: Math.round(d.throttle * 100),
            gLoad: Number(d.gLoad.toFixed(1)),
          },
          0.18,
        ),
      );
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'pilot:state',
            x: d.x,
            y: d.y,
            z: d.z,
            vx: d.vx,
            vy: d.vy,
            vz: d.vz,
            pitch: d.pitch,
            yaw: d.yaw,
            roll: d.roll,
            hp: d.hp,
            airframeId: loadout.airframeId,
          }),
        );
      }
    },
    [loadout.airframeId, theaterId],
  );

  const handleOrdnanceFired = useCallback(
    (ord: {
      weaponId: WeaponId;
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      targetX: number;
      targetY: number;
      targetZ: number;
    }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ordnance:fire', ...ord }));
      }
    },
    [],
  );

  const effectiveSimPhase: GamePhase = anyModalOpen && phase === 'playing' ? 'paused' : phase;

  return (
    <main className="relative w-full h-full overflow-hidden bg-[#080c10]">
      {/* Isolated 3D WebGL Flight & Ballistics Viewport */}
      <FlightViewport
        phase={effectiveSimPhase}
        theaterId={theaterId}
        weatherId={weatherId}
        utcHours={utcHours}
        loadout={loadout}
        sandbox={sandbox}
        settings={settings}
        skillBonuses={skillBonuses}
        cameraMode={cameraMode}
        muted={muted}
        remotePilots={remotePilots}
        bridgeRef={bridgeRef}
        onHudUpdate={setHud}
        onTargetDestroyed={handleTargetDestroyed}
        onAirKill={handleAirKill}
        onCyberSuccess={handleCyberSuccess}
        onAarEvent={handleAarEvent}
        onPlayerStateBroadcast={handleBroadcastState}
        onOrdnanceFired={handleOrdnanceFired}
        onGameOver={handleGameOver}
      />

      {/* Title Screen Stage */}
      {phase === 'title' && !anyModalOpen && (
        <TitleScreen
          theaterId={theaterId}
          weatherId={weatherId}
          airframeId={loadout.airframeId}
          pilotRank={progression.rank}
          pilotsOnline={remotePilots.length + 1}
          onStartMission={handleStartMission}
          onOpenHangar={() => setShowHangar(true)}
          onOpenGeoMap={() => setShowGeoMap(true)}
          onOpenMultiplayer={() => setShowMultiplayer(true)}
          onOpenSettings={() => setShowSettings(true)}
          onSelectTheater={handleSelectTheater}
        />
      )}

      {/* Active Flight HUD & Screen-Edge Threat Warning Overlay */}
      {phase === 'playing' && !anyModalOpen && (
        <ThreatWarningOverlay
          hud={hud}
          onPurgeCyber={() => {
            if (bridgeRef.current?.purgeCyberIntrusion()) {
              pushKillFeed('Rotated C2 Encryption Keys — Intrusion Purged', 'system');
            }
          }}
          onDeployFlares={() => {
            bridgeRef.current?.deployFlares();
          }}
        />
      )}

      {phase === 'playing' && (
        <FlightHud
          hud={hud}
          theaterId={theaterId}
          weatherId={weatherId}
          loadout={loadout}
          sandbox={sandbox}
          settings={settings}
          cameraMode={cameraMode}
          muted={muted}
          wsConnected={wsConnected}
          remotePilotCount={remotePilots.length}
          killFeed={killFeed}
          onToggleMute={() => setMuted((m) => !m)}
          onPause={() => setPhase('paused')}
          onOpenHangar={() => setShowHangar(true)}
          onOpenGeoMap={() => setShowGeoMap(true)}
          onOpenInfographics={() => setShowInfographics(true)}
          onOpenWeatherSolar={() => setShowWeatherSolar(true)}
          onOpenMultiplayer={() => setShowMultiplayer(true)}
          onOpenCyber={() => setShowCyberDeck(true)}
          onOpenSettings={() => setShowSettings(true)}
          onDeployFlares={() => {
            bridgeRef.current?.deployFlares();
          }}
          onArmKamikaze={() => {
            bridgeRef.current?.armKamikazeDive();
          }}
          onCycleCamera={() =>
            setCameraMode((prev) => (prev === 'chase' ? 'eoir' : prev === 'eoir' ? 'orbit' : 'chase'))
          }
          onSelectSlot={(s) => bridgeRef.current?.setActiveSlot(s)}
          onFire={() => bridgeRef.current?.fireActiveOrdnance()}
          onCycleTarget={() => bridgeRef.current?.cycleTarget()}
        />
      )}

      {/* Pause & Sortie Debrief Modals */}
      {!anyModalOpen && (
        <PauseAndDebriefModal
          phase={phase}
          victory={debrief?.victory ?? false}
          summary={debrief?.summary ?? null}
          aarReport={aarReport}
          onResume={() => setPhase('playing')}
          onRestart={handleStartMission}
          onOpenHangar={() => setShowHangar(true)}
          onReturnTitle={() => {
            setDebrief(null);
            setPhase('title');
          }}
        />
      )}

      {/* Modular Hangar, Tech Progression & Sandbox Lab */}
      <HangarSandboxModal
        open={showHangar}
        loadout={loadout}
        progression={progression}
        skillBonuses={skillBonuses}
        sandbox={sandbox}
        onChangeLoadout={setLoadout}
        onChangeSandbox={setSandbox}
        onUnlockItem={handleUnlockItem}
        onUpgradeSkill={handleUpgradeSkill}
        onResetSkills={handleResetSkills}
        onApplyAndLaunch={() => {
          setShowHangar(false);
          if (phase === 'title' || phase === 'gameover') {
            handleStartMission();
          }
        }}
        onLaunchSandboxTestFlight={() => {
          setSandbox((prev) => ({
            ...prev,
            enabled: true,
            infiniteAmmo: true,
            unlockAllInSandbox: true,
          }));
          setShowHangar(false);
          pushKillFeed('Launched Sandbox Test Flight (All Gear & ∞ Ammo)', 'system');
          handleStartMission();
        }}
        onClose={() => setShowHangar(false)}
      />

      {/* Military Ordnance & Flight Profile Infographics */}
      <OrdnanceInfographicsModal
        open={showInfographics}
        onClose={() => setShowInfographics(false)}
      />

      {/* Real-World Topographical & Satellite Relief Mission Map */}
      <TacticalGeoMapModal
        open={showGeoMap}
        theaterId={theaterId}
        dronePos={{ x: dronePos.x, z: dronePos.z }}
        onSelectTheater={handleSelectTheater}
        onSetWaypoint={(x, z) => {
          bridgeRef.current?.setWaypointTarget(x, z);
          pushKillFeed('CCRP Strike Waypoint Designated', 'system');
        }}
        onClose={() => setShowGeoMap(false)}
      />

      {/* Dynamic Weather & Solar-Gravitational Deck */}
      <WeatherSolarModal
        open={showWeatherSolar}
        theaterId={theaterId}
        weatherId={weatherId}
        utcHours={utcHours}
        altitudeM={dronePos.alt}
        onSelectWeather={(id) => {
          setWeatherId(id);
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'env:sync', weatherId: id, utcHours }));
          }
        }}
        onChangeUtcHours={(h) => {
          setUtcHours(h);
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'env:sync', weatherId, utcHours: h }));
          }
        }}
        onClose={() => setShowWeatherSolar(false)}
      />

      {/* WebSocket Multiplayer Combat Arenas */}
      <MultiplayerModal
        open={showMultiplayer}
        wsConnected={wsConnected}
        callsign={callsign}
        theaterId={theaterId}
        remotePilots={remotePilots}
        onChangeCallsign={setCallsign}
        onJoinArena={(id) => {
          handleSelectTheater(id);
          setShowMultiplayer(false);
          if (phase === 'title') {
            setPhase('playing');
          }
        }}
        onResetArenaTargets={() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'arena:reset_targets' }));
          } else {
            bridgeRef.current?.resetSortie(theaterId);
          }
        }}
        onClose={() => setShowMultiplayer(false)}
      />

      {/* Cyber Warfare & EW Intrusion Deck */}
      <CyberWarfareModal
        open={showCyberDeck}
        targets={showCyberDeck ? bridgeRef.current?.getCyberTargets() ?? [] : []}
        initialTargetId={hud.lockedTargetId}
        loadout={loadout}
        weatherId={weatherId}
        progression={progression}
        sandbox={sandbox}
        cooldownSec={hud.cyberCooldownSec}
        onExecuteAttack={(targetId, payloadId) =>
          bridgeRef.current?.triggerCyberAttack(targetId, payloadId) ?? {
            ok: false,
            message: 'Simulation offline.',
          }
        }
        onClose={() => setShowCyberDeck(false)}
      />

      {/* Controls, Graphics & Gameplay Customization */}
      <SettingsModal
        open={showSettings}
        settings={settings}
        onChangeSettings={setSettings}
        onClose={() => setShowSettings(false)}
      />
    </main>
  );
}
