export type MissionPhaseId =
  | 'deployment'
  | 'recon'
  | 'aerial_encounter'
  | 'ground_activity'
  | 'resolution';

export interface MissionPhaseCopy {
  phaseNumber: 1 | 2 | 3 | 4 | 5;
  title: string;
  objective: string;
}

export const MISSION_PHASE_COPY: Record<MissionPhaseId, MissionPhaseCopy> = {
  deployment: {
    phaseNumber: 1,
    title: 'Ingress & Patrol Corridor',
    objective: 'Advance north into Sector 04 operational airspace (Z < 450m)',
  },
  recon: {
    phaseNumber: 2,
    title: 'EO/IR Reconnaissance',
    objective: 'Switch to EO/IR [U] or lock contacts and mark 2 ground threats [T]',
  },
  aerial_encounter: {
    phaseNumber: 3,
    title: 'Aerial Encounter',
    objective: 'Intercept hostile Bravo UAV patrol in the corridor',
  },
  ground_activity: {
    phaseNumber: 4,
    title: 'Convoy & Ground Strike',
    objective: 'Neutralize moving armored convoy and remaining hostile batteries',
  },
  resolution: {
    phaseNumber: 5,
    title: 'Sortie Complete',
    objective: 'All sector objectives neutralized — airspace secured',
  },
};

export interface MissionDirectorState {
  phase: MissionPhaseId;
  phaseNumber: 1 | 2 | 3 | 4 | 5;
  title: string;
  objective: string;
  markedTargetIds: string[];
  requiredReconMarks: number;
  reconScanTargetId: string | null;
  reconScanProgress: number;
  airKillsCount: number;
  groundKillsCount: number;
  phaseStartedAtSec: number;
  phasesCompleted: MissionPhaseId[];
}

export function createInitialMissionState(): MissionDirectorState {
  const copy = MISSION_PHASE_COPY.deployment;
  return {
    phase: 'deployment',
    phaseNumber: copy.phaseNumber,
    title: copy.title,
    objective: copy.objective,
    markedTargetIds: [],
    requiredReconMarks: 2,
    reconScanTargetId: null,
    reconScanProgress: 0,
    airKillsCount: 0,
    groundKillsCount: 0,
    phaseStartedAtSec: 0,
    phasesCompleted: [],
  };
}

function transitionTo(state: MissionDirectorState, next: MissionPhaseId, simTimeSec: number): MissionPhaseId | null {
  if (state.phase === next) return null;
  if (!state.phasesCompleted.includes(state.phase)) {
    state.phasesCompleted.push(state.phase);
  }
  const copy = MISSION_PHASE_COPY[next];
  state.phase = next;
  state.phaseNumber = copy.phaseNumber;
  state.title = copy.title;
  state.objective = copy.objective;
  state.phaseStartedAtSec = simTimeSec;
  return next;
}

export interface MissionStepContext {
  simTimeSec: number;
  droneZ: number;
  cameraEoirMode: boolean;
  aliveLandmarksCount: number;
  convoyAlive: boolean;
  gameOverVictory: boolean;
}

/**
 * Advances the 5-phase Combined Aerial Warfare mission flow cleanly without locking out player agency.
 * Returns the new MissionPhaseId if a phase transition occurred this tick.
 */
export function evaluateMissionTransitions(
  state: MissionDirectorState,
  ctx: MissionStepContext,
): MissionPhaseId | null {
  if (ctx.gameOverVictory || ctx.aliveLandmarksCount === 0) {
    return transitionTo(state, 'resolution', ctx.simTimeSec);
  }

  if (state.phase === 'deployment') {
    const enteredZone = ctx.droneZ < 450 || ctx.simTimeSec >= 5.5;
    const earlyAction =
      ctx.cameraEoirMode ||
      state.markedTargetIds.length > 0 ||
      state.airKillsCount > 0 ||
      state.groundKillsCount > 0;
    if (enteredZone || earlyAction) {
      return transitionTo(state, 'recon', ctx.simTimeSec);
    }
  }

  if (state.phase === 'recon') {
    if (state.markedTargetIds.length >= state.requiredReconMarks || state.groundKillsCount >= 2) {
      if (state.airKillsCount >= 1) {
        return transitionTo(state, 'ground_activity', ctx.simTimeSec);
      }
      return transitionTo(state, 'aerial_encounter', ctx.simTimeSec);
    }
  }

  if (state.phase === 'aerial_encounter') {
    if (state.airKillsCount >= 1 || (!ctx.convoyAlive && ctx.aliveLandmarksCount <= 2) || state.groundKillsCount >= 3) {
      return transitionTo(state, 'ground_activity', ctx.simTimeSec);
    }
  }

  if (state.phase === 'ground_activity') {
    if (ctx.aliveLandmarksCount === 0) {
      return transitionTo(state, 'resolution', ctx.simTimeSec);
    }
  }

  return null;
}

export function markMissionTarget(
  state: MissionDirectorState,
  targetId: string,
): { newlyMarked: boolean; totalMarked: number } {
  if (!targetId || state.markedTargetIds.includes(targetId)) {
    return { newlyMarked: false, totalMarked: state.markedTargetIds.length };
  }
  state.markedTargetIds.push(targetId);
  if (state.reconScanTargetId === targetId) {
    state.reconScanTargetId = null;
    state.reconScanProgress = 0;
  }
  return { newlyMarked: true, totalMarked: state.markedTargetIds.length };
}
