import { useState, useEffect } from "react";
import {
  db, ref, get, update,
  auth, googleProvider, signInWithPopup, onAuthStateChanged, signOut,
} from "./firebase.js";
import Game from "./Game.jsx";

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const pid = firebaseUser.uid;
        const playerRef = ref(db, `game/players/${pid}`);
        const snapshot = await get(playerRef);
        if (!snapshot.exists()) {
          await update(playerRef, {
            name: firebaseUser.displayName || "Jugador",
            photo: firebaseUser.photoURL || null,
            email: firebaseUser.email,
            likes: 0,
            likedObjectId: null,
            obtained: [],
            joinedAt: Date.now(),
          });
        }
        setUser({ uid: pid, name: firebaseUser.displayName, photo: firebaseUser.photoURL, email: firebaseUser.email });
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleLogin = async () => {
    setError("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      if (err.code !== "auth/popup-closed-by-user") {
        setError("Error al iniciar sesión. Intentá de nuevo.");
      }
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  if (loading) {
    return (
      <div style={{
        minHeight: "100vh", background: "#0a0e1a", color: "#e2e8f0",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "system-ui",
      }}>
        Cargando...
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(160deg, #0a0e1a 0%, #111827 40%, #1a1a2e 100%)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        fontFamily: "'Segoe UI', system-ui, sans-serif", color: "#e2e8f0", padding: "20px",
      }}>
        <div style={{ fontSize: "64px", marginBottom: "16px" }}>🏠</div>
        <h1 style={{
          fontSize: "42px", fontWeight: 800, marginBottom: "8px",
          background: "linear-gradient(135deg, #38bdf8, #818cf8, #f472b6)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "-1px",
        }}>
          El Trueque
        </h1>
        <p style={{ color: "#94a3b8", marginBottom: "32px", fontSize: "16px", textAlign: "center", maxWidth: "400px" }}>
          Publicá objetos, descubrí lo que otros ofrecen e intercambiá en tiempo real
        </p>

        {error && <p style={{ color: "#ef4444", fontSize: "13px", marginBottom: "12px" }}>{error}</p>}

        <button onClick={handleLogin} style={{
          background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: "12px", padding: "14px 32px", fontSize: "16px", color: "#e2e8f0",
          cursor: "pointer", display: "flex", alignItems: "center", gap: "12px", fontWeight: 600,
        }}>
          <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          Entrar con Google
        </button>
      </div>
    );
  }

  return <Game user={user} onLogout={handleLogout} />;
}
