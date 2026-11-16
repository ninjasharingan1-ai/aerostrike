import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { THEATERS } from './src/sim/geoTheaters.ts';
import type { AirframeId, CyberPayloadId, TheaterId, WeaponId, WeatherId } from './src/sim/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ServerPilot {
  id: string;
  callsign: string;
  theaterId: TheaterId;
  airframeId: AirframeId;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  pitch: number;
  yaw: number;
  roll: number;
  hp: number;
  maxHp: number;
  kills: number;
  team: 'alpha' | 'bravo';
  lastSeen: number;
}

interface ArenaRoomState {
  theaterId: TheaterId;
  weatherId: WeatherId;
  utcHours: number;
  targetHp: Record<string, number>;
}

const rooms = new Map<TheaterId, ArenaRoomState>();

function getOrCreateRoom(theaterId: TheaterId): ArenaRoomState {
  const existing = rooms.get(theaterId);
  if (existing) return existing;
  const spec = THEATERS[theaterId] ?? THEATERS.edwards;
  const targetHp: Record<string, number> = {};
  for (const lm of spec.landmarks) {
    targetHp[lm.id] = lm.maxHp;
  }
  const room: ArenaRoomState = {
    theaterId: spec.id,
    weatherId: spec.defaultWeather,
    utcHours: 19.0,
    targetHp,
  };
  rooms.set(spec.id, room);
  return room;
}

for (const id of Object.keys(THEATERS) as TheaterId[]) {
  getOrCreateRoom(id);
}

const pilots = new Map<string, ServerPilot>();
const clientSockets = new Map<WebSocket, string>();

function broadcastToRoom(theaterId: TheaterId, payload: unknown, excludeWs?: WebSocket) {
  const msg = JSON.stringify(payload);
  for (const [ws, pilotId] of clientSockets.entries()) {
    if (ws === excludeWs || ws.readyState !== WebSocket.OPEN) continue;
    const pilot = pilots.get(pilotId);
    if (pilot && pilot.theaterId === theaterId) {
      ws.send(msg);
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', pilotsOnline: pilots.size });
  });

  app.get('/api/arenas', (_req, res) => {
    const summary = (Object.keys(THEATERS) as TheaterId[]).map((theaterId) => {
      const room = getOrCreateRoom(theaterId);
      const roomPilots = Array.from(pilots.values()).filter((p) => p.theaterId === theaterId);
      return {
        theaterId,
        name: THEATERS[theaterId].name,
        region: THEATERS[theaterId].region,
        weatherId: room.weatherId,
        pilotCount: roomPilots.length,
        pilots: roomPilots.map((p) => ({
          id: p.id,
          callsign: p.callsign,
          airframeId: p.airframeId,
          kills: p.kills,
          team: p.team,
        })),
      };
    });
    res.json({ arenas: summary });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const assignedId = `pilot-${Math.random().toString(36).slice(2, 9)}`;
    clientSockets.set(ws, assignedId);

    ws.on('message', (raw) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = String(data.type ?? '');

      if (type === 'arena:join') {
        const theaterId = (THEATERS[data.theaterId as TheaterId] ? data.theaterId : 'edwards') as TheaterId;
        const room = getOrCreateRoom(theaterId);
        const existing = pilots.get(assignedId);
        if (existing && existing.theaterId !== theaterId) {
          broadcastToRoom(existing.theaterId, { type: 'pilot:left', id: assignedId }, ws);
        }

        const roomPilots = Array.from(pilots.values()).filter(
          (p) => p.theaterId === theaterId && p.id !== assignedId,
        );
        const team: 'alpha' | 'bravo' = roomPilots.length % 2 === 0 ? 'alpha' : 'bravo';

        const pilot: ServerPilot = {
          id: assignedId,
          callsign: String(data.callsign || 'VANGUARD-1').slice(0, 18),
          theaterId,
          airframeId: (data.airframeId as AirframeId) || 'mq9x',
          x: Number(data.x ?? 0),
          y: Number(data.y ?? 420),
          z: Number(data.z ?? 500),
          vx: 0,
          vy: 0,
          vz: -80,
          pitch: 0,
          yaw: 0,
          roll: 0,
          hp: Number(data.maxHp ?? 120),
          maxHp: Number(data.maxHp ?? 120),
          kills: existing?.kills ?? 0,
          team,
          lastSeen: Date.now(),
        };
        pilots.set(assignedId, pilot);

        ws.send(
          JSON.stringify({
            type: 'arena:init',
            selfId: assignedId,
            theaterId,
            weatherId: room.weatherId,
            utcHours: room.utcHours,
            targetHp: room.targetHp,
            pilots: roomPilots,
          }),
        );

        broadcastToRoom(theaterId, { type: 'pilot:joined', pilot }, ws);
        return;
      }

      const self = pilots.get(assignedId);
      if (!self) return;
      self.lastSeen = Date.now();

      if (type === 'pilot:state') {
        self.x = Number(data.x ?? self.x);
        self.y = Number(data.y ?? self.y);
        self.z = Number(data.z ?? self.z);
        self.vx = Number(data.vx ?? self.vx);
        self.vy = Number(data.vy ?? self.vy);
        self.vz = Number(data.vz ?? self.vz);
        self.pitch = Number(data.pitch ?? self.pitch);
        self.yaw = Number(data.yaw ?? self.yaw);
        self.roll = Number(data.roll ?? self.roll);
        self.hp = Number(data.hp ?? self.hp);
        self.airframeId = (data.airframeId as AirframeId) || self.airframeId;

        broadcastToRoom(
          self.theaterId,
          {
            type: 'pilot:state',
            id: self.id,
            x: self.x,
            y: self.y,
            z: self.z,
            vx: self.vx,
            vy: self.vy,
            vz: self.vz,
            pitch: self.pitch,
            yaw: self.yaw,
            roll: self.roll,
            hp: self.hp,
            airframeId: self.airframeId,
          },
          ws,
        );
      } else if (type === 'ordnance:fire') {
        broadcastToRoom(
          self.theaterId,
          {
            type: 'ordnance:fire',
            ownerId: self.id,
            callsign: self.callsign,
            weaponId: data.weaponId as WeaponId,
            x: Number(data.x ?? self.x),
            y: Number(data.y ?? self.y),
            z: Number(data.z ?? self.z),
            vx: Number(data.vx ?? self.vx),
            vy: Number(data.vy ?? self.vy),
            vz: Number(data.vz ?? self.vz),
            targetX: Number(data.targetX ?? 0),
            targetY: Number(data.targetY ?? 0),
            targetZ: Number(data.targetZ ?? 0),
          },
          ws,
        );
      } else if (type === 'target:damage') {
        const room = getOrCreateRoom(self.theaterId);
        const targetId = String(data.targetId ?? '');
        const dmg = Math.max(0, Math.min(500, Number(data.damage ?? 0)));
        if (targetId in room.targetHp && room.targetHp[targetId] > 0) {
          room.targetHp[targetId] = Math.max(0, room.targetHp[targetId] - dmg);
          if (room.targetHp[targetId] === 0) {
            self.kills += 1;
          }
          broadcastToRoom(self.theaterId, {
            type: 'target:hp',
            targetId,
            hp: room.targetHp[targetId],
            attackerCallsign: self.callsign,
          });
        }
      } else if (type === 'arena:reset_targets') {
        const room = getOrCreateRoom(self.theaterId);
        for (const lm of THEATERS[self.theaterId].landmarks) {
          room.targetHp[lm.id] = lm.maxHp;
        }
        broadcastToRoom(self.theaterId, {
          type: 'target:reset',
          targetHp: room.targetHp,
        });
      } else if (type === 'env:sync') {
        const room = getOrCreateRoom(self.theaterId);
        if (typeof data.weatherId === 'string') {
          room.weatherId = data.weatherId as WeatherId;
        }
        if (typeof data.utcHours === 'number') {
          room.utcHours = data.utcHours;
        }
        broadcastToRoom(
          self.theaterId,
          {
            type: 'env:sync',
            weatherId: room.weatherId,
            utcHours: room.utcHours,
            byCallsign: self.callsign,
          },
          ws,
        );
      } else if (type === 'cyber:attack') {
        const room = getOrCreateRoom(self.theaterId);
        const targetId = String(data.targetId ?? '');
        const payloadId = String(data.payloadId ?? 'radar_spoof') as CyberPayloadId;
        const dmg = Math.max(0, Math.min(200, Number(data.damageDealt ?? 0)));
        if (targetId in room.targetHp && dmg > 0 && room.targetHp[targetId] > 0) {
          room.targetHp[targetId] = Math.max(0, room.targetHp[targetId] - dmg);
          if (room.targetHp[targetId] === 0) {
            self.kills += 1;
          }
          broadcastToRoom(self.theaterId, {
            type: 'target:hp',
            targetId,
            hp: room.targetHp[targetId],
            attackerCallsign: self.callsign,
          });
        }
        broadcastToRoom(
          self.theaterId,
          {
            type: 'cyber:attack',
            attackerId: self.id,
            attackerCallsign: self.callsign,
            targetId,
            payloadId,
          },
          ws,
        );
      }
    });

    ws.on('close', () => {
      const pilotId = clientSockets.get(ws);
      clientSockets.delete(ws);
      if (pilotId) {
        const pilot = pilots.get(pilotId);
        pilots.delete(pilotId);
        if (pilot) {
          broadcastToRoom(pilot.theaterId, { type: 'pilot:left', id: pilotId });
        }
      }
    });
  });

  // Periodic stale-pilot cleanup
  setInterval(() => {
    const cutoff = Date.now() - 20000;
    for (const [id, pilot] of pilots.entries()) {
      if (pilot.lastSeen < cutoff) {
        pilots.delete(id);
        broadcastToRoom(pilot.theaterId, { type: 'pilot:left', id });
      }
    }
  }, 5000);

  let viteMiddleware: express.RequestHandler | null = null;
  let viteReadyPromise: Promise<void> | null = null;

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite').then((m) => m);
    viteReadyPromise = createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: process.env.DISABLE_HMR === 'true' ? null : undefined,
      },
      appType: 'spa',
    }).then((vite) => {
      viteMiddleware = vite.middlewares;
    });

    app.use(async (req, res, next) => {
      if (!viteMiddleware && viteReadyPromise) {
        await viteReadyPromise;
      }
      if (viteMiddleware) {
        return viteMiddleware(req, res, next);
      }
      return next();
    });
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`AEROSTRIKE Tactical Server listening on port ${port}`);
  });

  if (viteReadyPromise) {
    await viteReadyPromise;
  }
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
