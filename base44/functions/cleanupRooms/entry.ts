import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { ROOM_TTL_MS } from '../../shared/rooms.ts';

// Sweeps temporary rooms (and their player records / uploaded photos) so
// abandoned or finished sessions don't accumulate forever.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const Room = base44.asServiceRole.entities.Room;
    const Player = base44.asServiceRole.entities.RoomPlayer;
    const now = Date.now();

    const rooms = await Room.list();
    let removedRooms = 0;
    for (const r of rooms) {
      const updated = Date.parse(r.updated_date || r.created_date || '') || 0;
      if (r.status === 'closed' || now - updated > ROOM_TTL_MS) {
        await Player.deleteMany({ room_code: r.code });
        await Room.delete(r.id);
        removedRooms++;
      }
    }

    const liveRooms = await Room.list();
    const codes = new Set(liveRooms.map((r) => r.code));
    const players = await Player.list();
    let removedPlayers = 0;
    for (const p of players) {
      const seen = Date.parse(p.last_seen || '') || 0;
      if (!codes.has(p.room_code) || now - seen > ROOM_TTL_MS) {
        await Player.delete(p.id);
        removedPlayers++;
      }
    }

    return Response.json({ ok: true, removed_rooms: removedRooms, removed_players: removedPlayers });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}