import { useState, useEffect, useRef } from "react";
import {
  db, ref, get, update,
  auth, googleProvider, signInWithPopup, onAuthStateChanged, signOut,
} from "./firebase.js";
import { translations, themes, LANGUAGE_NAMES } from "./i18n.js";
import Game from "./Game.jsx";

// Reusable language dropdown with globe icon
export function LanguageSelector({ lang, setLang, theme }) {
  const [open, setOpen] = useState(false);
  const th = themes[theme];
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        style={{
          background: th.bgInput, border: `1px solid ${th.borderColor}`,
          borderRadius: "8px", padding: "5px 10px", fontSize: "12px",
          color: th.text, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
          fontWeight: 600,
        }}
        aria-label="Language"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="2" y1="12" x2="22" y2="12"></line>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
        </svg>
        <span style={{ textTransform: "uppercase" }}>{lang}</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", right: 0, marginTop: "4px",
          background: th.dropdown, border: `1px solid ${th.dropdownBorder}`,
          borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
          minWidth: "130px", zIndex: 200, overflow: "hidden",
        }}>
          {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
            <div
              key={code}
              onClick={() => { setLang(code); setOpen(false); }}
              style={{
                padding: "10px 14px", fontSize: "13px", cursor: "pointer",
                color: lang === code ? "#38bdf8" : th.text,
                background: lang === code ? th.bgHover : "transparent",
                fontWeight: lang === code ? 600 : 400,
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
              }}
            >
              <span>{name}</span>
              <span style={{ fontSize: "10px", color: th.textMuted, textTransform: "uppercase" }}>{code}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lang, setLang] = useState(() => { try { return localStorage.getItem("trueque-lang") || "es"; } catch { return "es"; } });
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("trueque-theme") || "dark"; } catch { return "dark"; } });

  const t = translations[lang];
  const th = themes[theme];

  useEffect(() => { try { localStorage.setItem("trueque-lang", lang); } catch {} }, [lang]);
  useEffect(() => { try { localStorage.setItem("trueque-theme", theme); } catch {} }, [theme]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const pid = firebaseUser.uid;
        const playerRef = ref(db, `game/players/${pid}`);
        const snapshot = await get(playerRef);
        if (!snapshot.exists()) {
          await update(playerRef, {
            name: firebaseUser.displayName || "Player",
            photo: firebaseUser.photoURL || null,
            googlePhoto: firebaseUser.photoURL || null,
            email: firebaseUser.email,
            likes: 0,
            likedObjectId: null,
            obtained: [],
            likesEscrow: 0,
            ratingSum: 0,
            ratingCount: 0,
            pendingRatings: [],
            onboarded: false,
            joinedAt: Date.now(),
          });
        } else {
          // v20.2: backfill googlePhoto para usuarios pre-existentes si no lo tienen
          const existing = snapshot.val();
          if (!existing.googlePhoto && firebaseUser.photoURL) {
            await update(playerRef, { googlePhoto: firebaseUser.photoURL });
          }
        }
        setUser({ uid: pid, name: firebaseUser.displayName, photo: firebaseUser.photoURL, email: firebaseUser.email });
      } else { setUser(null); }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleLogin = async () => {
    setError("");
    try { await signInWithPopup(auth, googleProvider); }
    catch (err) { if (err.code !== "auth/popup-closed-by-user") setError("Error"); }
  };

  const handleLogout = async () => { await signOut(auth); };
  const toggleTheme = () => setTheme(prev => prev === "dark" ? "light" : "dark");

  const controlBar = (
    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
      <button onClick={toggleTheme} style={{
        background: th.bgInput, border: `1px solid ${th.borderColor}`, borderRadius: "8px",
        padding: "5px 10px", fontSize: "14px", cursor: "pointer", color: th.text, lineHeight: 1,
      }}>{theme === "dark" ? "☀️" : "🌙"}</button>
      <LanguageSelector lang={lang} setLang={setLang} theme={theme} />
    </div>
  );

  if (loading) {
    return <div style={{ minHeight: "100vh", background: th.bg, color: th.text, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>{t.loading}</div>;
  }

  if (!user) {
    return (
      <div style={{
        minHeight: "100vh", background: th.bg,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        fontFamily: "'Segoe UI', system-ui, sans-serif", color: th.text, padding: "20px",
      }}>
        <div style={{ position: "absolute", top: 16, right: 16 }}>{controlBar}</div>
        <p style={{ color: th.textSecondary, marginBottom: "32px", fontSize: "16px", textAlign: "center", maxWidth: "360px" }}>{t.loginSubtitle}</p>
        {error && <p style={{ color: "#ef4444", fontSize: "13px", marginBottom: "12px" }}>{error}</p>}
        <button onClick={handleLogin} style={{
          background: th.bgInput, border: `1px solid ${th.borderColor}`,
          borderRadius: "12px", padding: "14px 28px", fontSize: "15px", color: th.text,
          cursor: "pointer", display: "flex", alignItems: "center", gap: "10px", fontWeight: 600,
        }}>
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          {t.login}
        </button>
      </div>
    );
  }

  return <Game user={user} onLogout={handleLogout} lang={lang} setLang={setLang} theme={theme} setTheme={setTheme} />;
}
