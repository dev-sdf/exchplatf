import { useState, useEffect } from "react";
import { db, ref, set, get, onValue, push, update } from "./firebase.js";
import { OBJECTS, shuffle } from "./objects.js";
import Game from "./Game.jsx";

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export default function App() {
  const [screen, setScreen] = useState("home");
  const [playerName, setPlayerName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [roomData, setRoomData] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const createRoom = async () => {
    if (!playerName.trim()) { setError("Escribí tu nombre"); return; }
    setLoading(true);
    setError("");
    const code = generateRoomCode();
    const pid = "p1";
    const roomRef = ref(db, `rooms/${code}`);

    const shuffled = shuffle(OBJECTS);
    const hand = shuffled.slice(0, 4).map(o => ({ id: o.id, name: o.name, emoji: o.emoji, category: o.category }));

    await set(roomRef, {
      code,
      status: "waiting",
      createdAt: Date.now(),
      host: pid,
      players: {
        [pid]: {
          name: playerName.trim(),
          likes: 0,
          likedObjectId: null,
          hand,
          obtained: [],
          joinedAt: Date.now(),
        }
      },
      market: {},
      log: {},
      buyOffer: null,
      nextObjectIndex: 4,
    });

    setRoomCode(code);
    setPlayerId(pid);
    setScreen("lobby");
    setLoading(false);
  };

  const joinRoom = async () => {
    if (!playerName.trim()) { setError("Escribí tu nombre"); return; }
    if (!roomCode.trim()) { setError("Escribí el código de sala"); return; }
    setLoading(true);
    setError("");

    const code = roomCode.trim().toUpperCase();
    const roomRef = ref(db, `rooms/${code}`);
    const snapshot = await get(roomRef);

    if (!snapshot.exists()) {
      setError("No existe una sala con ese código");
      setLoading(false);
      return;
    }

    const data = snapshot.val();
    if (data.status === "finished") {
      setError("Esa sala ya terminó");
      setLoading(false);
      return;
    }

    const existingPlayers = data.players ? Object.keys(data.players) : [];
    const pid = `p${existingPlayers.length + 1}`;

    const objIndex = data.nextObjectIndex || existingPlayers.length * 4;
    const shuffled = shuffle(OBJECTS);
    const usedIds = [];
    if (data.players) {
      Object.values(data.players).forEach(p => {
        if (p.hand) p.hand.forEach(h => usedIds.push(h.id));
      });
    }
    const available = shuffled.filter(o => !usedIds.includes(o.id));
    const hand = available.slice(0, 4).map(o => ({ id: o.id, name: o.name, emoji: o.emoji, category: o.category }));

    await update(ref(db, `rooms/${code}/players/${pid}`), {
      name: playerName.trim(),
      likes: 0,
      likedObjectId: null,
      hand,
      obtained: [],
      joinedAt: Date.now(),
    });

    await update(ref(db, `rooms/${code}`), {
      nextObjectIndex: objIndex + 4,
    });

    setRoomCode(code);
    setPlayerId(pid);
    setScreen("lobby");
    setLoading(false);
  };

  useEffect(() => {
    if (screen === "lobby" && roomCode) {
      const roomRef = ref(db, `rooms/${roomCode}`);
      const unsub = onValue(roomRef, (snapshot) => {
        if (snapshot.exists()) {
          setRoomData(snapshot.val());
          if (snapshot.val().status === "playing") {
            setScreen("game");
          }
        }
      });
      return () => unsub();
    }
  }, [screen, roomCode]);

  const startGame = async () => {
    await update(ref(db, `rooms/${roomCode}`), { status: "playing" });
  };

  const inputStyle = {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "10px",
    padding: "14px 16px",
    fontSize: "16px",
    color: "#e2e8f0",
    width: "100%",
    outline: "none",
  };

  const btnStyle = {
    background: "linear-gradient(135deg, #38bdf8, #818cf8)",
    color: "#fff",
    border: "none",
    borderRadius: "12px",
    padding: "14px 32px",
    fontSize: "16px",
    fontWeight: 700,
    cursor: "pointer",
    width: "100%",
    opacity: loading ? 0.6 : 1,
  };

  const btnSecondary = {
    ...btnStyle,
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.15)",
  };

  // GAME SCREEN
  if (screen === "game" && roomCode && playerId) {
    return <Game roomCode={roomCode} playerId={playerId} />;
  }

  // LOBBY SCREEN
  if (screen === "lobby" && roomData) {
    const playerList = roomData.players ? Object.entries(roomData.players) : [];
    const isHost = playerId === roomData.host;

    return (
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(160deg, #0a0e1a 0%, #111827 40%, #1a1a2e 100%)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        fontFamily: "'Segoe UI', system-ui, sans-serif", color: "#e2e8f0", padding: "20px",
      }}>
        <div style={{ fontSize: "48px", marginBottom: "12px" }}>🏠</div>
        <h1 style={{ fontSize: "28px", fontWeight: 800, marginBottom: "8px",
          background: "linear-gradient(135deg, #38bdf8, #818cf8, #f472b6)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Sala: {roomCode}
        </h1>
        <p style={{ color: "#94a3b8", marginBottom: "24px", fontSize: "14px" }}>
          Compartí este código con los demás jugadores
        </p>

        <div style={{
          background: "rgba(255,255,255,0.05)", borderRadius: "16px", padding: "20px",
          maxWidth: "360px", width: "100%", border: "1px solid rgba(255,255,255,0.1)", marginBottom: "20px",
        }}>
          <h3 style={{ fontSize: "13px", color: "#f59e0b", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "12px" }}>
            Jugadores conectados ({playerList.length})
          </h3>
          {playerList.map(([pid, p]) => (
            <div key={pid} style={{
              padding: "10px 12px", borderRadius: "8px", marginBottom: "6px",
              background: pid === playerId ? "rgba(56,189,248,0.1)" : "rgba(255,255,255,0.03)",
              border: pid === playerId ? "1px solid rgba(56,189,248,0.3)" : "1px solid transparent",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontSize: "14px", fontWeight: 600 }}>
                {p.name} {pid === playerId && "(vos)"} {pid === roomData.host && "⭐"}
              </span>
              <span style={{ fontSize: "12px", color: "#64748b" }}>
                {p.hand ? p.hand.length : 0} objetos
              </span>
            </div>
          ))}
        </div>

        {isHost ? (
          <button onClick={startGame} style={{
            ...btnStyle,
            maxWidth: "360px",
            opacity: playerList.length < 2 ? 0.5 : 1,
          }} disabled={playerList.length < 2}>
            {playerList.length < 2 ? "Esperando más jugadores..." : `Iniciar partida (${playerList.length} jugadores)`}
          </button>
        ) : (
          <p style={{ color: "#94a3b8", fontSize: "14px", textAlign: "center" }}>
            Esperando a que el anfitrión inicie la partida...
          </p>
        )}
      </div>
    );
  }

  // HOME SCREEN
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #0a0e1a 0%, #111827 40%, #1a1a2e 100%)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Segoe UI', system-ui, sans-serif", color: "#e2e8f0", padding: "20px",
    }}>
      <div style={{ fontSize: "64px", marginBottom: "16px" }}>🏠</div>
      <h1 style={{ fontSize: "42px", fontWeight: 800, marginBottom: "8px",
        background: "linear-gradient(135deg, #38bdf8, #818cf8, #f472b6)",
        WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "-1px" }}>
        El Trueque
      </h1>
      <p style={{ color: "#94a3b8", marginBottom: "32px", fontSize: "16px", textAlign: "center", maxWidth: "400px" }}>
        Intercambiá objetos con otros jugadores en tiempo real
      </p>

      <div style={{ maxWidth: "360px", width: "100%", display: "flex", flexDirection: "column", gap: "12px" }}>
        <input
          type="text"
          placeholder="Tu nombre"
          value={playerName}
          onChange={e => setPlayerName(e.target.value)}
          style={inputStyle}
          maxLength={20}
        />

        {error && (
          <p style={{ color: "#ef4444", fontSize: "13px", textAlign: "center" }}>{error}</p>
        )}

        <button onClick={createRoom} style={btnStyle} disabled={loading}>
          Crear sala nueva
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "8px 0" }}>
          <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.1)" }} />
          <span style={{ color: "#64748b", fontSize: "13px" }}>o unite a una sala</span>
          <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.1)" }} />
        </div>

        <input
          type="text"
          placeholder="Código de sala (ej: ABC12)"
          value={roomCode}
          onChange={e => setRoomCode(e.target.value.toUpperCase())}
          style={{ ...inputStyle, textAlign: "center", letterSpacing: "4px", fontSize: "20px", textTransform: "uppercase" }}
          maxLength={5}
        />

        <button onClick={joinRoom} style={btnSecondary} disabled={loading}>
          Unirme a sala
        </button>
      </div>
    </div>
  );
}
