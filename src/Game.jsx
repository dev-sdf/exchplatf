import { useState, useEffect, useRef } from "react";
import {
  db, ref, get, onValue, update, push, remove, runTransaction,
  storage, storageRef, uploadBytes, getDownloadURL, deleteObject,
} from "./firebase.js";
import { translations, CATEGORIES, themes, LANGUAGE_NAMES } from "./i18n.js";
import { LanguageSelector } from "./App.jsx";

function addLog(type, message, actors) {
  push(ref(db, "game/log"), {
    type,
    message,
    actors: Array.isArray(actors) ? actors : [],
    time: Date.now(),
  });
}

// Resuelve el índice de categoría para ítems viejos que guardaban el string traducido
function resolveCategoryIdx(item) {
  if (typeof item.categoryIdx === "number") return item.categoryIdx;
  if (!item.category) return -1;
  for (const lng of Object.keys(CATEGORIES)) {
    const i = CATEGORIES[lng].indexOf(item.category);
    if (i !== -1) return i;
  }
  return -1;
}

// Obtiene el nombre de categoría en el idioma actual
function localizedCategory(item, lang) {
  const idx = resolveCategoryIdx(item);
  if (idx >= 0) return CATEGORIES[lang][idx];
  return item.category || "";
}

// Placeholder SVG para imágenes faltantes
function ImagePlaceholder({ theme }) {
  const th = themes[theme];
  return (
    <div style={{
      width: "100%", height: "100%",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: th.bgCard, color: th.textMuted,
    }}>
      <svg width="40%" height="40%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" preserveAspectRatio="xMidYMid meet" style={{ maxWidth: 64, maxHeight: 64, minWidth: 24, minHeight: 24 }}>
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <circle cx="8.5" cy="8.5" r="1.5"></circle>
        <polyline points="21 15 16 10 5 21"></polyline>
      </svg>
    </div>
  );
}

// Imagen con fallback automático
function ItemImage({ src, theme, t, style, className }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  if (!src || failed) {
    return (
      <div style={{ width: "100%", height: "100%", ...style }} className={className}>
        <ImagePlaceholder theme={theme} />
      </div>
    );
  }
  return (
    <img
      src={src}
      onError={() => setFailed(true)}
      style={{ width: "100%", height: "100%", objectFit: "cover", ...style }}
      className={className}
    />
  );
}

// Carrusel de hasta 4 imágenes con puntitos + swipe
function ImageCarousel({ images, theme, t, onClick }) {
  const [idx, setIdx] = useState(0);
  const touchStartX = useRef(null);
  const list = Array.isArray(images) && images.length > 0 ? images : [null];
  useEffect(() => { setIdx(0); }, [images]);

  const go = (newIdx) => {
    if (newIdx < 0 || newIdx >= list.length) return;
    setIdx(newIdx);
  };

  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e) => {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 40) {
      if (dx < 0) go(idx + 1); else go(idx - 1);
    }
    touchStartX.current = null;
  };

  return (
    <div
      style={{ position: "relative", width: "100%", height: "100%" }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div
        onClick={onClick}
        style={{ width: "100%", height: "100%", cursor: onClick ? "pointer" : "default" }}
      >
        <ItemImage src={list[idx]} theme={theme} t={t} />
      </div>
      {list.length > 1 && (
        <>
          {/* Flechas (solo desktop) */}
          <button
            onClick={(e) => { e.stopPropagation(); go(idx - 1); }}
            disabled={idx === 0}
            style={{
              position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)",
              background: "rgba(0,0,0,0.5)", border: "none", borderRadius: "50%",
              width: 32, height: 32, color: "#fff", cursor: idx === 0 ? "default" : "pointer",
              opacity: idx === 0 ? 0.3 : 1, fontSize: 18, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            aria-label="Previous"
          >‹</button>
          <button
            onClick={(e) => { e.stopPropagation(); go(idx + 1); }}
            disabled={idx === list.length - 1}
            style={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              background: "rgba(0,0,0,0.5)", border: "none", borderRadius: "50%",
              width: 32, height: 32, color: "#fff", cursor: idx === list.length - 1 ? "default" : "pointer",
              opacity: idx === list.length - 1 ? 0.3 : 1, fontSize: 18, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            aria-label="Next"
          >›</button>
          {/* Contador */}
          <div style={{
            position: "absolute", top: 8, right: 8,
            background: "rgba(0,0,0,0.6)", color: "#fff",
            fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
          }}>{idx + 1}/{list.length}</div>
          {/* Puntitos */}
          <div style={{
            position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)",
            display: "flex", gap: 6,
          }}>
            {list.map((_, i) => (
              <div
                key={i}
                onClick={(e) => { e.stopPropagation(); go(i); }}
                style={{
                  width: 8, height: 8, borderRadius: 4,
                  background: i === idx ? "#fff" : "rgba(255,255,255,0.5)",
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Helper: saca el array de imágenes de un ítem, con fallback a imageURL legacy
function getItemImages(item) {
  if (Array.isArray(item?.images) && item.images.length > 0) return item.images;
  if (item?.imageURL) return [item.imageURL];
  return [];
}

// v20: Modal bloqueante de calificación. Se muestra mientras el jugador tenga
// entradas en me.pendingRatings. No tiene botón cerrar: el jugador sólo sale
// enviando la calificación (o las calificaciones, una por una).
function RatingModal({ entry, theme, t, onSubmit }) {
  const th = themes[theme];
  const [stars, setStars] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [hover, setHover] = useState(0);
  // Reset cuando cambia la entrada (remontado por key en el padre)
  const handleSubmit = async () => {
    if (submitting || stars < 1) return;
    setSubmitting(true);
    try {
      await onSubmit(stars);
    } finally {
      setSubmitting(false);
    }
  };
  const display = hover || stars;
  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.85)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 9999, padding: "16px",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
    }}>
      <div style={{
        background: th.modalBg, borderRadius: "16px", padding: "24px 20px",
        maxWidth: "380px", width: "100%",
        border: `1px solid ${th.borderColor}`,
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      }}>
        <h3 style={{
          fontSize: "17px", fontWeight: 700, color: th.text,
          marginBottom: "6px", textAlign: "center",
        }}>
          ⭐ {t.ratingModalTitle.replace("{user}", entry.ratedName || "?")}
        </h3>
        <div style={{ display: "flex", gap: "12px", marginBottom: "16px", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: 10, overflow: "hidden", flexShrink: 0, background: th.bgCard }}>
            {entry.itemImage ? (
              <img src={entry.itemImage} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
            ) : null}
          </div>
          <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
            <div style={{ fontSize: "10px", color: th.textMuted, textTransform: "uppercase", letterSpacing: 0.3 }}>
              {t.ratingItemLabel.replace("{item}", "").replace(":", "").trim()}
            </div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: th.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {entry.itemName || ""}
            </div>
          </div>
        </div>
        <div style={{
          fontSize: "13px", color: th.textSecondary,
          textAlign: "center", marginBottom: "18px",
        }}>
          {t.ratingPrompt}
        </div>
        <div style={{
          display: "flex", justifyContent: "center", gap: "8px",
          marginBottom: "20px",
        }}>
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              onClick={() => setStars(n)}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: "36px", padding: 0, lineHeight: 1,
                color: display >= n ? "#fbbf24" : th.textMuted,
                opacity: display >= n ? 1 : 0.35,
                transition: "opacity 0.15s, transform 0.15s",
                transform: display >= n ? "scale(1.05)" : "scale(1)",
              }}
              aria-label={`${n} stars`}
            >
              ★
            </button>
          ))}
        </div>
        <button
          onClick={handleSubmit}
          disabled={stars < 1 || submitting}
          style={{
            width: "100%",
            background: stars >= 1 ? "#10b981" : th.bgInput,
            color: stars >= 1 ? "#fff" : th.textMuted,
            border: "none", borderRadius: "12px",
            padding: "14px", fontSize: "14px", fontWeight: 700,
            cursor: stars >= 1 && !submitting ? "pointer" : "not-allowed",
          }}
        >
          {submitting ? "..." : (stars >= 1 ? t.ratingSubmit : t.ratingRequired)}
        </button>
      </div>
    </div>
  );
}

// v20.2: Modal para onboarding inicial y edición de perfil.
// mode: "onboarding" (bloqueante, sin cancelar) | "edit" (con cancelar)
function ProfileEditModal({ mode, currentName, currentPhoto, googlePhoto, theme, t, onSave, onCancel }) {
  const th = themes[theme];
  const isOnboarding = mode === "onboarding";
  const [name, setName] = useState(currentName || "");
  // photoPreview: lo que se ve en el preview del modal (URL o dataURL)
  const [photoPreview, setPhotoPreview] = useState(currentPhoto || null);
  // photoAction: qué hacer al guardar
  const [photoAction, setPhotoAction] = useState("keep"); // "keep" | "upload" | "google" | "remove"
  const [newPhotoBlob, setNewPhotoBlob] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  // Validación local en vivo (para feedback mientras escribe)
  const liveCheck = validateUsernameLocal(name);
  const canSave = liveCheck.ok && !submitting;

  const handlePickFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPhotoPreview(ev.target.result);
      setNewPhotoBlob(file);
      setPhotoAction("upload");
    };
    reader.readAsDataURL(file);
    // Reset input para permitir re-elegir el mismo archivo
    e.target.value = "";
  };

  const handleUseGoogle = () => {
    setPhotoPreview(googlePhoto || null);
    setNewPhotoBlob(null);
    setPhotoAction("google");
  };

  const handleRemovePhoto = () => {
    setPhotoPreview(null);
    setNewPhotoBlob(null);
    setPhotoAction("remove");
  };

  const handleSave = async () => {
    setError("");
    if (!liveCheck.ok) {
      setError(t[liveCheck.errorKey] || t.nameErrorGeneric);
      return;
    }
    setSubmitting(true);
    try {
      const res = await onSave({ name: name.trim(), photoAction, newPhotoBlob });
      if (!res.ok) {
        setError(t[res.errorKey] || t.nameErrorGeneric);
      }
    } catch (e) {
      setError(t.nameErrorGeneric);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.85)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 9998, padding: "16px",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
    }}>
      <div style={{
        background: th.modalBg, borderRadius: "16px", padding: "22px 20px",
        maxWidth: "400px", width: "100%",
        border: `1px solid ${th.borderColor}`,
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        maxHeight: "92vh", overflowY: "auto",
      }}>
        <h3 style={{ fontSize: "17px", fontWeight: 700, color: th.text, marginBottom: "6px", textAlign: "center" }}>
          {isOnboarding ? `👋 ${t.onboardingTitle}` : `✎ ${t.profileEditTitle}`}
        </h3>
        {isOnboarding && (
          <p style={{ fontSize: "12px", color: th.textSecondary, textAlign: "center", marginBottom: "16px", lineHeight: 1.4 }}>
            {t.onboardingSubtitle}
          </p>
        )}
        {/* Avatar preview + botones */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: "16px" }}>
          <div style={{ width: 88, height: 88, borderRadius: "50%", overflow: "hidden", background: th.bgCard, border: `2px solid ${th.borderLight}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {photoPreview ? (
              <img src={photoPreview} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
            ) : (
              <div style={{ fontSize: 36, fontWeight: 800, color: th.textSecondary }}>
                {(name || "?")[0].toUpperCase()}
              </div>
            )}
          </div>
          <div style={{ fontSize: "10px", color: th.textMuted, textAlign: "center", marginTop: -4 }}>
            {t.profilePhotoHint}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
            <button
              onClick={() => fileRef.current?.click()}
              style={{
                background: th.bgInput, color: th.text,
                border: `1px solid ${th.borderColor}`,
                borderRadius: 8, padding: "6px 10px",
                fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}
            >
              📷 {t.profileUploadPhoto}
            </button>
            {googlePhoto && (
              <button
                onClick={handleUseGoogle}
                style={{
                  background: th.bgInput, color: th.text,
                  border: `1px solid ${th.borderColor}`,
                  borderRadius: 8, padding: "6px 10px",
                  fontSize: 11, fontWeight: 600, cursor: "pointer",
                }}
              >
                G {t.profileUseGooglePhoto}
              </button>
            )}
            {photoPreview && (
              <button
                onClick={handleRemovePhoto}
                style={{
                  background: "rgba(239,68,68,0.12)", color: "#ef4444",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 8, padding: "6px 10px",
                  fontSize: 11, fontWeight: 600, cursor: "pointer",
                }}
              >
                🗑 {t.profileRemovePhoto}
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" onChange={handlePickFile} style={{ display: "none" }} />
        </div>
        {/* Nombre */}
        <div style={{ marginBottom: "14px" }}>
          <label style={{ fontSize: "11px", color: th.textSecondary, textTransform: "uppercase", letterSpacing: 0.3, fontWeight: 700, display: "block", marginBottom: 4 }}>
            {t.profileNameLabel}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value.slice(0, NAME_MAX)); setError(""); }}
            placeholder={t.profileNamePlaceholder}
            maxLength={NAME_MAX}
            autoFocus
            style={{
              width: "100%", background: th.bgInput,
              border: `1px solid ${error ? "#ef4444" : th.borderColor}`,
              borderRadius: 10, padding: "10px 12px",
              fontSize: 14, color: th.text, outline: "none",
              boxSizing: "border-box",
            }}
          />
          <div style={{ fontSize: 10, color: th.textMuted, textAlign: "right", marginTop: 3 }}>
            {name.length}/{NAME_MAX}
          </div>
        </div>
        {isOnboarding && (
          <div style={{
            fontSize: 11, color: th.textMuted, lineHeight: 1.4,
            padding: "8px 10px", background: th.bgCard,
            borderRadius: 8, border: `1px solid ${th.borderLight}`,
            marginBottom: "14px",
          }}>
            ℹ️ {t.onboardingNotice}
          </div>
        )}
        {error && (
          <div style={{
            fontSize: 12, color: "#ef4444", marginBottom: 10,
            padding: "6px 10px", background: "rgba(239,68,68,0.1)",
            borderRadius: 6, border: "1px solid rgba(239,68,68,0.3)",
          }}>
            {error}
          </div>
        )}
        {/* Botones */}
        <div style={{ display: "flex", gap: 8 }}>
          {!isOnboarding && (
            <button
              onClick={onCancel}
              disabled={submitting}
              style={{
                flex: 1, background: "transparent",
                color: th.textSecondary,
                border: `1px solid ${th.borderLight}`,
                borderRadius: 10, padding: "12px",
                fontSize: 13, fontWeight: 600,
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              {t.cancel}
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!canSave}
            style={{
              flex: 1,
              background: canSave ? "#10b981" : th.bgInput,
              color: canSave ? "#fff" : th.textMuted,
              border: "none", borderRadius: 10,
              padding: "12px", fontSize: 13, fontWeight: 700,
              cursor: canSave ? "pointer" : "not-allowed",
            }}
          >
            {submitting ? t.profileUploading : t.profileSave}
          </button>
        </div>
      </div>
    </div>
  );
}

// v20: Caja de chat para transacciones pendientes. Solo UI; la lógica
// (sendChatMessage, markChatRead) se pasa como callback desde el padre.
function PendingChatBox({ txId, messages, pid, otherName, theme, t, lang, onSend, onMarkRead, readOnly }) {
  const th = themes[theme];
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // v20.2: chat archivado (readOnly) arranca colapsado por defecto
  const [collapsed, setCollapsed] = useState(!!readOnly);
  const listRef = useRef(null);
  const msgs = Array.isArray(messages) ? messages : [];
  // Auto-scroll al fondo cuando llega un mensaje nuevo (solo si está visible)
  useEffect(() => {
    if (listRef.current && !collapsed) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [msgs.length, collapsed]);
  // Marcar como leído al montar
  useEffect(() => {
    if (!readOnly && onMarkRead) onMarkRead();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txId]);
  const handleSend = async () => {
    if (sending) return;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 140) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setText("");
    } finally {
      setSending(false);
    }
  };
  return (
    <div style={{
      margin: "14px 14px 0", padding: "10px",
      background: th.bgCard, borderRadius: 10,
      border: `1px solid ${th.borderLight}`,
    }}>
      <div
        onClick={readOnly ? () => setCollapsed(c => !c) : undefined}
        style={{
          fontSize: 12, fontWeight: 700, color: th.textSecondary,
          marginBottom: collapsed ? 0 : 8,
          textTransform: "uppercase", letterSpacing: 0.3,
          cursor: readOnly ? "pointer" : "default",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          userSelect: "none",
        }}
      >
        <span>{readOnly ? t.chatArchivedLabel : `💬 ${otherName || ""}`}</span>
        {readOnly && <span style={{ fontSize: 11 }}>{collapsed ? "▼" : "▲"}</span>}
      </div>
      {!collapsed && (<>
      <div
        ref={listRef}
        style={{
          maxHeight: 240, overflowY: "auto",
          display: "flex", flexDirection: "column", gap: 6,
          padding: "4px 2px",
          marginBottom: readOnly ? 0 : 10,
        }}
      >
        {msgs.length === 0 ? (
          <div style={{ fontSize: 11, color: th.textMuted, textAlign: "center", padding: "12px 0" }}>
            {t.chatEmpty}
          </div>
        ) : msgs.map((m, idx) => {
          const mine = m.senderId === pid;
          const timeStr = m.time ? new Date(m.time).toLocaleString(lang, { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" }) : "";
          return (
            <div key={m.id || idx} style={{
              alignSelf: mine ? "flex-end" : "flex-start",
              maxWidth: "80%",
              background: mine ? "#0ea5e9" : th.bgInput,
              color: mine ? "#fff" : th.text,
              padding: "6px 10px", borderRadius: 12,
              borderBottomRightRadius: mine ? 2 : 12,
              borderBottomLeftRadius: mine ? 12 : 2,
              fontSize: 12, wordBreak: "break-word",
            }}>
              <div style={{ lineHeight: 1.35 }}>{m.text}</div>
              <div style={{ fontSize: 9, opacity: 0.7, marginTop: 2, textAlign: mine ? "right" : "left" }}>
                {timeStr}
              </div>
            </div>
          );
        })}
      </div>
      {!readOnly && (
        <>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 140))}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={t.chatPlaceholder}
              maxLength={140}
              style={{
                flex: 1, background: th.bgInput,
                border: `1px solid ${th.borderColor}`,
                borderRadius: 8, padding: "8px 10px",
                fontSize: 12, color: th.text, outline: "none",
              }}
            />
            <button
              onClick={handleSend}
              disabled={sending || !text.trim()}
              style={{
                background: text.trim() && !sending ? "#0ea5e9" : th.bgInput,
                color: text.trim() && !sending ? "#fff" : th.textMuted,
                border: "none", borderRadius: 8,
                padding: "8px 14px", fontSize: 12, fontWeight: 700,
                cursor: text.trim() && !sending ? "pointer" : "not-allowed",
              }}
            >
              {t.chatSend}
            </button>
          </div>
          <div style={{ fontSize: 9, color: th.textMuted, marginTop: 4, textAlign: "right" }}>
            {t.chatCharLimit.replace("{n}", String(text.length))}
          </div>
        </>
      )}
      </>)}
    </div>
  );
}

// Constantes de tiempo
const OFFER_TTL_MS = 24 * 60 * 60 * 1000;      // 24h que dura una oferta
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d que dura una transacción pendiente
const COOLDOWN_MS = 24 * 60 * 60 * 1000;        // 24h de cooldown de reoferta
const CHAT_MSG_MAX = 140;

// v20.2: validación de nombre de usuario
const NAME_MIN = 2;
const NAME_MAX = 30;

// Lista negra de palabras prohibidas en el nombre de usuario.
// El chequeo es case-insensitive sobre el nombre trimmed.
// Bloquea el nombre si coincide completamente o si contiene alguna
// palabra como "token" (match de palabra completa, no substring).
const FORBIDDEN_NAME_WORDS = [
  // Roles / staff impersonation
  "admin", "administrator", "administrador", "amministratore",
  "mod", "moderator", "moderador", "moderatore",
  "root", "superuser", "sysop",
  "staff", "support", "soporte", "supporto",
  "system", "sistema", "systema",
  "owner", "official", "oficial", "ufficiale",
  // Platform
  "exchplatf",
  // Tech
  "null", "undefined", "nan", "none", "nil", "void",
  // Services to avoid impersonation
  "google", "firebase", "facebook", "instagram", "twitter", "tiktok", "whatsapp",
  // Insultos — inglés
  "idiot", "stupid", "moron", "asshole", "bastard", "bitch", "shit", "fuck", "dick",
  "cunt", "whore", "slut", "faggot", "nigger", "retard",
  // Insultos — español
  "idiota", "estupido", "imbecil", "pendejo", "pelotudo", "boludo", "mierda",
  "puta", "puto", "cabron", "cabrón", "coño", "verga", "joder", "maricon", "maricón",
  "gilipollas", "polla", "zorra",
  // Insultos — italiano
  "stronzo", "cazzo", "puttana", "vaffanculo", "merda", "coglione", "fottere", "figa",
  "troia", "bastardo", "scemo", "cretino", "frocio", "negro",
];

// Valida el nombre localmente (sin chequear unicidad).
// Devuelve { ok: boolean, errorKey?: string }
function validateUsernameLocal(raw) {
  const name = (raw || "").trim();
  if (!name) return { ok: false, errorKey: "nameErrorEmpty" };
  if (name.length < NAME_MIN) return { ok: false, errorKey: "nameErrorTooShort" };
  if (name.length > NAME_MAX) return { ok: false, errorKey: "nameErrorTooLong" };
  // Blacklist: lowercase + quitar acentos básicos para comparación robusta
  const lower = name.toLowerCase();
  const normalized = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const w of FORBIDDEN_NAME_WORDS) {
    // Match de palabra completa con límites de palabra Unicode-compatibles
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`, "u");
    if (re.test(normalized) || re.test(lower)) {
      return { ok: false, errorKey: "nameErrorForbidden" };
    }
  }
  return { ok: true };
}

// Deriva la clave de unicidad (lowercase normalizado) desde un nombre visible.
function usernameKey(name) {
  return (name || "").trim().toLowerCase();
}

// ========== v20 helpers ==========

// Formatea un delta de ms a "Xd Yh" / "Yh Zm" / "Zm" / "Ns"
function formatTimeLeft(ms) {
  if (ms == null || ms <= 0) return "0s";
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (day > 0) return `${day}d ${hr % 24}h`;
  if (hr > 0) return `${hr}h ${min % 60}m`;
  if (min > 0) return `${min}m`;
  return `${sec}s`;
}

// Formato rating para mostrar al lado del nombre
function formatRating(sum, count, t) {
  const c = count || 0;
  if (c === 0) return `⭐ — (0)`;
  const avg = (sum / c);
  // Máx 1 decimal; si es entero mostrar sin decimal
  const avgStr = Number.isInteger(avg) ? String(avg) : avg.toFixed(1);
  return `⭐ ${avgStr} (${c})`;
}


export default function Game({ user, onLogout, lang, setLang, theme, setTheme }) {
  const [game, setGame] = useState(null);
  const [myNotifs, setMyNotifs] = useState({});
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);
  const [toasts, setToasts] = useState([]); // [{id, type, params, createdAt}]
  const [tab, setTab] = useState("market");
  const [searchMode, setSearchMode] = useState("categories");
  const [searchText, setSearchText] = useState("");
  const [selectedCategoryIdx, setSelectedCategoryIdx] = useState([]); // array de índices
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);
  const [searchModeOpen, setSearchModeOpen] = useState(false);
  const [pubName, setPubName] = useState("");
  const [pubDesc, setPubDesc] = useState("");
  const [pubCategoryIdx, setPubCategoryIdx] = useState(0); // índice
  const [pubCatOpen, setPubCatOpen] = useState(false);
  const [pubImages, setPubImages] = useState([]); // array de {blob, preview}
  const [publishing, setPublishing] = useState(false);
  const [saleModal, setSaleModal] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null); // { source: 'market'|'withdrawn'|'history', item, index? }
  const [saleTimer, setSaleTimer] = useState(null);
  const [walletSubTab, setWalletSubTab] = useState("active"); // "active" | "history" | "liked"
  const [expandedLikers, setExpandedLikers] = useState({}); // { [itemUid]: boolean }
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [activityModalOpen, setActivityModalOpen] = useState(false);
  const [feedView, setFeedView] = useState(null); // { title, sourceType, startKey } | null
  const [editingItemUid, setEditingItemUid] = useState(null);
  const [editingWithdrawnIdx, setEditingWithdrawnIdx] = useState(null); // si estoy editando un item de me.withdrawn
  const [unlikeConfirmModal, setUnlikeConfirmModal] = useState(null); // { item }
  const saleTimerRef = useRef(null);
  const fileInputRef = useRef(null);
  const mountTimeRef = useRef(Date.now());
  const seenNotifIdsRef = useRef(new Set());
  const notifPanelRef = useRef(null);
  const profileMenuRef = useRef(null);
  const inFlightOpsRef = useRef(new Set()); // claves "tipo:uid" en curso, para evitar dobles clicks

  const pid = user.uid;
  const t = translations[lang];
  const th = themes[theme];
  const cats = CATEGORIES[lang];
  const toggleTheme = () => setTheme(prev => prev === "dark" ? "light" : "dark");

  // Suscripción principal al game
  useEffect(() => {
    const unsub = onValue(ref(db, "game"), (snap) => {
      if (snap.exists()) setGame(snap.val());
      else setGame({ players: {}, market: {}, log: {}, offers: {} });
    });
    return () => unsub();
  }, []);

  // Suscripción a mis notificaciones
  useEffect(() => {
    const unsub = onValue(ref(db, `game/notifications/${pid}`), (snap) => {
      const data = snap.val() || {};
      setMyNotifs(data);

      // Detectar notificaciones nuevas para toast (las creadas después del mount)
      Object.entries(data).forEach(([nid, n]) => {
        if (seenNotifIdsRef.current.has(nid)) return;
        seenNotifIdsRef.current.add(nid);
        if (n.time && n.time >= mountTimeRef.current) {
          // Crear toast
          setToasts(prev => [...prev, { id: nid, type: n.type, params: n.params || {}, createdAt: Date.now() }]);
        }
      });
    });
    return () => unsub();
  }, [pid]);

  // Limpieza automática de notificaciones > 30 días (una sola vez al montar)
  useEffect(() => {
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - THIRTY_DAYS;
    (async () => {
      try {
        const snap = await get(ref(db, `game/notifications/${pid}`));
        const data = snap.val() || {};
        const updates = {};
        Object.entries(data).forEach(([nid, n]) => {
          if (n && n.time && n.time < cutoff) {
            updates[`game/notifications/${pid}/${nid}`] = null;
          }
        });
        if (Object.keys(updates).length > 0) {
          await update(ref(db), updates);
        }
      } catch (e) { console.error("notif cleanup failed", e); }
    })();
  }, [pid]);

  // Auto-dismiss de toasts tras 4 segundos
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map(toast => {
      const remaining = 4000 - (Date.now() - toast.createdAt);
      return setTimeout(() => {
        setToasts(prev => prev.filter(x => x.id !== toast.id));
      }, Math.max(remaining, 100));
    });
    return () => timers.forEach(clearTimeout);
  }, [toasts.length]);

  // Cerrar panel de notificaciones al clickear fuera
  useEffect(() => {
    if (!notifPanelOpen) return;
    const handler = (e) => {
      if (notifPanelRef.current && !notifPanelRef.current.contains(e.target)) {
        setNotifPanelOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [notifPanelOpen]);

  // Cerrar menú del perfil al clickear fuera
  useEffect(() => {
    if (!profileMenuOpen) return;
    const handler = (e) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [profileMenuOpen]);

  // Al entrar a la pestaña Perfil, mostrar siempre "Mis artículos" por defecto
  useEffect(() => {
    if (tab === "profile") setWalletSubTab("active");
  }, [tab]);

  // Al salir de la pestaña Publish, cancelar cualquier edición pendiente para
  // evitar que una edición zombie se aplique en un publicado futuro.
  useEffect(() => {
    if (tab !== "publish" && (editingItemUid || editingWithdrawnIdx !== null)) {
      setEditingItemUid(null);
      setEditingWithdrawnIdx(null);
      setPubName(""); setPubDesc(""); setPubCategoryIdx(0); setPubImages([]);
    }
  }, [tab]);

  // v20: chequeo periódico de expiración de ofertas y pendings (cada 30s)
  useEffect(() => {
    let cancelled = false;
    const doCheck = async () => {
      if (cancelled) return;
      try {
        // Expirar offers vencidas
        const snap = await get(ref(db, "game/offers"));
        const offers = snap.val() || {};
        const now = Date.now();
        for (const [offerId, o] of Object.entries(offers)) {
          if (!o || o.status !== "active") continue;
          if (o.expiresAt && o.expiresAt <= now) {
            if (o.ownerId === pid || o.buyerId === pid) {
              await expireOfferById(offerId).catch(e => console.error("expireOffer err", e));
            }
          }
        }
        // Expirar pending transactions vencidas + avisar a los que están a <24h
        const pSnap = await get(ref(db, "game/pendingTransactions"));
        const pendings = pSnap.val() || {};
        for (const [txId, ptx] of Object.entries(pendings)) {
          if (!ptx || ptx.status !== "active") continue;
          const isMine = ptx.ownerId === pid || ptx.buyerId === pid;
          if (!isMine) continue;
          // Deadline warning: <24h, sólo una vez (flag deadlineWarned)
          const remaining = (ptx.expiresAt || 0) - now;
          if (!ptx.deadlineWarned && remaining > 0 && remaining < 24 * 60 * 60 * 1000) {
            // Marca atómica para no avisar dos veces
            const flagRef = ref(db, `game/pendingTransactions/${txId}/deadlineWarned`);
            const res = await runTransaction(flagRef, (curr) => {
              if (curr) return; // ya avisado
              return true;
            });
            if (res.committed) {
              const itemName = ptx.itemSnapshot?.name || "";
              createNotif(ptx.ownerId, "notifDeadlineWarning", { item: itemName });
              createNotif(ptx.buyerId, "notifDeadlineWarning", { item: itemName });
            }
          }
          if (ptx.expiresAt && ptx.expiresAt <= now) {
            // Usar una transacción atómica chica sobre el status para evitar dobles
            const txRef = ref(db, `game/pendingTransactions/${txId}`);
            const res = await runTransaction(txRef, (curr) => {
              if (!curr || curr.status !== "active") return;
              if (!curr.expiresAt || curr.expiresAt > Date.now()) return;
              curr.status = "expiring";
              return curr;
            });
            if (res.committed) {
              await cancelPendingTransaction(txId, "expired").catch(e => console.error("cancelPending err", e));
            }
          }
        }
      } catch (e) { console.error("expiration check failed", e); }
    };
    doCheck();
    const iv = setInterval(doCheck, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  useEffect(() => {
    if (saleModal) {
      setSaleTimer(10);
      saleTimerRef.current = setInterval(() => { setSaleTimer(p => { if (p <= 1) { clearInterval(saleTimerRef.current); return 0; } return p - 1; }); }, 1000);
      return () => clearInterval(saleTimerRef.current);
    } else { setSaleTimer(null); if (saleTimerRef.current) clearInterval(saleTimerRef.current); }
  }, [saleModal]);
  useEffect(() => { if (saleTimer === 0 && saleModal) { addLog("system", `${t.timeUp}: "${saleModal.name}"`, [pid]); setSaleModal(null); } }, [saleTimer]);

  if (!game || !game.players?.[pid]) {
    return <div style={{ minHeight: "100vh", background: th.bg, color: th.text, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>{t.loading}</div>;
  }

  const me = game.players[pid];
  const players = game.players;
  const market = game.market || {};
  const marketItems = Object.entries(market).map(([uid, obj]) => ({ ...obj, uid }));
  // v20: ofertas por artículo (reemplaza buyOffer global)
  const offersMap = game.offers || {};
  const offers = Object.entries(offersMap)
    .map(([id, o]) => ({ id, ...o }))
    .filter(o => o && o.status === "active");
  const getItemOffer = (itemUid) => offers.find(o => o.itemUid === itemUid) || null;
  const myIncomingOffers = offers.filter(o => o.ownerId === pid); // ofertas que me hicieron como vendedor
  const myOutgoingOffers = offers.filter(o => o.buyerId === pid); // ofertas que yo hice como comprador
  // Mostrar un solo modal al vendedor: la oferta entrante más antigua
  const incomingOffer = myIncomingOffers.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0] || null;
  // Para el banner inferior del comprador: su oferta activa más reciente
  const outgoingOffer = myOutgoingOffers.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
  // v20: transacciones pendientes en las que participo
  const pendingTxMap = game.pendingTransactions || {};
  const pendingTxList = Object.entries(pendingTxMap)
    .map(([id, ptx]) => ({ id, ...ptx }))
    .filter(ptx => ptx && ptx.status === "active");
  const myPending = pendingTxList.filter(ptx => ptx.ownerId === pid || ptx.buyerId === pid);
  // Billetera bloqueada: el comprador ya tiene una oferta activa o transacción pendiente
  const myBuyerOffer = offers.find(o => o.buyerId === pid);
  const myBuyerPending = myPending.find(ptx => ptx.buyerId === pid);
  const walletLocked = !!(myBuyerOffer || myBuyerPending);
  // Contador global de mensajes no leídos (para el badge en la sub-tab)
  const countUnreadInPending = (ptx) => {
    const msgs = ptx.messages ? Object.values(ptx.messages) : [];
    const lastRead = ptx.lastReadAt?.[pid] || 0;
    return msgs.filter(m => (m.time || 0) > lastRead && m.senderId !== pid).length;
  };
  const logEntries = game.log ? Object.values(game.log).sort((a, b) => a.time - b.time).slice(-50) : [];
  const getLikes = (uid) => Object.values(players).filter(p => p.likedObjectId === uid).length;
  // v20: formato de rating de un jugador (ej. "⭐ 4.6 (12)" o "⭐ — (0)")
  const getRatingStr = (playerObj) => formatRating(playerObj?.ratingSum || 0, playerObj?.ratingCount || 0, t);

  // Helpers de notificaciones
  const createNotif = async (targetPid, type, params) => {
    if (!targetPid || targetPid === pid) return; // no me notifico a mí mismo
    try {
      await push(ref(db, `game/notifications/${targetPid}`), {
        type, params, time: Date.now(), read: false,
      });
    } catch (e) { console.error(e); }
  };

  const markNotifRead = async (nid, groupIds) => {
    try {
      if (groupIds && groupIds.length > 1) {
        const updates = {};
        groupIds.forEach(gid => { updates[`game/notifications/${pid}/${gid}/read`] = true; });
        await update(ref(db), updates);
      } else {
        await update(ref(db, `game/notifications/${pid}/${nid}`), { read: true });
      }
    } catch (e) { console.error(e); }
  };

  const markAllNotifsRead = async () => {
    const updates = {};
    Object.entries(myNotifs).forEach(([nid, n]) => {
      if (!n.read) updates[`game/notifications/${pid}/${nid}/read`] = true;
    });
    if (Object.keys(updates).length > 0) {
      try { await update(ref(db), updates); } catch (e) { console.error(e); }
    }
  };

  // Agrupa notificaciones consecutivas del mismo tipo+item (ventana 10 min)
  // Solo agrupa tipos que tienden a repetirse (notifLike, notifUnlike).
  const GROUPABLE = new Set(["notifLike", "notifUnlike"]);
  const GROUP_WINDOW_MS = 10 * 60 * 1000;

  const rawNotifs = Object.entries(myNotifs)
    .map(([id, n]) => ({ id, ...n }))
    .filter(n => n && n.type)
    .sort((a, b) => (b.time || 0) - (a.time || 0));

  const notifList = [];
  for (const n of rawNotifs) {
    const last = notifList[notifList.length - 1];
    const sameKey =
      last &&
      GROUPABLE.has(n.type) &&
      last.type === n.type &&
      (last.params?.item || "") === (n.params?.item || "") &&
      Math.abs((last.time || 0) - (n.time || 0)) <= GROUP_WINDOW_MS;
    if (sameKey) {
      last.groupIds = last.groupIds || [last.id];
      last.groupIds.push(n.id);
      last.groupUsers = last.groupUsers || [last.params?.user].filter(Boolean);
      if (n.params?.user && !last.groupUsers.includes(n.params.user)) {
        last.groupUsers.push(n.params.user);
      }
      // Una notif agrupada está "no leída" si al menos una de las del grupo está no leída
      last.read = last.read && n.read;
      // Usar el tiempo más reciente para ordenar
      last.time = Math.max(last.time || 0, n.time || 0);
    } else {
      notifList.push({ ...n });
    }
    if (notifList.length >= 30) break;
  }

  const unreadCount = notifList.filter(n => !n.read).length;

  const formatNotif = (n) => {
    const p = n.params || {};
    // Caso agrupado
    if (n.groupUsers && n.groupUsers.length > 1) {
      const groupedType = n.type === "notifLike" ? "notifLikeGrouped" : (n.type === "notifUnlike" ? "notifUnlikeGrouped" : n.type);
      const tmpl = t[groupedType] || t[n.type] || "";
      const firstUser = n.groupUsers[0] || "";
      const others = n.groupUsers.length - 1;
      return tmpl
        .replace("{user}", firstUser)
        .replace("{others}", String(others))
        .replace("{item}", p.item || "")
        .replace("{amount}", p.amount != null ? String(p.amount) : "");
    }
    const tmpl = t[n.type] || "";
    return tmpl
      .replace("{user}", p.user || "")
      .replace("{item}", p.item || "")
      .replace("{amount}", p.amount != null ? String(p.amount) : "")
      .replace("{time}", p.time || "")
      .replace("{choice}", p.choice || "");
  };

  const filteredItems = marketItems.filter(item => {
    if (searchMode === "categories") {
      if (selectedCategoryIdx.length === 0) return true;
      return selectedCategoryIdx.includes(resolveCategoryIdx(item));
    }
    if (searchMode === "items") { if (!searchText.trim()) return true; return item.name.toLowerCase().includes(searchText.toLowerCase()) || (item.description || "").toLowerCase().includes(searchText.toLowerCase()); }
    if (searchMode === "users") { if (!searchText.trim()) return true; return (players[item.ownerId]?.name || "").toLowerCase().includes(searchText.toLowerCase()); }
    return true;
  });

  // ACTIONS
  const publishProduct = async () => {
    if (!pubName.trim() || pubImages.length === 0) return;
    // Mutex contra doble submit
    if (inFlightOpsRef.current.has("publishProduct")) return;
    inFlightOpsRef.current.add("publishProduct");
    setPublishing(true);
    try {
      const isEditingExhibited = !!editingItemUid;
      const isEditingWithdrawn = editingWithdrawnIdx !== null && editingWithdrawnIdx !== undefined;
      const isEditing = isEditingExhibited || isEditingWithdrawn;

      // Guardia crítica: en modo creación NO puede haber ninguna imagen sin blob.
      // En modo edición sí pueden haber imgs con existingUrl (sin blob) para reusarlas.
      if (!isEditing) {
        const badImg = pubImages.find(img => !img.blob);
        if (badImg) {
          console.error("publishProduct: modo creación con imagen sin blob; abortando.");
          setPublishing(false);
          inFlightOpsRef.current.delete("publishProduct");
          return;
        }
      }

      // Helper para resolver URLs: reusa existingUrl o sube el blob.
      const resolveImageUrl = async (imgObj, pathPrefix, i) => {
        if (imgObj.existingUrl && !imgObj.blob) return imgObj.existingUrl;
        if (!imgObj.blob) {
          throw new Error(`Imagen ${i} sin blob y sin existingUrl`);
        }
        const imgRef = storageRef(storage, `${pathPrefix}-${i}`);
        await uploadBytes(imgRef, imgObj.blob);
        return await getDownloadURL(imgRef);
      };

      if (isEditingExhibited) {
        // Modo: editar un item exhibido en el market. Validar que sigue existiendo.
        const targetUid = editingItemUid;
        if (!market[targetUid]) {
          console.error("publishProduct: el item que querías editar ya no existe en el market.");
          setPublishing(false);
          setEditingItemUid(null);
          setPubName(""); setPubDesc(""); setPubCategoryIdx(0); setPubImages([]);
          setTab("market");
          inFlightOpsRef.current.delete("publishProduct");
          return;
        }
        const pathPrefix = `products/${targetUid}-edit-${Date.now()}`;
        const urls = await Promise.all(
          pubImages.map((imgObj, i) => resolveImageUrl(imgObj, pathPrefix, i))
        );
        await update(ref(db, `game/market/${targetUid}`), {
          name: pubName.trim(),
          description: pubDesc.trim(),
          categoryIdx: pubCategoryIdx,
          category: CATEGORIES.es[pubCategoryIdx] || "",
          images: urls,
          imageURL: urls[0],
        });
        addLog("system", `✏️ ${me.name}: "${pubName.trim()}"`, [pid]);
      } else if (isEditingWithdrawn) {
        // Modo: editar un item en me.withdrawn[]. Actualizamos por índice.
        const list = me.withdrawn || [];
        const idx = editingWithdrawnIdx;
        if (idx < 0 || idx >= list.length) {
          console.error("publishProduct: índice de withdrawn inválido.");
          setPublishing(false);
          setEditingWithdrawnIdx(null);
          setPubName(""); setPubDesc(""); setPubCategoryIdx(0); setPubImages([]);
          setTab("profile");
          inFlightOpsRef.current.delete("publishProduct");
          return;
        }
        const pathPrefix = `products/withdrawn-${pid}-${Date.now()}`;
        const urls = await Promise.all(
          pubImages.map((imgObj, i) => resolveImageUrl(imgObj, pathPrefix, i))
        );
        const newList = list.map((oldItem, i) => {
          if (i !== idx) return oldItem;
          return {
            name: pubName.trim(),
            description: pubDesc.trim(),
            categoryIdx: pubCategoryIdx,
            category: CATEGORIES.es[pubCategoryIdx] || "",
            images: urls,
            imageURL: urls[0] || "",
          };
        });
        await update(ref(db, `game/players/${pid}`), { withdrawn: newList });
        addLog("system", `✏️ ${me.name}: "${pubName.trim()}"`, [pid]);
      } else {
        // Modo: crear nuevo item en el market.
        const uid = `${pid}-${Date.now()}`;
        const urls = await Promise.all(
          pubImages.map(async (imgObj, i) => {
            const imgRef = storageRef(storage, `products/${uid}-${i}`);
            await uploadBytes(imgRef, imgObj.blob);
            return await getDownloadURL(imgRef);
          })
        );
        await update(ref(db, `game/market/${uid}`), {
          name: pubName.trim(),
          description: pubDesc.trim(),
          categoryIdx: pubCategoryIdx,
          category: CATEGORIES.es[pubCategoryIdx] || "",
          images: urls,
          imageURL: urls[0],
          ownerId: pid,
          createdAt: Date.now(),
        });
        addLog("exhibit", `📦 ${me.name}: "${pubName.trim()}"`, [pid]);
      }

      // Limpiar estado
      setPubName(""); setPubDesc(""); setPubCategoryIdx(0); setPubImages([]);
      setEditingItemUid(null);
      setEditingWithdrawnIdx(null);
      // Volver al lugar lógico: si editaba un withdrawn, vuelvo a profile; si no, a market
      setTab(isEditingWithdrawn ? "profile" : "market");
    } catch (err) {
      console.error("publishProduct error:", err);
    } finally {
      setPublishing(false);
      inFlightOpsRef.current.delete("publishProduct");
    }
  };

  const handleImageSelect = (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (pubImages.length >= 4) {
      e.target.value = ""; // reset input
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas"); const max = 800;
        let w = img.width, h = img.height;
        if (w > h) { if (w > max) { h = h * max / w; w = max; } } else { if (h > max) { w = w * max / h; h = max; } }
        canvas.width = w; canvas.height = h; canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          setPubImages(prev => [...prev, { blob, preview: canvas.toDataURL() }]);
        }, "image/jpeg", 0.85);
      }; img.src = ev.target.result;
    }; reader.readAsDataURL(file);
    e.target.value = ""; // permitir re-seleccionar el mismo archivo
  };

  const removePubImage = (idx) => {
    setPubImages(prev => prev.filter((_, i) => i !== idx));
  };

  // Retira un objeto del mercado → pasa a mi lista "withdrawn" (activo no exhibido)
  const withdrawObject = async (mObj) => {
    if (getItemOffer(mObj.uid)) return;
    if (!mObj.uid || !market[mObj.uid]) return;
    // Mutex: si ya hay un withdraw en curso para este uid, ignorar el click.
    const opKey = `withdraw:${mObj.uid}`;
    if (inFlightOpsRef.current.has(opKey)) return;
    inFlightOpsRef.current.add(opKey);
    try {
      const updates = {};
      Object.entries(players).forEach(([p, d]) => { if (d.likedObjectId === mObj.uid) updates[`players/${p}/likedObjectId`] = null; });
      updates[`market/${mObj.uid}`] = null;
      updates[`players/${pid}/withdrawn`] = [...(me.withdrawn || []), {
        name: mObj.name,
        description: mObj.description || "",
        categoryIdx: resolveCategoryIdx(mObj),
        category: mObj.category || "",
        images: Array.isArray(mObj.images) ? mObj.images : (mObj.imageURL ? [mObj.imageURL] : []),
        imageURL: mObj.imageURL || (Array.isArray(mObj.images) ? mObj.images[0] : "") || "",
      }];
      await update(ref(db, "game"), updates);
      addLog("system", `↩️ ${me.name}: "${mObj.name}"`, [pid]);
    } finally {
      inFlightOpsRef.current.delete(opKey);
    }
  };

  // Re-exhibe un objeto desde "withdrawn" → va al mercado
  const exhibitFromWithdrawn = async (idx) => {
    const list = me.withdrawn || [];
    const obj = list[idx]; if (!obj) return;
    const opKey = `exhibit:${idx}:${obj.name}`;
    if (inFlightOpsRef.current.has(opKey)) return;
    inFlightOpsRef.current.add(opKey);
    try {
      const uid = `${pid}-${Date.now()}`;
      const updates = {};
      updates[`players/${pid}/withdrawn`] = list.filter((_, i) => i !== idx);
      updates[`market/${uid}`] = {
        name: obj.name,
        description: obj.description || "",
        categoryIdx: resolveCategoryIdx(obj),
        category: obj.category || "",
        images: Array.isArray(obj.images) ? obj.images : (obj.imageURL ? [obj.imageURL] : []),
        imageURL: obj.imageURL || (Array.isArray(obj.images) ? obj.images[0] : "") || "",
        ownerId: pid,
        createdAt: Date.now(),
      };
      await update(ref(db, "game"), updates);
      addLog("exhibit", `📦 ${me.name}: "${obj.name}"`, [pid]);
    } finally {
      inFlightOpsRef.current.delete(opKey);
    }
  };

  // Helper: borra las imágenes de un objeto del Storage (best-effort)
  const deleteItemImagesFromStorage = async (item) => {
    const imgs = getItemImages(item);
    await Promise.all(imgs.map(async (url) => {
      try {
        // Extrae el path desde la URL de descarga de Firebase Storage
        // Formato típico: https://firebasestorage.googleapis.com/.../o/products%2F{uid}?...
        const m = url && url.match(/\/o\/([^?]+)/);
        if (!m) return;
        const path = decodeURIComponent(m[1]);
        await deleteObject(storageRef(storage, path));
      } catch (e) {
        // Silencioso: si la imagen ya no existe o falla, no queremos bloquear la eliminación
        console.warn("No se pudo borrar imagen del storage:", e?.code || e?.message);
      }
    }));
  };

  // Elimina un objeto exhibido (del market). Libera los likes primero.
  const deleteMarketItem = async (mObj) => {
    if (getItemOffer(mObj.uid)) return;
    if (!mObj.uid || !market[mObj.uid]) return;
    const opKey = `delMarket:${mObj.uid}`;
    if (inFlightOpsRef.current.has(opKey)) return;
    inFlightOpsRef.current.add(opKey);
    try {
      const updates = {};
      Object.entries(players).forEach(([p, d]) => {
        if (d.likedObjectId === mObj.uid) updates[`players/${p}/likedObjectId`] = null;
      });
      updates[`market/${mObj.uid}`] = null;
      await update(ref(db, "game"), updates);
      addLog("system", `🗑 ${me.name}: "${mObj.name}"`, [pid]);
      deleteItemImagesFromStorage(mObj);
    } finally {
      inFlightOpsRef.current.delete(opKey);
    }
  };

  // Elimina un objeto no exhibido (de mi array withdrawn)
  const deleteWithdrawnItem = async (idx) => {
    const list = me.withdrawn || [];
    const obj = list[idx]; if (!obj) return;
    const opKey = `delWithdrawn:${idx}:${obj.name}`;
    if (inFlightOpsRef.current.has(opKey)) return;
    inFlightOpsRef.current.add(opKey);
    try {
      await update(ref(db, `game/players/${pid}`), {
        withdrawn: list.filter((_, i) => i !== idx),
      });
      addLog("system", `🗑 ${me.name}: "${obj.name}"`, [pid]);
      deleteItemImagesFromStorage(obj);
    } finally {
      inFlightOpsRef.current.delete(opKey);
    }
  };

  // Elimina un objeto del historial (de mi array obtained)
  const deleteObtainedItem = async (idx) => {
    const list = me.obtained || [];
    const obj = list[idx]; if (!obj) return;
    await update(ref(db, `game/players/${pid}`), {
      obtained: list.filter((_, i) => i !== idx),
    });
    // OJO: las imágenes del historial pueden ser compartidas con otros jugadores
    // (p.ej. si el ítem fue vendido, el vendedor podría tener una copia). No las borramos
    // del Storage para evitar romper referencias ajenas.
  };

  // Confirma la eliminación según el source del modal
  const confirmDelete = async () => {
    if (!deleteModal) return;
    const { source, item, index } = deleteModal;
    try {
      if (source === "market") await deleteMarketItem(item);
      else if (source === "withdrawn") await deleteWithdrawnItem(index);
      else if (source === "history") await deleteObtainedItem(index);
    } catch (e) { console.error(e); }
    setDeleteModal(null);
  };

  // Ejecuta el unlike directamente (sin confirmación)
  const doUnlike = async (mObj) => {
    await update(ref(db, `game/players/${pid}`), { likedObjectId: null });
    addLog("unlike", `👎 ${me.name} ✕ "${mObj.name}"`, [pid, mObj.ownerId]);
    createNotif(mObj.ownerId, "notifUnlike", { user: me.name, item: mObj.name });
  };

  const toggleLike = async (mObj) => {
    if (walletLocked) { showWalletLockedToast("walletLockedToastLike"); return; } // like congelado mientras haya transacción activa como comprador
    if (mObj.ownerId === pid || getItemOffer(mObj.uid) || (saleModal && saleModal.uid === mObj.uid)) return;
    if (me.likedObjectId === mObj.uid) {
      // Estamos a punto de quitar el like.
      // Si estamos en el feed fullscreen de "Me gusta" (abierto desde la pastilla
      // del perfil), pedir confirmación porque el item desaparecerá de la vista.
      const inLikedFeedView = feedView && feedView.sourceType === "liked";
      if (inLikedFeedView) {
        setUnlikeConfirmModal({ item: mObj });
        return;
      }
      await doUnlike(mObj);
    } else {
      await update(ref(db, `game/players/${pid}`), { likedObjectId: mObj.uid });
      addLog("like", `👍 ${me.name} → "${mObj.name}"`, [pid, mObj.ownerId]);
      createNotif(mObj.ownerId, "notifLike", { user: me.name, item: mObj.name });
    }
  };

  const openSellModal = (mObj) => {
    if (getItemOffer(mObj.uid)) return;
    const likers = Object.entries(players).filter(([p, d]) => d.likedObjectId === mObj.uid && p !== mObj.ownerId);
    if (likers.length === 0) { addLog("system", `❌ "${mObj.name}" - ${t.noLikesYet}`, [pid]); return; }
    setSaleModal({ ...mObj, likers, basePrice: getLikes(mObj.uid) });
  };

  // =========================================================================
  // v20: FLUJO DE TRANSACCIONES CON ESCROW Y PENDING
  // =========================================================================
  //
  // Ya no hay transferencia inmediata al aceptar una oferta. El flujo es:
  //   1. makeBuyOffer  → crea offer, congela likes del comprador en escrow
  //   2. acceptOffer   → crea pendingTransaction (7d), borra offer y market item
  //   3. Ambas partes coordinan (chat en etapa 4) y votan completar/cancelar
  //   4a. castCloseVote ambos "complete" → completePendingTransaction → recibidos/entregados
  //   4b. castCloseVote ambos "cancel" (o expiración 7d) → cancelPendingTransaction → vuelve al market
  //
  // La venta directa (saleModal → elegir liker) también pasa por pending.

  // Snapshot completo de un item del market (usado al ofertar/aceptar/etc)
  const buildItemSnapshot = (mObj) => ({
    name: mObj.name || "",
    description: mObj.description || "",
    categoryIdx: resolveCategoryIdx(mObj),
    category: mObj.category || "",
    images: Array.isArray(mObj.images) ? mObj.images : (mObj.imageURL ? [mObj.imageURL] : []),
    imageURL: mObj.imageURL || (Array.isArray(mObj.images) ? mObj.images[0] : "") || "",
  });

  // Crea un pendingTransaction a partir de los datos del intercambio. Usado
  // tanto por acceptOffer como por la venta directa del vendedor.
  // Retorna el txId creado o null si falló.
  const createPendingCore = async (mObj, buyerPid, sr, dc, price, offerIdOrNull) => {
    const seller = players[mObj.ownerId] || {};
    const mk = market[mObj.uid] || {};
    // Snapshot preservando los likers actuales (excluyendo al buyer)
    const preservedLikers = Object.entries(players)
      .filter(([p, d]) => d.likedObjectId === mObj.uid && p !== buyerPid)
      .map(([p]) => p);
    const itemSnapshot = buildItemSnapshot({
      name: mObj.name || mk.name,
      description: mObj.description || mk.description,
      category: mObj.category || mk.category,
      categoryIdx: mObj.categoryIdx != null ? mObj.categoryIdx : mk.categoryIdx,
      images: mObj.images || mk.images,
      imageURL: mObj.imageURL || mk.imageURL,
    });
    const now = Date.now();
    const newTxRef = push(ref(db, "game/pendingTransactions"));
    const txId = newTxRef.key;
    const updates = {};
    updates[`pendingTransactions/${txId}`] = {
      itemUid: mObj.uid,
      itemSnapshot,
      ownerId: mObj.ownerId,
      buyerId: buyerPid,
      price,
      sellerReceives: sr,
      debtCancelled: dc,
      acceptedAt: now,
      expiresAt: now + PENDING_TTL_MS,
      preservedLikers,
      closeVotes: { [mObj.ownerId]: null, [buyerPid]: null },
      lastReadAt: { [mObj.ownerId]: now, [buyerPid]: now },
      status: "active",
    };
    // Limpiar el item del market (el snapshot queda en el pending)
    updates[`market/${mObj.uid}`] = null;
    // Si venía de una offer, limpiarla
    if (offerIdOrNull) {
      updates[`offers/${offerIdOrNull}`] = null;
    }
    // Limpiar likedObjectId de los jugadores que apuntaban al item, excepto el buyer.
    // El like del buyer queda congelado sobre el item durante toda la transacción.
    // Van guardados en preservedLikers para restaurar si se cancela.
    Object.entries(players).forEach(([p, d]) => {
      if (d.likedObjectId === mObj.uid && p !== buyerPid) updates[`players/${p}/likedObjectId`] = null;
    });
    await update(ref(db, "game"), updates);
    return txId;
  };

  const acceptOffer = async (offerId) => {
    const o = offersMap[offerId];
    if (!o || o.status !== "active") return;
    const mk = market[o.itemUid] || {};
    const mObj = {
      uid: o.itemUid,
      name: o.itemSnapshot?.name || mk.name || "",
      ownerId: o.ownerId,
      imageURL: o.itemSnapshot?.imageURL || mk.imageURL || "",
      images: mk.images,
      description: mk.description || "",
      category: mk.category || "",
      categoryIdx: mk.categoryIdx,
    };
    const txId = await createPendingCore(mObj, o.buyerId, o.sellerReceives, o.debtCancelled, o.price, offerId);
    if (!txId) return;
    addLog("sell", `🤝 ${players[o.ownerId]?.name || "?"} → ${players[o.buyerId]?.name || "?"}: "${mObj.name}" (${t.pendingTimeLeft.replace("{time}", formatTimeLeft(PENDING_TTL_MS))})`, [o.ownerId, o.buyerId]);
    createNotif(o.buyerId, "notifOfferAccepted", { user: players[o.ownerId]?.name || "", item: mObj.name });
  };

  // Venta directa (desde saleModal del vendedor, sin offer previa).
  // El vendedor elige a qué liker venderle directamente.
  const createPendingFromDirectSale = async (mObj, buyerPid, sr, dc) => {
    const price = getLikes(mObj.uid);
    const txId = await createPendingCore(mObj, buyerPid, sr, dc, price, null);
    if (!txId) return;
    addLog("sell", `🤝 ${me.name} → ${buyer.name}: "${mObj.name}"`, [mObj.ownerId, buyerPid]);
    createNotif(buyerPid, "notifOfferAccepted", { user: me.name, item: mObj.name });
    setSaleModal(null);
  };

  // Completa una transacción pendiente: transfiere likes, mueve el item a
  // obtained/delivered, archiva el chat, encola ratings. Se llama desde
  // castCloseVote cuando ambas partes votaron "complete".
  const completePendingTransaction = async (txId) => {
    // Leer el pending "al vuelo" para tener la última versión con chat incluido
    const ptxSnap = await get(ref(db, `game/pendingTransactions/${txId}`));
    const ptx = ptxSnap.val();
    if (!ptx || ptx.status !== "active") return;
    const buyer = players[ptx.buyerId] || {};
    const seller = players[ptx.ownerId] || {};
    const sr = ptx.sellerReceives || 0;
    const dc = ptx.debtCancelled || 0;
    const price = ptx.price || 0;
    // Cálculo del nuevo saldo del buyer: mismo que antes
    const buyerNew = (buyer.likes || 0) < 0 ? -sr : (buyer.likes || 0) - price;
    const txDate = Date.now();
    // chatArchive: v20 etapa 4 — por ahora array vacío. En etapa 4 se copia ptx.messages
    const chatArchive = ptx.messages ? Object.entries(ptx.messages)
      .map(([mid, m]) => ({ ...m, id: mid }))
      .sort((a, b) => (a.time || 0) - (b.time || 0)) : [];
    const updates = {};
    updates[`players/${ptx.buyerId}/likes`] = buyerNew;
    updates[`players/${ptx.buyerId}/likedObjectId`] = null; // transacción completada: liberar like del comprador
    updates[`players/${ptx.buyerId}/obtained`] = [...(buyer.obtained || []), {
      ...ptx.itemSnapshot,
      date: txDate,
      fromId: ptx.ownerId,
      chatArchive,
      txId,
    }];
    updates[`players/${ptx.ownerId}/likes`] = (seller.likes || 0) + sr;
    updates[`players/${ptx.ownerId}/delivered`] = [...(seller.delivered || []), {
      ...ptx.itemSnapshot,
      date: txDate,
      toId: ptx.buyerId,
      chatArchive,
      txId,
    }];
    // Borrar el pending
    updates[`pendingTransactions/${txId}`] = null;
    // Encolar ratings para ambos (etapa 5 renderiza el modal)
    const ratingForBuyer = {
      txId, ratedId: ptx.ownerId,
      ratedName: seller.name || "?",
      itemName: ptx.itemSnapshot?.name || "",
      itemImage: ptx.itemSnapshot?.imageURL || "",
      time: txDate,
    };
    const ratingForSeller = {
      txId, ratedId: ptx.buyerId,
      ratedName: buyer.name || "?",
      itemName: ptx.itemSnapshot?.name || "",
      itemImage: ptx.itemSnapshot?.imageURL || "",
      time: txDate,
    };
    updates[`players/${ptx.buyerId}/pendingRatings`] = [...(buyer.pendingRatings || []), ratingForBuyer];
    updates[`players/${ptx.ownerId}/pendingRatings`] = [...(seller.pendingRatings || []), ratingForSeller];
    await update(ref(db, "game"), updates);
    addLog("sell", `💰 ${seller.name} → ${buyer.name}: "${ptx.itemSnapshot?.name || ""}" (${sr} ${t.likes})`, [ptx.ownerId, ptx.buyerId]);
    if (buyerNew < 0 && dc === 0) addLog("credit", `🔴 ${buyer.name}: ${buyerNew} ${t.likes}`, [ptx.buyerId]);
    createNotif(ptx.ownerId, "notifTransactionCompleted", { item: ptx.itemSnapshot?.name || "" });
    createNotif(ptx.buyerId, "notifTransactionCompleted", { item: ptx.itemSnapshot?.name || "" });
  };

  // Cancela una transacción pendiente: restaura el market item, devuelve los
  // likes al buyer, aplica cooldown y notifica.
  // reason: "bilateral" | "expired"
  const cancelPendingTransaction = async (txId, reason) => {
    const ptxSnap = await get(ref(db, `game/pendingTransactions/${txId}`));
    const ptx = ptxSnap.val();
    if (!ptx || ptx.status !== "active") return;
    const buyer = players[ptx.buyerId] || {};
    const price = ptx.price || 0;
    const updates = {};
    // Restaurar el item en el market (desde el snapshot)
    updates[`market/${ptx.itemUid}`] = {
      ...ptx.itemSnapshot,
      ownerId: ptx.ownerId,
      createdAt: Date.now(),
    };
    // Restaurar likedObjectId de los likers preservados (excepto el buyer que canceló)
    const preserved = Array.isArray(ptx.preservedLikers) ? ptx.preservedLikers : [];
    preserved.forEach(uid => {
      // Solo restaurar si hoy el jugador no tiene otro like (evita pisar una elección nueva)
      if (players[uid] && !players[uid].likedObjectId) {
        updates[`players/${uid}/likedObjectId`] = ptx.itemUid;
      }
    });
    // Limpiar like del comprador (pierde el like al cancelar, cooldown lo impide re-ofertar)
    updates[`players/${ptx.buyerId}/likedObjectId`] = null;
    // Aplicar cooldown al buyer sobre este item
    updates[`cooldowns/${ptx.buyerId}/${ptx.itemUid}`] = { until: Date.now() + COOLDOWN_MS };
    // Borrar el pending
    updates[`pendingTransactions/${txId}`] = null;
    await update(ref(db, "game"), updates);
    addLog("system", `↩️ "${ptx.itemSnapshot?.name || ""}"`, [ptx.ownerId, ptx.buyerId]);
    if (reason === "aborted") {
      createNotif(ptx.ownerId, "notifTransactionAborted", { user: players[ptx.buyerId]?.name || "?", item: ptx.itemSnapshot?.name || "" });
    } else {
      const notifType = reason === "expired" ? "notifTransactionExpired" : "notifTransactionCancelled";
      createNotif(ptx.ownerId, notifType, { item: ptx.itemSnapshot?.name || "" });
      createNotif(ptx.buyerId, notifType, { item: ptx.itemSnapshot?.name || "" });
    }
  };

  // Emite/cambia/quita un voto de cierre. Si hay coincidencia bilateral, dispara
  // completar o cancelar. Votos opuestos se anulan mutuamente (se vuelve a null).
  // vote: "complete" | "cancel" | null
  const castCloseVote = async (txId, vote) => {
    const txRef = ref(db, `game/pendingTransactions/${txId}`);
    // runTransaction para evitar races (dos clics simultáneos de ambas partes)
    const res = await runTransaction(txRef, (curr) => {
      if (!curr || curr.status !== "active") return;
      const votes = curr.closeVotes || {};
      votes[pid] = vote;
      const other = pid === curr.ownerId ? curr.buyerId : curr.ownerId;
      const myVote = votes[pid];
      const otherVote = votes[other];
      // Conflicto: votos opuestos → anular ambos
      if (myVote && otherVote && myVote !== otherVote) {
        votes[pid] = null;
        votes[other] = null;
        curr.closeVotes = votes;
        curr._conflict = Date.now(); // marca temporal para UI
        return curr;
      }
      curr.closeVotes = votes;
      curr._conflict = null;
      return curr;
    });
    if (!res.committed) return;
    const after = res.snapshot.val();
    if (!after) return;
    const other = pid === after.ownerId ? after.buyerId : after.ownerId;
    const myVote = after.closeVotes?.[pid];
    const otherVote = after.closeVotes?.[other];
    // Coincidencia bilateral → disparar acción
    if (myVote && otherVote && myVote === otherVote) {
      if (myVote === "complete") {
        await completePendingTransaction(txId);
      } else {
        await cancelPendingTransaction(txId, "bilateral");
      }
      return;
    }
    // Si yo voté y el otro todavía no → notificar al otro
    if (myVote && !otherVote) {
      const choiceLabel = myVote === "complete" ? t.closeChoiceComplete : t.closeChoiceCancel;
      createNotif(other, "notifCloseRequested", {
        user: me.name,
        item: after.itemSnapshot?.name || "",
        choice: choiceLabel,
      });
    }
  };

  // v20: envía un mensaje en el chat de un pending. Máx 140 chars. Notifica al otro.
  const sendChatMessage = async (txId, text) => {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    if (trimmed.length > CHAT_MSG_MAX) return;
    const ptx = pendingTxMap[txId];
    if (!ptx || ptx.status !== "active") return;
    // Solo participantes pueden escribir
    if (ptx.ownerId !== pid && ptx.buyerId !== pid) return;
    const newMsgRef = push(ref(db, `game/pendingTransactions/${txId}/messages`));
    const msgId = newMsgRef.key;
    const now = Date.now();
    const updates = {};
    updates[`pendingTransactions/${txId}/messages/${msgId}`] = {
      senderId: pid,
      text: trimmed,
      time: now,
    };
    // Marcarme como "al día" con mis propios mensajes
    updates[`pendingTransactions/${txId}/lastReadAt/${pid}`] = now;
    await update(ref(db, "game"), updates);
    const otherId = pid === ptx.ownerId ? ptx.buyerId : ptx.ownerId;
    createNotif(otherId, "notifChatMessage", {
      user: me.name,
      item: ptx.itemSnapshot?.name || "",
    });
  };

  // v20: marca un pending como leído por mí en este instante.
  const markChatRead = async (txId) => {
    const ptx = pendingTxMap[txId];
    if (!ptx || ptx.status !== "active") return;
    if (ptx.ownerId !== pid && ptx.buyerId !== pid) return;
    // Solo escribir si hay mensajes nuevos que no sean míos, para no generar tráfico inútil
    const msgs = ptx.messages ? Object.values(ptx.messages) : [];
    const lastRead = ptx.lastReadAt?.[pid] || 0;
    const hasNew = msgs.some(m => (m.time || 0) > lastRead && m.senderId !== pid);
    if (!hasNew) return;
    await update(ref(db, `game/pendingTransactions/${txId}/lastReadAt`), { [pid]: Date.now() });
  };

  // v20: envía la calificación del jugador hacia la contraparte de una transacción
  // completada. Saca la entrada correspondiente de me.pendingRatings, escribe el
  // rating en ratings/{pid}/{ratedId}/{txId} y actualiza ratingSum/ratingCount del
  // calificado (con runTransaction para no perder incrementos concurrentes).
  const submitRating = async (entry, stars) => {
    if (!entry || !entry.txId || !entry.ratedId) return;
    const s = Math.max(1, Math.min(5, Math.round(stars || 0)));
    // 1. Guardar el rating detallado
    await update(ref(db, `game/ratings/${pid}/${entry.ratedId}/${entry.txId}`), {
      stars: s,
      time: Date.now(),
    });
    // 2. Incrementar ratingSum/ratingCount del calificado (atómico)
    const ratedRef = ref(db, `game/players/${entry.ratedId}`);
    await runTransaction(ratedRef, (curr) => {
      if (!curr) return curr;
      curr.ratingSum = (curr.ratingSum || 0) + s;
      curr.ratingCount = (curr.ratingCount || 0) + 1;
      return curr;
    });
    // 3. Quitar la entrada de mi cola pendingRatings (por txId + ratedId)
    const myQueue = (me.pendingRatings || []).filter(e => !(e.txId === entry.txId && e.ratedId === entry.ratedId));
    await update(ref(db, `game/players/${pid}`), { pendingRatings: myQueue });
  };

  // v20.2: reclama/libera nombres de usuario de forma atómica usando un índice
  // `game/usernames/{lowercase}: uid`. Si newName ya está tomado por otro uid,
  // devuelve {ok:false, errorKey:"nameErrorTaken"}. Si oldName está presente,
  // se libera en el mismo update atómico que reserva newName (intercambio).
  const claimUsername = async (newName, oldName) => {
    const newKey = usernameKey(newName);
    const oldKey = oldName ? usernameKey(oldName) : null;
    if (!newKey) return { ok: false, errorKey: "nameErrorEmpty" };
    // Si el nombre no cambió (mismo lowercase), nada que hacer
    if (oldKey && oldKey === newKey) return { ok: true };
    // Intento atómico: reservar newKey. Si ya estaba con otro uid, abortar.
    const newRef = ref(db, `game/usernames/${newKey}`);
    const res = await runTransaction(newRef, (curr) => {
      if (curr && curr !== pid) return; // abortar: tomado por otro
      return pid;
    });
    if (!res.committed) {
      return { ok: false, errorKey: "nameErrorTaken" };
    }
    // Ya tenemos newKey. Si había oldKey distinto, liberarlo.
    if (oldKey && oldKey !== newKey) {
      try {
        await update(ref(db, "game"), { [`usernames/${oldKey}`]: null });
      } catch (e) {
        // No es crítico si falla: el nombre viejo queda huérfano como cache,
        // pero el nuevo ya está reclamado correctamente.
        console.warn("no se pudo liberar oldKey", e);
      }
    }
    return { ok: true };
  };

  // v20.2: sube una imagen a Storage como avatar del usuario actual.
  // Devuelve la URL descargable o null si falló.
  const uploadAvatar = async (blob) => {
    if (!blob) return null;
    try {
      const path = `avatars/${pid}-${Date.now()}`;
      const sref = storageRef(storage, path);
      await uploadBytes(sref, blob);
      const url = await getDownloadURL(sref);
      return url;
    } catch (e) {
      console.error("uploadAvatar failed", e);
      return null;
    }
  };

  // v20.2: guarda cambios de perfil (nombre + foto). Se usa tanto desde el
  // onboarding inicial como desde el modal de edición posterior.
  // params: { name, photoAction, newPhotoBlob }
  //   photoAction: "keep" | "upload" | "google" | "remove"
  // Devuelve { ok: boolean, errorKey?: string }
  const updateProfile = async ({ name, photoAction, newPhotoBlob }) => {
    // 1. Validar nombre localmente
    const localCheck = validateUsernameLocal(name);
    if (!localCheck.ok) return localCheck;
    const trimmedName = name.trim();
    // 2. Reclamar el nombre (unicidad atómica)
    const claim = await claimUsername(trimmedName, me.name);
    if (!claim.ok) return claim;
    // 3. Resolver foto
    let photoUrl = me.photo || null;
    if (photoAction === "upload" && newPhotoBlob) {
      const uploaded = await uploadAvatar(newPhotoBlob);
      if (uploaded) photoUrl = uploaded;
      else return { ok: false, errorKey: "nameErrorGeneric" };
    } else if (photoAction === "google") {
      photoUrl = me.googlePhoto || null;
    } else if (photoAction === "remove") {
      photoUrl = null;
    }
    // 4. Actualizar el player (name, photo, onboarded)
    try {
      await update(ref(db, `game/players/${pid}`), {
        name: trimmedName,
        photo: photoUrl,
        onboarded: true,
      });
      return { ok: true };
    } catch (e) {
      console.error("updateProfile failed", e);
      return { ok: false, errorKey: "nameErrorGeneric" };
    }
  };

  // v20: chequea si el comprador (pid) tiene cooldown activo sobre un artículo
  const getCooldownRemaining = (itemUid) => {
    const cd = game.cooldowns?.[pid]?.[itemUid];
    if (!cd || !cd.until) return 0;
    const rem = cd.until - Date.now();
    return rem > 0 ? rem : 0;
  };

  const showWalletLockedToast = (type) => {
    setToasts(prev => [...prev, {
      id: `walletlocked-${Date.now()}`,
      type,
      params: {},
      createdAt: Date.now(),
    }]);
  };

  const showCooldownToast = (itemUid) => {
    const rem = getCooldownRemaining(itemUid);
    if (rem <= 0) return;
    // Crear un toast "sistema" (no es una notificación real)
    const fakeId = `cooldown-${itemUid}-${Date.now()}`;
    setToasts(prev => [...prev, {
      id: fakeId,
      type: "cooldownToast",
      params: { time: formatTimeLeft(rem) },
      createdAt: Date.now(),
    }]);
  };

  const makeBuyOffer = async (mObj) => {
    const likeCount = getLikes(mObj.uid); if (likeCount === 0) return;
    // Chequeo 1: ya hay oferta activa en el artículo
    if (getItemOffer(mObj.uid)) {
      setToasts(prev => [...prev, { id: `err-${Date.now()}`, type: "offerHasActive", params: {}, createdAt: Date.now() }]);
      return;
    }
    // Chequeo 2: cooldown
    if (getCooldownRemaining(mObj.uid) > 0) {
      showCooldownToast(mObj.uid);
      return;
    }
    // Chequeo 3: billetera bloqueada (ya tiene una transacción activa como comprador)
    if (walletLocked) { showWalletLockedToast("walletLockedToastOffer"); return; }
    // Chequeo 4: saldo suficiente
    const debt = Math.abs(Math.min(0, me.likes || 0));
    let sr, dc;
    if ((me.likes || 0) >= 0) {
      if ((me.likes || 0) < likeCount) return;
      sr = likeCount; dc = 0;
    } else {
      if (likeCount < debt) return;
      sr = likeCount - debt; dc = debt;
    }
    // Crear offer con push
    const newOfferRef = push(ref(db, "game/offers"));
    const offerId = newOfferRef.key;
    const now = Date.now();
    const updates = {};
    updates[`offers/${offerId}`] = {
      itemUid: mObj.uid,
      itemSnapshot: { name: mObj.name, imageURL: mObj.imageURL || (Array.isArray(mObj.images) ? mObj.images[0] : "") || "" },
      ownerId: mObj.ownerId,
      buyerId: pid,
      price: likeCount,
      sellerReceives: sr,
      debtCancelled: dc,
      createdAt: now,
      expiresAt: now + OFFER_TTL_MS,
      status: "active",
    };
    updates[`market/${mObj.uid}/pendingOfferId`] = offerId;
    await update(ref(db, "game"), updates);
    addLog("system", `🛒 ${me.name} → "${mObj.name}" (${sr} ${t.likes})`, [pid, mObj.ownerId]);
    createNotif(mObj.ownerId, "notifBuyOffer", { user: me.name, item: mObj.name });
  };

  const rejectOffer = async (offerId) => {
    const o = offersMap[offerId];
    if (!o || o.status !== "active") return;
    const buyerId = o.buyerId;
    const ownerId = o.ownerId;
    const itemName = o.itemSnapshot?.name || "";
    const price = o.price || 0;
    const buyerData = players[buyerId] || {};
    const updates = {};
    updates[`offers/${offerId}`] = null;
    updates[`market/${o.itemUid}/pendingOfferId`] = null;
    updates[`players/${buyerId}/likedObjectId`] = null; // oferta rechazada: liberar like del comprador
    // Aplicar cooldown al buyer sobre este item
    updates[`cooldowns/${buyerId}/${o.itemUid}`] = { until: Date.now() + COOLDOWN_MS };
    await update(ref(db, "game"), updates);
    addLog("system", `❌ "${itemName}"`, [ownerId, buyerId]);
    createNotif(buyerId, "notifOfferRejected", { user: me.name, item: itemName });
  };

  // Abortar transacción por iniciativa del comprador (cubre fase de oferta y fase pending)
  const abortTransaction = async () => {
    if (inFlightOpsRef.current.has("abort")) return;
    inFlightOpsRef.current.add("abort");
    try {
      if (myBuyerOffer) {
        const o = myBuyerOffer;
        const updates = {};
        updates[`offers/${o.id}`] = null;
        updates[`market/${o.itemUid}/pendingOfferId`] = null;
        updates[`players/${pid}/likedObjectId`] = null; // abortar oferta: liberar like del comprador
        updates[`cooldowns/${pid}/${o.itemUid}`] = { until: Date.now() + COOLDOWN_MS };
        await update(ref(db, "game"), updates);
        addLog("system", `🚫 ${me.name}: "${o.itemSnapshot?.name || ""}"`, [pid, o.ownerId]);
        createNotif(o.ownerId, "notifTransactionAborted", { user: me.name, item: o.itemSnapshot?.name || "" });
      } else if (myBuyerPending) {
        await cancelPendingTransaction(myBuyerPending.id, "aborted");
      }
    } finally {
      inFlightOpsRef.current.delete("abort");
    }
  };

  // Cuando expira el timer de la oferta (no respondida): limpiar + aplicar cooldown
  // + notificar a ambas partes. Cualquiera de los dos clientes puede ejecutar
  // pero usamos runTransaction para evitar doble ejecución.
  const expireOfferById = async (offerId) => {
    const offerRef = ref(db, `game/offers/${offerId}`);
    // Transacción: solo el primero que llega cambia el status
    const res = await runTransaction(offerRef, (curr) => {
      if (!curr || curr.status !== "active") return; // abortar
      if (!curr.expiresAt || curr.expiresAt > Date.now()) return;
      curr.status = "expired";
      return curr;
    });
    if (!res.committed) return;
    const o = res.snapshot.val();
    if (!o) return;
    // Ya marcada como expired: ahora sí hago la limpieza (market, escrow, cooldown) y notifico
    const buyerId = o.buyerId;
    const ownerId = o.ownerId;
    const price = o.price || 0;
    const buyerData = players[buyerId] || {};
    const updates = {};
    updates[`offers/${offerId}`] = null;
    updates[`market/${o.itemUid}/pendingOfferId`] = null;
    updates[`players/${buyerId}/likedObjectId`] = null; // oferta expirada: liberar like del comprador
    updates[`cooldowns/${buyerId}/${o.itemUid}`] = { until: Date.now() + COOLDOWN_MS };
    await update(ref(db, "game"), updates);
    addLog("system", `⏱ "${o.itemSnapshot?.name || ""}"`, [ownerId, buyerId]);
    // Notificar a ambas partes
    createNotif(buyerId, "notifOfferExpired", { item: o.itemSnapshot?.name || "" });
    createNotif(ownerId, "notifOfferExpiredToSeller", { item: o.itemSnapshot?.name || "" });
  };

  const logColors = { sell: "#10b981", like: "#f59e0b", unlike: "#94a3b8", exhibit: "#8b5cf6", credit: "#ef4444", system: "#64748b" };
  const bottomH = 56;
  const headerH = 48;
  const searchBarH = 44;

  const inputStyle = { background: th.bgInput, border: `1px solid ${th.borderColor}`, borderRadius: "10px", padding: "12px", fontSize: "14px", color: th.text, width: "100%", outline: "none" };

  const closeAllDropdowns = () => { setCatDropdownOpen(false); setSearchModeOpen(false); setPubCatOpen(false); };

  const searchModeLabels = { categories: t.searchCategories, items: t.searchItems, users: t.searchUsers };
  const toggleCategoryIdx = (idx) => { setSelectedCategoryIdx(prev => prev.includes(idx) ? prev.filter(c => c !== idx) : [...prev, idx]); };

  // Arranca edición de un artículo: precarga pestaña Publish con sus datos
  const startEditItem = (mObj) => {
    setPubName(mObj.name || "");
    setPubDesc(mObj.description || "");
    setPubCategoryIdx(resolveCategoryIdx(mObj) >= 0 ? resolveCategoryIdx(mObj) : 0);
    const imgs = getItemImages(mObj);
    // En modo edición cargo las URLs existentes como "preview" sin blob.
    // Flag existingUrl se usa luego en publishProduct para reusar URL en vez de re-subir.
    setPubImages(imgs.map(url => ({ blob: null, preview: url, existingUrl: url })));
    // Detectar si es un item exhibido o withdrawn: son flujos distintos.
    if (mObj._sourceTag === "withdrawn") {
      // Editar un item no exhibido: guarda por índice en me.withdrawn[]
      setEditingWithdrawnIdx(mObj._withdrawnIdx);
      setEditingItemUid(null);
    } else if (mObj.uid && mObj.ownerId === pid) {
      // Editar un item exhibido en el market: guarda por uid
      setEditingItemUid(mObj.uid);
      setEditingWithdrawnIdx(null);
    } else {
      // Caso inesperado: no debería pasar. Abortamos silenciosamente.
      console.warn("startEditItem: item no editable", mObj);
      return;
    }
    setTab("publish");
    setFeedView(null); // cerrar modal si estaba abierto
  };

  // Renderiza una tarjeta completa del market (usada en el feed principal y en el modal fullscreen)
  const renderMarketCard = (mObj) => {
    // mObj puede venir del market o de me.withdrawn/obtained
    const isWithdrawnItem = mObj._sourceTag === "withdrawn";
    const isMarketItem = !!mObj.uid && !!mObj.ownerId && !isWithdrawnItem;
    const likeCount = isMarketItem ? getLikes(mObj.uid) : 0;
    const isLiked = isMarketItem && me.likedObjectId === mObj.uid;
    const isOwn = (isMarketItem && mObj.ownerId === pid) || isWithdrawnItem;
    const itemOffer = isMarketItem ? getItemOffer(mObj.uid) : null;
    const isLocked = !!itemOffer;
    const cdRemaining = isMarketItem ? getCooldownRemaining(mObj.uid) : 0;
    const debt = (me.likes || 0) < 0 ? Math.abs(me.likes) : 0;
    const canBuy = isMarketItem && isLiked && !isOwn && !isLocked && likeCount > 0 && cdRemaining === 0 && !walletLocked && ((me.likes || 0) >= 0 ? (me.likes || 0) >= likeCount : likeCount >= debt);
    const canBuyIndebted = canBuy && (me.likes || 0) < 0;
    const offerAmt = canBuyIndebted ? likeCount - debt : likeCount;
    const ownerData = isMarketItem ? players[mObj.ownerId] : players[pid];
    const hasLikers = isMarketItem && Object.values(players).some(p => p.likedObjectId === mObj.uid && mObj.ownerId !== pid);
    const catLabel = localizedCategory(mObj, lang);
    const itemImages = getItemImages(mObj);
    const likers = isMarketItem ? Object.entries(players).filter(([p, d]) => d.likedObjectId === mObj.uid && p !== mObj.ownerId) : [];
    const cardKey = mObj.uid || `${mObj.name}-${mObj.createdAt || 0}-${mObj._withdrawnIdx ?? ""}`;
    const likersExpanded = !!expandedLikers[cardKey];

    return (
      <div key={cardKey} style={{ marginBottom: "24px", borderBottom: `1px solid ${th.borderLight}`, paddingBottom: "16px" }}>
        {/* Owner bar */}
        <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: "8px" }}>
          {ownerData?.photo ? <img src={ownerData.photo} style={{ width: 32, height: 32, borderRadius: "50%" }} /> :
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: th.bgCard, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", color: th.textSecondary }}>{(ownerData?.name || "?")[0]}</div>}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "14px", fontWeight: 600, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span>{ownerData?.name || me.name}</span>
              <span style={{ fontSize: "10px", color: th.textMuted, fontWeight: 500 }}>{getRatingStr(ownerData || me)}</span>
            </div>
            <div style={{ fontSize: "11px", color: th.textMuted }}>{catLabel}</div>
          </div>
          {isLocked && <span style={{ marginLeft: "auto", background: "#f59e0b", color: "#000", fontSize: "9px", fontWeight: 800, padding: "2px 8px", borderRadius: "4px" }}>{t.offerLabel}</span>}
        </div>

        {/* Image carousel */}
        <div style={{ width: "100%", aspectRatio: "1/1", overflow: "hidden", background: th.imageBg }}>
          <ImageCarousel
            images={itemImages}
            theme={theme}
            t={t}
            onClick={() => { if (isMarketItem && !isLocked && !isOwn) toggleLike(mObj); }}
          />
        </div>

        {/* Actions below image */}
        <div style={{ padding: "10px 14px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
            <span onClick={() => { if (isMarketItem && !isLocked && !isOwn) toggleLike(mObj); }} style={{ fontSize: "24px", cursor: isMarketItem && !isOwn && !isLocked ? "pointer" : "default" }}>{isLiked ? "❤️" : "🤍"}</span>
            {isOwn ? (
              <span
                onClick={() => setExpandedLikers(prev => ({ ...prev, [cardKey]: !prev[cardKey] }))}
                style={{ fontSize: "14px", fontWeight: 700, cursor: likers.length > 0 ? "pointer" : "default", color: likers.length > 0 ? "#38bdf8" : th.text, display: "flex", alignItems: "center", gap: 4 }}
              >
                {likeCount} {t.likes}
                {likers.length > 0 && <span style={{ fontSize: 10 }}>{likersExpanded ? "▲" : "▼"}</span>}
              </span>
            ) : (
              <span style={{ fontSize: "14px", fontWeight: 700 }}>{likeCount} {t.likes}</span>
            )}
            {isLocked && <span style={{ fontSize: "11px", color: "#f59e0b", marginLeft: "auto" }}>🔒 {t.locked}</span>}
          </div>

          {/* Likers expandible (solo propio) */}
          {isOwn && likersExpanded && (
            <div style={{
              background: th.bgCard, borderRadius: 10, padding: "10px 12px",
              marginBottom: 10, border: `1px solid ${th.borderLight}`,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: th.textSecondary, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 }}>
                {t.likersTitle}
              </div>
              {likers.length === 0 ? (
                <div style={{ fontSize: 12, color: th.textMuted }}>{t.noLikers}</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {likers.map(([lp, ld]) => (
                    <div key={lp} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                      {ld.photo ? (
                        <img src={ld.photo} style={{ width: 22, height: 22, borderRadius: "50%" }} />
                      ) : (
                        <div style={{ width: 22, height: 22, borderRadius: "50%", background: th.bgInput, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: th.textSecondary }}>
                          {(ld.name || "?")[0]}
                        </div>
                      )}
                      <span style={{ flex: 1, color: th.text, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {ld.name} <span style={{ fontSize: 9, color: th.textMuted, fontWeight: 500 }}>{getRatingStr(ld)}</span>
                      </span>
                      <span style={{ color: (ld.likes || 0) >= 0 ? "#10b981" : "#ef4444", fontWeight: 700, fontSize: 11 }}>
                        {ld.likes || 0} ❤️
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ marginBottom: "8px" }}>
            <span style={{ fontSize: "14px", fontWeight: 700 }}>{mObj.name}</span>
            {mObj.description && <span style={{ fontSize: "13px", color: th.textSecondary, marginLeft: "8px" }}>{mObj.description}</span>}
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {isWithdrawnItem && (
              <>
                <button onClick={() => { exhibitFromWithdrawn(mObj._withdrawnIdx); setFeedView(null); }} style={{ background: "#8b5cf6", color: "#fff", border: "none", borderRadius: "8px", padding: "8px 20px", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
                  📦 {t.exhibit}
                </button>
                <button onClick={() => startEditItem(mObj)} style={{ background: th.bgInput, color: th.textSecondary, border: "none", borderRadius: "8px", padding: "8px 16px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>✏️ {t.editItem}</button>
                <button onClick={() => setDeleteModal({ source: "withdrawn", item: mObj, index: mObj._withdrawnIdx })} style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", padding: "8px 16px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>🗑 {t.deleteItem}</button>
              </>
            )}
            {isMarketItem && isOwn && !isLocked && (
              <>
                <button onClick={() => openSellModal(mObj)} style={{ background: hasLikers ? "#10b981" : th.bgInput, color: hasLikers ? "#fff" : th.textMuted, border: "none", borderRadius: "8px", padding: "8px 20px", fontSize: "13px", fontWeight: 700, cursor: hasLikers ? "pointer" : "default", opacity: hasLikers ? 1 : 0.5 }}>
                  {t.sell} {hasLikers ? `(${likeCount} ❤️)` : ""}
                </button>
                <button onClick={() => startEditItem(mObj)} style={{ background: th.bgInput, color: th.textSecondary, border: "none", borderRadius: "8px", padding: "8px 16px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>✏️ {t.editItem}</button>
                <button onClick={() => withdrawObject(mObj)} style={{ background: th.bgInput, color: th.textSecondary, border: "none", borderRadius: "8px", padding: "8px 16px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>{t.withdraw}</button>
              </>
            )}
            {canBuy && (
              <button onClick={() => makeBuyOffer(mObj)} style={{ background: canBuyIndebted ? "#f59e0b" : "#10b981", color: "#fff", border: "none", borderRadius: "8px", padding: "8px 20px", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
                {canBuyIndebted ? (offerAmt === 0 ? t.askDonation : `${t.offer} ${offerAmt} ❤️`) : `${t.buy} (${likeCount} ❤️)`}
              </button>
            )}
            {isMarketItem && !isOwn && cdRemaining > 0 && (
              <span style={{ fontSize: "11px", color: "#f59e0b", alignSelf: "center" }}>
                ⏳ {formatTimeLeft(cdRemaining)}
              </span>
            )}
            {isMarketItem && !isOwn && !isLiked && !isLocked && cdRemaining === 0 && <span style={{ fontSize: "12px", color: th.textMuted, alignSelf: "center" }}>{t.tapToLike}</span>}
            {isMarketItem && isLiked && !canBuy && !isOwn && cdRemaining === 0 && <span style={{ fontSize: "12px", color: "#f59e0b", alignSelf: "center" }}>{t.yourLike}</span>}
          </div>
        </div>
      </div>
    );
  };

  // Abrir un feed fullscreen.
  // sourceType: "active" | "history" | "liked" | "market"
  // startKey: identificador estable del item desde el cual empezar (market uid, o índice para arrays del player)
  const openFeedView = (title, sourceType, startKey) => {
    setFeedView({ title, sourceType, startKey });
  };

  return (
    <div style={{ minHeight: "100vh", background: th.bg, fontFamily: "'Segoe UI', system-ui, sans-serif", color: th.text, display: "flex", flexDirection: "column" }} onClick={closeAllDropdowns}>

      {/* HEADER - FIJO */}
      <div style={{
        position: "sticky", top: 0, zIndex: 60,
        height: headerH, padding: "0 12px",
        display: "flex", alignItems: "center", justifyContent: "flex-end",
        background: th.navBg, borderBottom: `1px solid ${th.borderLight}`,
        backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {/* Campanita de notificaciones */}
          <div ref={notifPanelRef} style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setNotifPanelOpen(o => !o)}
              style={{
                background: th.bgInput, border: `1px solid ${th.borderColor}`,
                borderRadius: "8px", padding: "5px 9px", fontSize: "14px",
                cursor: "pointer", color: th.text, position: "relative", lineHeight: 1,
              }}
              aria-label="Notifications"
            >
              🔔
              {unreadCount > 0 && (
                <span style={{
                  position: "absolute", top: -4, right: -4,
                  background: "#ef4444", color: "#fff",
                  fontSize: "9px", fontWeight: 800,
                  minWidth: 16, height: 16, borderRadius: 8,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: "0 4px", border: `2px solid ${th.bgSecondary}`,
                }}>{unreadCount > 99 ? "99+" : unreadCount}</span>
              )}
            </button>
            {notifPanelOpen && (
              <div style={{
                position: "fixed",
                top: headerH + 6,
                right: 8,
                left: "auto",
                width: "min(calc(100vw - 16px), 360px)",
                background: th.dropdown, border: `1px solid ${th.dropdownBorder}`,
                borderRadius: "12px", boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
                zIndex: 150, overflow: "hidden",
                display: "flex", flexDirection: "column",
                maxHeight: `calc(100vh - ${headerH + bottomH + 20}px)`,
              }}>
                <div style={{
                  padding: "10px 14px", borderBottom: `1px solid ${th.borderLight}`,
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  flexShrink: 0,
                }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: th.text }}>{t.notifications}</span>
                  {unreadCount > 0 && (
                    <button onClick={markAllNotifsRead} style={{
                      background: "transparent", border: "none",
                      color: "#38bdf8", fontSize: "11px", cursor: "pointer", fontWeight: 600,
                    }}>{t.markAllRead}</button>
                  )}
                </div>
                <div style={{ overflow: "auto", flex: 1 }}>
                  {notifList.length === 0 ? (
                    <div style={{ padding: "24px", textAlign: "center", fontSize: "12px", color: th.textMuted }}>
                      {t.noNotifications}
                    </div>
                  ) : notifList.map(n => (
                    <div
                      key={n.id}
                      onClick={() => { if (!n.read) markNotifRead(n.id, n.groupIds); }}
                      style={{
                        padding: "10px 14px", borderBottom: `1px solid ${th.borderLight}`,
                        fontSize: "12px", color: th.text, cursor: n.read ? "default" : "pointer",
                        background: n.read ? "transparent" : th.bgHover,
                        display: "flex", gap: "8px", alignItems: "flex-start",
                      }}
                    >
                      {!n.read && (
                        <span style={{
                          width: 8, height: 8, borderRadius: 4, background: "#38bdf8",
                          marginTop: 4, flexShrink: 0,
                        }} />
                      )}
                      <div style={{ flex: 1, lineHeight: 1.4 }}>{formatNotif(n)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button onClick={(e) => { e.stopPropagation(); toggleTheme(); }} style={{ background: th.bgInput, border: `1px solid ${th.borderColor}`, borderRadius: "8px", padding: "5px 9px", fontSize: "13px", cursor: "pointer", color: th.text, lineHeight: 1 }}>{theme === "dark" ? "☀️" : "🌙"}</button>
          <LanguageSelector lang={lang} setLang={setLang} theme={theme} />
        </div>
      </div>

      {/* SEARCH BAR - FIJA debajo del header cuando estamos en market */}
      {tab === "market" && (
        <div style={{
          position: "sticky", top: headerH, zIndex: 55,
          borderBottom: `1px solid ${th.borderLight}`,
          background: th.navBg,
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          flexShrink: 0,
        }}>
          <div style={{ maxWidth: "600px", margin: "0 auto", height: searchBarH, padding: "6px 12px", display: "flex", alignItems: "center", gap: "6px" }}>
            {/* Search mode selector */}
            <div style={{ position: "relative", minWidth: "100px" }} onClick={e => e.stopPropagation()}>
              <div onClick={() => setSearchModeOpen(!searchModeOpen)} style={{ background: th.bgInput, border: `1px solid ${th.borderColor}`, borderRadius: "8px", padding: "7px 10px", fontSize: "12px", color: th.text, cursor: "pointer" }}>
                {searchModeLabels[searchMode]}
              </div>
              {searchModeOpen && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: th.dropdown, border: `1px solid ${th.dropdownBorder}`, borderRadius: "8px", marginTop: "4px", zIndex: 50, boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
                  {["categories", "items", "users"].map(mode => (
                    <div key={mode} onClick={() => { setSearchMode(mode); setSearchText(""); setSelectedCategoryIdx([]); setSearchModeOpen(false); }}
                      style={{ padding: "8px 12px", fontSize: "12px", cursor: "pointer", color: searchMode === mode ? "#38bdf8" : th.text, background: searchMode === mode ? th.bgHover : "transparent" }}>
                      {searchModeLabels[mode]}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Search input / category selector */}
            {searchMode === "categories" ? (
              <div style={{ flex: 1, position: "relative" }} onClick={e => e.stopPropagation()}>
                <div onClick={() => setCatDropdownOpen(!catDropdownOpen)} style={{ background: th.bgInput, border: `1px solid ${th.borderColor}`, borderRadius: "8px", padding: "7px 10px", fontSize: "12px", color: selectedCategoryIdx.length ? th.text : th.textMuted, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {selectedCategoryIdx.length === 0 ? t.allCategories : selectedCategoryIdx.map(i => cats[i]).join(", ")}
                </div>
                {catDropdownOpen && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: th.dropdown, border: `1px solid ${th.dropdownBorder}`, borderRadius: "8px", marginTop: "4px", zIndex: 50, maxHeight: "280px", overflow: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
                    <div onClick={() => { setSelectedCategoryIdx([]); setCatDropdownOpen(false); }} style={{ padding: "10px 12px", fontSize: "12px", cursor: "pointer", color: selectedCategoryIdx.length === 0 ? "#38bdf8" : th.text, background: selectedCategoryIdx.length === 0 ? th.bgHover : "transparent", fontWeight: 600 }}>
                      {t.allCategories}
                    </div>
                    {cats.map((cat, i) => (
                      <div key={i} onClick={() => toggleCategoryIdx(i)} style={{ padding: "10px 12px", fontSize: "12px", cursor: "pointer", color: th.text, background: selectedCategoryIdx.includes(i) ? th.bgHover : "transparent", display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ width: 16, height: 16, borderRadius: "4px", border: `1.5px solid ${th.borderColor}`, background: selectedCategoryIdx.includes(i) ? "#38bdf8" : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "10px", color: "#fff" }}>
                          {selectedCategoryIdx.includes(i) && "✓"}
                        </span>
                        {cat}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <input type="text" value={searchText} onChange={e => setSearchText(e.target.value)} placeholder={searchMode === "users" ? t.searchPlaceholderUsers : t.searchPlaceholderItems}
                style={{ flex: 1, background: th.bgInput, border: `1px solid ${th.borderColor}`, borderRadius: "8px", padding: "7px 10px", fontSize: "12px", color: th.text, outline: "none" }} />
            )}
          </div>
        </div>
      )}

      {/* CONTENT */}
      <div style={{ flex: 1, paddingBottom: bottomH + 8 }}>

        {/* MARKET */}
        {tab === "market" && (
          <div style={{ maxWidth: "600px", margin: "0 auto" }}>
            {filteredItems.length === 0 ? (
              <p style={{ textAlign: "center", color: th.textMuted, padding: "60px 20px", fontSize: "14px" }}>{marketItems.length === 0 ? t.emptyMarket : t.noResults}</p>
            ) : filteredItems.map(mObj => renderMarketCard(mObj))}
          </div>
        )}

        {/* PUBLISH */}
        {tab === "publish" && (() => {
          const isEditing = !!editingItemUid || editingWithdrawnIdx !== null;
          return (
          <div style={{ padding: "20px 16px", maxWidth: "600px", margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
              <h2 style={{ fontSize: "18px", fontWeight: 700 }}>{isEditing ? t.editTitle : t.publishTitle}</h2>
              {isEditing && (
                <button
                  onClick={() => {
                    setEditingItemUid(null);
                    setEditingWithdrawnIdx(null);
                    setPubName(""); setPubDesc(""); setPubCategoryIdx(0); setPubImages([]);
                    setTab("profile");
                  }}
                  style={{
                    background: "transparent", border: `1px solid ${th.borderLight}`,
                    borderRadius: 8, padding: "6px 12px", fontSize: 11,
                    color: th.textSecondary, cursor: "pointer",
                  }}
                >
                  {t.cancel}
                </button>
              )}
            </div>

            {/* Preview principal */}
            <div
              onClick={() => pubImages.length === 0 && fileInputRef.current?.click()}
              style={{
                width: "100%", aspectRatio: "1/1", maxHeight: "340px",
                borderRadius: "12px", marginBottom: "10px",
                cursor: pubImages.length === 0 ? "pointer" : "default",
                border: `2px dashed ${th.borderColor}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                overflow: "hidden", background: th.bgCard,
              }}
            >
              {pubImages.length > 0 ? (
                <img src={pubImages[0].preview} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ color: th.textMuted, fontSize: "14px" }}>{t.uploadPhoto}</span>
              )}
            </div>

            {/* Slots: 4 miniaturas */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px", marginBottom: "12px" }}>
              {[0, 1, 2, 3].map(i => {
                const img = pubImages[i];
                return (
                  <div
                    key={i}
                    onClick={() => { if (!img && i === pubImages.length) fileInputRef.current?.click(); }}
                    style={{
                      position: "relative",
                      aspectRatio: "1/1",
                      borderRadius: "8px",
                      border: `1px dashed ${img ? "transparent" : th.borderColor}`,
                      background: img ? th.bgCard : "transparent",
                      overflow: "hidden",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: (!img && i === pubImages.length) ? "pointer" : "default",
                      opacity: (!img && i > pubImages.length) ? 0.4 : 1,
                    }}
                  >
                    {img ? (
                      <>
                        <img src={img.preview} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        {i === 0 && (
                          <span style={{
                            position: "absolute", bottom: 2, left: 2,
                            background: "rgba(56,189,248,0.9)", color: "#fff",
                            fontSize: 8, fontWeight: 700, padding: "1px 4px",
                            borderRadius: 3, textTransform: "uppercase",
                          }}>{t.mainPhoto}</span>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); removePubImage(i); }}
                          style={{
                            position: "absolute", top: 2, right: 2,
                            width: 18, height: 18, borderRadius: "50%",
                            background: "rgba(0,0,0,0.7)", color: "#fff",
                            border: "none", cursor: "pointer",
                            fontSize: 11, fontWeight: 700, lineHeight: 1,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}
                          aria-label="Remove"
                        >×</button>
                      </>
                    ) : i === pubImages.length ? (
                      <span style={{ fontSize: 22, color: th.textMuted, fontWeight: 300 }}>+</span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} style={{ display: "none" }} />
            <input type="text" placeholder={t.productName} value={pubName} onChange={e => setPubName(e.target.value)} maxLength={50} style={{ ...inputStyle, marginBottom: "10px" }} />
            <textarea placeholder={t.productDesc} value={pubDesc} onChange={e => setPubDesc(e.target.value.slice(0, 140))} rows={2} style={{ ...inputStyle, marginBottom: "4px", resize: "none" }} />
            <div style={{ fontSize: "11px", color: th.textMuted, textAlign: "right", marginBottom: "10px" }}>{pubDesc.length}/140</div>
            {/* Custom category dropdown - índice */}
            <div style={{ position: "relative", marginBottom: "16px" }} onClick={e => e.stopPropagation()}>
              <div onClick={() => setPubCatOpen(!pubCatOpen)} style={{ ...inputStyle, cursor: "pointer", color: th.text }}>
                {cats[pubCategoryIdx] || t.selectCategory}
              </div>
              {pubCatOpen && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: th.dropdown, border: `1px solid ${th.dropdownBorder}`, borderRadius: "10px", marginTop: "4px", zIndex: 50, maxHeight: "240px", overflow: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
                  {cats.map((c, i) => (
                    <div key={i} onClick={() => { setPubCategoryIdx(i); setPubCatOpen(false); }} style={{ padding: "10px 14px", fontSize: "13px", cursor: "pointer", color: th.text, background: pubCategoryIdx === i ? th.bgHover : "transparent" }}>{c}</div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={publishProduct} disabled={publishing || !pubName.trim() || pubImages.length === 0}
              style={{ width: "100%", background: "linear-gradient(135deg, #8b5cf6, #6d28d9)", color: "#fff", border: "none", borderRadius: "12px", padding: "14px", fontSize: "15px", fontWeight: 700, cursor: "pointer", opacity: publishing || !pubName.trim() || pubImages.length === 0 ? 0.5 : 1 }}>
              {publishing ? (isEditing ? t.saving : t.publishing) : (isEditing ? t.saveChanges : t.publish)}
            </button>
          </div>
          );
        })()}

        {/* PROFILE */}
        {tab === "profile" && (() => {
          // Activos: los del market cuyo ownerId soy yo (exhibidos) + los de me.withdrawn (no exhibidos)
          const myMarketItems = marketItems.filter(mi => mi.ownerId === pid);
          const myWithdrawn = me.withdrawn || [];
          const myHistory = me.obtained || [];
          const myDelivered = me.delivered || [];
          const myLikedItem = me.likedObjectId
            ? (marketItems.find(mi => mi.uid === me.likedObjectId) ||
               (myBuyerPending?.itemUid === me.likedObjectId
                 ? { ...myBuyerPending.itemSnapshot, uid: myBuyerPending.itemUid }
                 : null))
            : null;
          // Combinar exhibidos + retirados para el feed de "Mis artículos".
          // Guardamos _withdrawnIdx en cada item de withdrawn para poder referenciarlo después.
          const myActiveFeed = [
            ...myMarketItems.map(mi => ({ ...mi, _sourceTag: "exhibited" })),
            ...myWithdrawn.map((w, wi) => ({ ...w, _sourceTag: "withdrawn", _withdrawnIdx: wi })),
          ];
          // v20: total de mensajes no leídos en mis transacciones pendientes
          const totalUnread = myPending.reduce((sum, ptx) => sum + countUnreadInPending(ptx), 0);
          return (
            <div style={{ padding: "20px 16px", maxWidth: "600px", margin: "0 auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
                {/* v20.2: avatar con overlay de cámara */}
                <div
                  onClick={() => setProfileEditOpen(true)}
                  style={{
                    position: "relative", width: 48, height: 48, flexShrink: 0,
                    cursor: "pointer",
                  }}
                  title={t.profileChangePhotoTooltip}
                >
                  {me.photo ? (
                    <img src={me.photo} style={{ width: 48, height: 48, borderRadius: "50%", display: "block" }} />
                  ) : (
                    <div style={{ width: 48, height: 48, borderRadius: "50%", background: th.bgCard, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700, color: th.textSecondary }}>
                      {(me.name || "?")[0].toUpperCase()}
                    </div>
                  )}
                  <div style={{
                    position: "absolute", bottom: -2, right: -2,
                    width: 18, height: 18, borderRadius: "50%",
                    background: "#0ea5e9", color: "#fff",
                    border: `2px solid ${th.bg}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 800,
                  }}>
                    ✎
                  </div>
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <div style={{ fontSize: "16px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{me.name}</div>
                    <button
                      onClick={() => setProfileEditOpen(true)}
                      title={t.profileEditTooltip}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: th.textMuted, fontSize: 13, padding: 2,
                        lineHeight: 1, flexShrink: 0,
                      }}
                      aria-label={t.profileEditTooltip}
                    >
                      ✎
                    </button>
                  </div>
                  <div style={{ fontSize: "11px", color: th.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {getRatingStr(me)}
                  </div>
                  {user.email && (
                    <div style={{ fontSize: "11px", color: th.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {user.email}
                    </div>
                  )}
                </div>
                {/* Hamburger menu */}
                <div ref={profileMenuRef} style={{ position: "relative", flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => setProfileMenuOpen(o => !o)}
                    style={{
                      background: th.bgCard, border: `1px solid ${th.borderColor}`,
                      borderRadius: "8px", padding: "8px 10px", cursor: "pointer",
                      color: th.text, display: "flex", alignItems: "center", justifyContent: "center",
                      lineHeight: 1,
                    }}
                    aria-label={t.menu}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="3" y1="6" x2="21" y2="6"></line>
                      <line x1="3" y1="12" x2="21" y2="12"></line>
                      <line x1="3" y1="18" x2="21" y2="18"></line>
                    </svg>
                  </button>
                  {profileMenuOpen && (
                    <div style={{
                      position: "absolute", top: "100%", right: 0, marginTop: 6,
                      minWidth: 180,
                      background: th.dropdown, border: `1px solid ${th.dropdownBorder}`,
                      borderRadius: 10, boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
                      zIndex: 120, overflow: "hidden",
                    }}>
                      <div
                        onClick={() => { setProfileMenuOpen(false); setActivityModalOpen(true); }}
                        style={{
                          padding: "12px 14px", fontSize: 13, color: th.text,
                          cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                          borderBottom: `1px solid ${th.borderLight}`,
                        }}
                      >
                        <span style={{ fontSize: 16 }}>📋</span>
                        <span>{t.myActivity}</span>
                      </div>
                      <div
                        onClick={() => { setProfileMenuOpen(false); onLogout(); }}
                        style={{
                          padding: "12px 14px", fontSize: 13, color: "#ef4444",
                          cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                          fontWeight: 600,
                        }}
                      >
                        <span style={{ fontSize: 16 }}>🚪</span>
                        <span>{t.logout}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
                {/* IZQUIERDA: Billetera */}
                <div style={{
                  flex: 1, background: th.bgCard, borderRadius: "12px",
                  padding: "14px", border: `1px solid ${walletLocked ? "rgba(245,158,11,0.4)" : th.borderLight}`,
                  display: "flex", flexDirection: "column", gap: 6, minWidth: 0,
                }}>
                  <div style={{ fontSize: "10px", color: th.textSecondary, textTransform: "uppercase", letterSpacing: 0.3, fontWeight: 700 }}>
                    {t.walletTitle}
                  </div>
                  <div style={{ fontSize: "26px", fontWeight: 800, color: (me.likes || 0) >= 0 ? "#10b981" : "#ef4444", lineHeight: 1.1 }}>
                    {me.likes || 0} ❤️
                  </div>
                  {walletLocked && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ fontSize: "10px", color: "#f59e0b", fontWeight: 700 }}>
                        🔒 {t.walletLockedLabel}
                      </div>
                      <button
                        onClick={abortTransaction}
                        style={{
                          background: "rgba(239,68,68,0.15)",
                          border: "1px solid rgba(239,68,68,0.3)",
                          borderRadius: 6, padding: "5px 8px",
                          fontSize: 10, fontWeight: 700, cursor: "pointer",
                          color: "#ef4444", alignSelf: "flex-start",
                        }}
                      >
                        {t.abortOffer}
                      </button>
                    </div>
                  )}
                </div>

                {/* DERECHA: Like activo */}
                <div style={{
                  flex: 1, background: th.bgCard, borderRadius: "12px",
                  padding: "14px", border: `1px solid ${th.borderLight}`,
                  display: "flex", flexDirection: "column", minWidth: 0,
                }}>
                  <div style={{ fontSize: "10px", color: th.textSecondary, textTransform: "uppercase", letterSpacing: 0.3, fontWeight: 700, marginBottom: 8 }}>
                    {t.likeStatus}
                  </div>
                  {myLikedItem ? (
                    <div
                      onClick={() => {
                        if (myBuyerPending && myBuyerPending.itemUid === me.likedObjectId) {
                          openFeedView(t.walletPending, "pending", `p:${myBuyerPending.id}`);
                        } else {
                          openFeedView(t.likeStatus, "liked", `m:${myLikedItem.uid}`);
                        }
                      }}
                      style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flex: 1, minWidth: 0 }}
                    >
                      <div style={{ width: 44, height: 44, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: th.bgInput }}>
                        <ItemImage src={getItemImages(myLikedItem)[0]} theme={theme} t={t} />
                      </div>
                      <div style={{ fontSize: 11, color: th.text, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {myLikedItem.name}
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, gap: 6 }}>
                      <div style={{ fontSize: 11, color: th.textMuted, lineHeight: 1.3 }}>
                        {t.likeNotAssigned}
                      </div>
                      <button
                        onClick={() => setTab("market")}
                        style={{
                          background: "rgba(56,189,248,0.15)",
                          color: "#38bdf8",
                          border: "1px solid rgba(56,189,248,0.3)",
                          borderRadius: 6, padding: "5px 8px",
                          fontSize: 10, fontWeight: 700, cursor: "pointer",
                          alignSelf: "flex-start",
                        }}
                      >
                        {t.goToMarket}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Sub-tabs */}
              <div style={{
                display: "flex", gap: 0, marginBottom: "14px",
                background: th.bgCard, borderRadius: 10,
                padding: 3, border: `1px solid ${th.borderLight}`,
              }}>
                {[
                  { id: "active", label: t.walletActive, count: myMarketItems.length + myWithdrawn.length },
                  { id: "pending", label: t.walletPending, count: myPending.length, unread: totalUnread },
                  { id: "history", label: t.walletHistory, count: myHistory.length },
                  { id: "delivered", label: t.walletDelivered, count: myDelivered.length },
                ].map(st => (
                  <button
                    key={st.id}
                    onClick={() => setWalletSubTab(st.id)}
                    style={{
                      flex: 1, background: walletSubTab === st.id ? th.bgHover : "transparent",
                      border: "none", borderRadius: 8, padding: "8px 8px",
                      fontSize: 12, fontWeight: 600,
                      color: walletSubTab === st.id ? th.text : th.textSecondary,
                      cursor: "pointer",
                      position: "relative",
                    }}
                  >
                    {st.label} <span style={{ color: th.textMuted, fontWeight: 500 }}>({st.count})</span>
                    {st.unread > 0 && (
                      <span style={{
                        position: "absolute", top: 2, right: 2,
                        background: "#ef4444", color: "#fff",
                        fontSize: 9, fontWeight: 800,
                        padding: "1px 5px", borderRadius: 8,
                        minWidth: 14, textAlign: "center", lineHeight: 1.2,
                      }}>{st.unread}</span>
                    )}
                  </button>
                ))}
              </div>

              {walletSubTab === "active" && (
                <>
                  {myActiveFeed.length === 0 ? (
                    <p style={{ color: th.textMuted, fontSize: "13px" }}>{t.nothingActive}</p>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "10px" }}>
                      {myActiveFeed.map((item, idx) => {
                        const imgs = getItemImages(item);
                        const isExhibited = item._sourceTag === "exhibited";
                        const isLocked = isExhibited && !!getItemOffer(item.uid);
                        const likeCount = isExhibited ? getLikes(item.uid) : 0;
                        const withdrawnIdx = !isExhibited ? item._withdrawnIdx : -1;
                        return (
                          <div key={isExhibited ? `m-${item.uid}` : `w-${idx}`} style={{ background: th.bgCard, borderRadius: "10px", overflow: "hidden", border: `1px solid ${th.borderLight}` }}>
                            <div
                              onClick={() => openFeedView(t.walletActive, "active", isExhibited ? `m:${item.uid}` : `w:${item._withdrawnIdx}`)}
                              style={{ aspectRatio: "1/1", overflow: "hidden", position: "relative", cursor: "pointer" }}
                            >
                              <ItemImage src={imgs[0]} theme={theme} t={t} />
                              <span style={{
                                position: "absolute", top: 4, left: 4,
                                background: isExhibited ? "rgba(16,185,129,0.9)" : "rgba(100,116,139,0.9)",
                                color: "#fff",
                                fontSize: 9, fontWeight: 700, padding: "2px 6px",
                                borderRadius: 4, textTransform: "uppercase",
                              }}>{isExhibited ? t.statusExhibited : t.statusNotExhibited}</span>
                              {isExhibited && (
                                <span style={{
                                  position: "absolute", top: 4, right: 4,
                                  background: "rgba(0,0,0,0.7)", color: "#fff",
                                  fontSize: 10, fontWeight: 700, padding: "2px 7px",
                                  borderRadius: 10,
                                }}>❤️ {likeCount}</span>
                              )}
                            </div>
                            <div style={{ padding: "6px" }}>
                              <div style={{ fontSize: "11px", fontWeight: 600, marginBottom: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                              <div style={{ display: "flex", gap: 4 }}>
                                {isExhibited ? (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); withdrawObject(item); }}
                                    disabled={isLocked}
                                    style={{
                                      flex: 1,
                                      background: "rgba(100,116,139,0.15)",
                                      border: "1px solid rgba(100,116,139,0.3)",
                                      borderRadius: "6px", padding: "4px",
                                      fontSize: "10px", color: th.textSecondary,
                                      cursor: isLocked ? "not-allowed" : "pointer",
                                      opacity: isLocked ? 0.5 : 1,
                                    }}
                                  >
                                    {t.unexhibit}
                                  </button>
                                ) : (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); exhibitFromWithdrawn(withdrawnIdx); }}
                                    style={{
                                      flex: 1,
                                      background: "rgba(139,92,246,0.15)",
                                      border: "1px solid rgba(139,92,246,0.3)",
                                      borderRadius: "6px", padding: "4px",
                                      fontSize: "10px", color: "#8b5cf6", cursor: "pointer",
                                    }}
                                  >
                                    {t.exhibit}
                                  </button>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isExhibited) setDeleteModal({ source: "market", item });
                                    else setDeleteModal({ source: "withdrawn", item, index: withdrawnIdx });
                                  }}
                                  disabled={isExhibited && isLocked}
                                  title={isExhibited && isLocked ? t.cantDeleteWithOffer : t.deleteItem}
                                  style={{
                                    background: "rgba(239,68,68,0.12)",
                                    border: "1px solid rgba(239,68,68,0.3)",
                                    borderRadius: "6px", padding: "4px 6px",
                                    fontSize: "11px", color: "#ef4444",
                                    cursor: (isExhibited && isLocked) ? "not-allowed" : "pointer",
                                    opacity: (isExhibited && isLocked) ? 0.5 : 1,
                                    lineHeight: 1,
                                  }}
                                  aria-label="Delete"
                                >🗑</button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {walletSubTab === "pending" && (
                <>
                  {myPending.length === 0 ? (
                    <p style={{ color: th.textMuted, fontSize: "13px" }}>{t.nothingPending}</p>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "10px" }}>
                      {myPending
                        .slice()
                        .sort((a, b) => (a.expiresAt || 0) - (b.expiresAt || 0))
                        .map((ptx) => {
                          const imgs = getItemImages(ptx.itemSnapshot || {});
                          const iAmBuyer = ptx.buyerId === pid;
                          const otherId = iAmBuyer ? ptx.ownerId : ptx.buyerId;
                          const other = players[otherId] || {};
                          const remaining = (ptx.expiresAt || 0) - Date.now();
                          const timeLeftStr = remaining > 0 ? formatTimeLeft(remaining) : t.pendingExpired;
                          const unread = countUnreadInPending(ptx);
                          const myVote = ptx.closeVotes?.[pid];
                          const otherVote = ptx.closeVotes?.[otherId];
                          const waitingOther = myVote && !otherVote;
                          return (
                            <div
                              key={ptx.id}
                              onClick={() => openFeedView(t.walletPending, "pending", `p:${ptx.id}`)}
                              style={{ background: th.bgCard, borderRadius: "10px", overflow: "hidden", border: `1px solid ${th.borderLight}`, cursor: "pointer", position: "relative" }}
                            >
                              <div style={{ aspectRatio: "1/1", overflow: "hidden", position: "relative" }}>
                                <ItemImage src={imgs[0]} theme={theme} t={t} />
                                {/* Badge unread */}
                                {unread > 0 && (
                                  <span style={{
                                    position: "absolute", top: 4, right: 4,
                                    background: "#ef4444", color: "#fff",
                                    fontSize: 10, fontWeight: 800, padding: "2px 6px",
                                    borderRadius: 10, minWidth: 16, textAlign: "center",
                                  }}>{unread}</span>
                                )}
                                {/* Badge "waiting other" o "voted" */}
                                {waitingOther && (
                                  <span style={{
                                    position: "absolute", bottom: 4, left: 4,
                                    background: "rgba(245,158,11,0.9)", color: "#fff",
                                    fontSize: 9, fontWeight: 700, padding: "2px 6px",
                                    borderRadius: 4,
                                  }}>⏳</span>
                                )}
                              </div>
                              <div style={{ padding: "6px" }}>
                                <div style={{ fontSize: "10px", color: remaining < 24*60*60*1000 ? "#ef4444" : th.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 600 }}>
                                  ⏱ {timeLeftStr}
                                </div>
                                <div style={{ fontSize: "11px", fontWeight: 600, color: th.textSecondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {(iAmBuyer ? t.pendingReceiveFrom : t.pendingDeliverTo).replace("{user}", other.name || "?")}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </>
              )}

              {walletSubTab === "history" && (
                <>
                  {myHistory.length === 0 ? (
                    <p style={{ color: th.textMuted, fontSize: "13px" }}>{t.nothingInHistory}</p>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "10px" }}>
                      {myHistory.map((obj, i) => {
                        const imgs = getItemImages(obj);
                        const fromUser = obj.fromId && players[obj.fromId] ? players[obj.fromId].name : null;
                        const dateStr = obj.date ? new Date(obj.date).toLocaleDateString(lang) : null;
                        return (
                          <div
                            key={i}
                            onClick={() => openFeedView(t.walletHistory, "history", `h:${i}`)}
                            style={{ background: th.bgCard, borderRadius: "10px", overflow: "hidden", border: `1px solid ${th.borderLight}`, cursor: "pointer" }}
                          >
                            <div style={{ aspectRatio: "1/1", overflow: "hidden" }}>
                              <ItemImage src={imgs[0]} theme={theme} t={t} />
                            </div>
                            <div style={{ padding: "6px" }}>
                              {dateStr && (
                                <div style={{ fontSize: "10px", color: th.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {dateStr}
                                </div>
                              )}
                              {fromUser && (
                                <div style={{ fontSize: "11px", fontWeight: 600, color: th.textSecondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {t.receivedFrom} {fromUser}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {walletSubTab === "delivered" && (
                <>
                  {myDelivered.length === 0 ? (
                    <p style={{ color: th.textMuted, fontSize: "13px" }}>{t.nothingDelivered}</p>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "10px" }}>
                      {myDelivered.map((obj, i) => {
                        const imgs = getItemImages(obj);
                        const toUser = obj.toId && players[obj.toId] ? players[obj.toId].name : null;
                        const dateStr = obj.date ? new Date(obj.date).toLocaleDateString(lang) : null;
                        return (
                          <div
                            key={i}
                            onClick={() => openFeedView(t.walletDelivered, "delivered", `d:${i}`)}
                            style={{ background: th.bgCard, borderRadius: "10px", overflow: "hidden", border: `1px solid ${th.borderLight}`, cursor: "pointer" }}
                          >
                            <div style={{ aspectRatio: "1/1", overflow: "hidden" }}>
                              <ItemImage src={imgs[0]} theme={theme} t={t} />
                            </div>
                            <div style={{ padding: "6px" }}>
                              {dateStr && (
                                <div style={{ fontSize: "10px", color: th.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {dateStr}
                                </div>
                              )}
                              {toUser && (
                                <div style={{ fontSize: "11px", fontWeight: 600, color: th.textSecondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {t.deliveredTo} {toUser}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

            </div>
          );
        })()}
      </div>

      {/* BOTTOM NAV */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: bottomH, background: th.navBg, borderTop: `1px solid ${th.borderLight}`, zIndex: 40, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
        <div style={{ maxWidth: "600px", height: "100%", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-around" }}>
          {[{ id: "publish", icon: "➕", label: t.tabPublish }, { id: "market", icon: "🏪", label: t.tabMarket }, { id: "profile", icon: "👤", label: t.tabProfile }].map(item => (
            <button key={item.id} onClick={() => setTab(item.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", color: tab === item.id ? "#38bdf8" : th.textMuted, transition: "color 0.2s" }}>
              <span style={{ fontSize: "20px" }}>{item.icon}</span>
              <span style={{ fontSize: "10px", fontWeight: 600 }}>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* TOASTS */}
      <div style={{
        position: "fixed", top: headerH + 12, left: "50%", transform: "translateX(-50%)",
        zIndex: 200, display: "flex", flexDirection: "column", gap: "8px",
        pointerEvents: "none", width: "min(92vw, 360px)",
      }}>
        {toasts.map(toast => (
          <div key={toast.id} style={{
            background: th.modalBg, border: `1px solid ${th.borderColor}`,
            borderLeft: "3px solid #38bdf8",
            borderRadius: "10px", padding: "10px 14px",
            fontSize: "12px", color: th.text,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            pointerEvents: "auto", cursor: "pointer",
            animation: "slideDown 0.3s ease-out",
          }} onClick={() => setToasts(prev => prev.filter(x => x.id !== toast.id))}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "16px" }}>🔔</span>
              <span style={{ flex: 1, lineHeight: 1.4 }}>
                {(() => {
                  const tmpl = t[toast.type] || "";
                  const p = toast.params || {};
                  return tmpl
                    .replace("{user}", p.user || "")
                    .replace("{item}", p.item || "")
                    .replace("{amount}", p.amount != null ? String(p.amount) : "")
                    .replace("{time}", p.time || "")
                    .replace("{choice}", p.choice || "");
                })()}
              </span>
            </div>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes slideDown {
          from { transform: translateY(-20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      {/* INCOMING OFFER BANNER (vendedor) - ya no es modal bloqueante, es un banner fijo */}
      {incomingOffer && (() => {
        const buyer = players[incomingOffer.buyerId] || {};
        const remaining = (incomingOffer.expiresAt || 0) - Date.now();
        const timeLeft = formatTimeLeft(remaining);
        return (
          <div style={{
            position: "fixed", bottom: bottomH + 8, left: 8, right: 8,
            background: th.modalBg, border: `1px solid ${th.borderColor}`,
            borderRadius: "12px", padding: "12px 14px", zIndex: 450,
            boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
            maxWidth: 600, margin: "0 auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
              <h3 style={{ fontSize: "13px", color: "#f59e0b", fontWeight: 700 }}>🛒 {t.buyOffer}</h3>
              <span style={{ fontSize: "11px", fontWeight: 700, color: remaining < 3600000 ? "#ef4444" : "#f59e0b" }}>⏱ {timeLeft}</span>
            </div>
            <p style={{ fontSize: "12px", color: th.textSecondary, marginBottom: 10, lineHeight: 1.4 }}>
              <strong style={{ color: th.text }}>{buyer.name || "?"}</strong>{" "}
              <span style={{ fontSize: 10, color: th.textMuted }}>{getRatingStr(buyer)}</span>{" "}
              {t.wantsToBuy} <strong style={{ color: th.text }}>"{incomingOffer.itemSnapshot?.name || ""}"</strong>.
              {incomingOffer.debtCancelled > 0 && <> {t.debtOf} {incomingOffer.debtCancelled}. </>}
              {t.youWouldReceive} <strong style={{ color: "#10b981" }}>{incomingOffer.sellerReceives} ❤️</strong>.
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => acceptOffer(incomingOffer.id)} style={{ flex: 1, background: "#10b981", color: "#fff", border: "none", borderRadius: "8px", padding: "10px", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>✅ {t.accept}</button>
              <button onClick={() => rejectOffer(incomingOffer.id)} style={{ flex: 1, background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", padding: "10px", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>❌ {t.reject}</button>
            </div>
            {myIncomingOffers.length > 1 && (
              <div style={{ fontSize: 10, color: th.textMuted, marginTop: 6, textAlign: "center" }}>
                {t.andOthers.replace("{n}", String(myIncomingOffers.length - 1))}
              </div>
            )}
          </div>
        );
      })()}

      {/* OUTGOING OFFER WAITING BANNER (comprador) */}
      {outgoingOffer && !incomingOffer && (() => {
        const remaining = (outgoingOffer.expiresAt || 0) - Date.now();
        const timeLeft = formatTimeLeft(remaining);
        return (
          <div style={{ position: "fixed", bottom: bottomH + 8, left: "50%", transform: "translateX(-50%)", background: th.modalBg, border: `1px solid ${th.borderColor}`, borderRadius: "12px", padding: "10px 20px", zIndex: 450, display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#f59e0b", fontSize: "12px", fontWeight: 600 }}>
              {t.waitingResponse} · {t.offerExpiresIn.replace("{time}", timeLeft)}
            </span>
          </div>
        );
      })()}

      {/* SALE MODAL */}
      {saleModal && (
        <div style={{ position: "fixed", inset: 0, background: th.overlayBg, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: "16px" }}>
          <div style={{ background: th.modalBg, borderRadius: "16px", padding: "20px", maxWidth: "360px", width: "100%", border: `1px solid ${th.borderColor}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <h3 style={{ fontSize: "16px" }}>💰 {t.sellTitle} "{saleModal.name}"</h3>
              <span style={{ fontSize: "14px", fontWeight: 800, color: saleTimer <= 3 ? "#ef4444" : "#f59e0b" }}>⏱ {saleTimer}s</span>
            </div>
            <div style={{ height: 3, background: th.bgInput, borderRadius: 2, marginBottom: 12, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(saleTimer / 10) * 100}%`, background: saleTimer <= 3 ? "#ef4444" : "#f59e0b", transition: "width 1s linear" }} />
            </div>
            <p style={{ fontSize: "12px", color: th.textSecondary, marginBottom: "10px" }}>{t.value}: <strong style={{ color: "#f59e0b" }}>{saleModal.basePrice} ❤️</strong></p>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
              {saleModal.likers.map(([lp, ld]) => {
                const ind = (ld.likes || 0) < 0; const lD = ind ? Math.abs(ld.likes) : 0;
                const canA = ind ? saleModal.basePrice >= lD : true; const sr = ind ? saleModal.basePrice - lD : saleModal.basePrice;
                const dc = ind ? lD : 0; const blocked = ind && !canA;
                return (
                  <button key={lp} onClick={blocked ? undefined : () => createPendingFromDirectSale(saleModal, lp, sr, dc)} disabled={blocked}
                    style={{ background: blocked ? "rgba(239,68,68,0.06)" : th.bgCard, border: `1px solid ${blocked ? "rgba(239,68,68,0.15)" : th.borderLight}`, borderRadius: "8px", padding: "10px", color: blocked ? th.textMuted : th.text, cursor: blocked ? "not-allowed" : "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", opacity: blocked ? 0.6 : 1 }}>
                    <div style={{ textAlign: "left" }}>
                      <div style={{ fontSize: "13px", fontWeight: 600 }}>{ld.name}</div>
                      <div style={{ fontSize: "10px", color: th.textSecondary }}>
                        {ld.likes || 0} {t.likes}
                        {ind && canA && <span style={{ color: "#f59e0b" }}> ({t.youWouldGet} {sr})</span>}
                        {blocked && <span style={{ color: "#ef4444" }}> ({t.debtExceeds})</span>}
                        {!ind && (ld.likes || 0) < saleModal.basePrice && <span style={{ color: "#f59e0b" }}> ({t.credit})</span>}
                      </div>
                    </div>
                    {!blocked && <span style={{ color: "#10b981", fontWeight: 700 }}>→</span>}
                  </button>
                );
              })}
            </div>
            <button onClick={() => setSaleModal(null)} style={{ width: "100%", background: "transparent", color: th.textMuted, border: `1px solid ${th.borderLight}`, borderRadius: "8px", padding: "10px", fontSize: "12px", cursor: "pointer" }}>{t.cancel}</button>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteModal && (() => {
        const { source, item } = deleteModal;
        const itemImgs = getItemImages(item);
        // Calcular likers si es del market (exhibido)
        const likesN = source === "market"
          ? Object.values(players).filter(p => p.likedObjectId === item.uid).length
          : 0;
        const bodyText = likesN > 0
          ? (t.deleteConfirmTextWithLikes || t.deleteConfirmText).replace("{n}", String(likesN))
          : t.deleteConfirmText;
        return (
          <div style={{ position: "fixed", inset: 0, background: th.overlayBg, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: "16px" }}>
            <div style={{ background: th.modalBg, borderRadius: "16px", padding: "20px", maxWidth: "360px", width: "100%", border: `1px solid ${th.borderColor}` }}>
              <h3 style={{ fontSize: "16px", color: "#ef4444", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
                🗑 {t.deleteConfirmTitle}
              </h3>
              <div style={{ display: "flex", gap: "12px", marginBottom: "14px", alignItems: "center" }}>
                <div style={{ width: 56, height: 56, borderRadius: 10, overflow: "hidden", flexShrink: 0, background: th.bgCard }}>
                  <ItemImage src={itemImgs[0]} theme={theme} t={t} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: th.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                  {item.description && (
                    <div style={{ fontSize: 11, color: th.textSecondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.description}</div>
                  )}
                </div>
              </div>
              <p style={{ fontSize: "12px", color: th.textSecondary, marginBottom: "16px", lineHeight: 1.5 }}>
                {bodyText}
              </p>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => setDeleteModal(null)}
                  style={{ flex: 1, background: "transparent", color: th.textSecondary, border: `1px solid ${th.borderLight}`, borderRadius: "10px", padding: "12px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
                >
                  {t.cancel}
                </button>
                <button
                  onClick={confirmDelete}
                  style={{ flex: 1, background: "#ef4444", color: "#fff", border: "none", borderRadius: "10px", padding: "12px", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}
                >
                  🗑 {t.deleteConfirm}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MY ACTIVITY FULLSCREEN MODAL */}
      {activityModalOpen && (() => {
        const myEntries = (game.log ? Object.values(game.log) : [])
          .filter(e => Array.isArray(e.actors) && e.actors.includes(pid))
          .sort((a, b) => (b.time || 0) - (a.time || 0));
        const fmtTime = (ts) => {
          if (!ts) return "";
          try {
            const d = new Date(ts);
            const now = new Date();
            const sameDay = d.toDateString() === now.toDateString();
            const pad = (n) => String(n).padStart(2, "0");
            if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
            return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
          } catch { return ""; }
        };
        return (
          <div style={{
            position: "fixed", inset: 0, background: th.bg, zIndex: 300,
            display: "flex", flexDirection: "column",
            fontFamily: "'Segoe UI', system-ui, sans-serif", color: th.text,
          }}>
            {/* Header */}
            <div style={{
              height: 52, flexShrink: 0,
              padding: "0 12px", display: "flex", alignItems: "center", gap: 10,
              borderBottom: `1px solid ${th.borderLight}`, background: th.bgSecondary,
            }}>
              <button
                onClick={() => setActivityModalOpen(false)}
                style={{
                  background: th.bgCard, border: `1px solid ${th.borderColor}`,
                  borderRadius: 8, padding: "6px 10px", cursor: "pointer",
                  color: th.text, display: "flex", alignItems: "center", gap: 6,
                  fontSize: 13, fontWeight: 600,
                }}
                aria-label={t.back}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12"></line>
                  <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
                {t.back}
              </button>
              <h2 style={{ fontSize: 16, fontWeight: 700, flex: 1, textAlign: "center", marginRight: 60 }}>
                📋 {t.myActivity}
              </h2>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: "auto", padding: "16px 14px" }}>
              {myEntries.length === 0 ? (
                <p style={{ textAlign: "center", color: th.textMuted, fontSize: 13, padding: "40px 20px" }}>
                  {t.noActivity}
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 600, margin: "0 auto" }}>
                  {myEntries.map((e, i) => (
                    <div key={i} style={{
                      padding: "8px 12px",
                      borderLeft: `3px solid ${logColors[e.type] || th.textMuted}`,
                      background: th.bgCard, borderRadius: "0 8px 8px 0",
                      fontSize: 12, color: th.textSecondary,
                      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                    }}>
                      <span style={{ flex: 1, color: th.text }}>{e.message}</span>
                      <span style={{ fontSize: 10, color: th.textMuted, flexShrink: 0 }}>{fmtTime(e.time)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* FULLSCREEN FEED MODAL (Mis artículos / Recibidos / Me gusta) */}
      {feedView && (() => {
        // Derivar los items en vivo desde el estado actual, NO desde un snapshot.
        // Así cuando retiro, elimino o vendo, la lista se refleja al instante.
        const myMarketItemsLive = marketItems.filter(mi => mi.ownerId === pid);
        const myWithdrawnLive = me.withdrawn || [];
        const myHistoryLive = me.obtained || [];
        const myDeliveredLive = me.delivered || [];
        const myPendingLive = myPending.slice().sort((a, b) => (a.expiresAt || 0) - (b.expiresAt || 0));
        const myLikedItemLive = me.likedObjectId
          ? (marketItems.find(mi => mi.uid === me.likedObjectId) ||
             (myBuyerPending?.itemUid === me.likedObjectId
               ? { ...myBuyerPending.itemSnapshot, uid: myBuyerPending.itemUid }
               : null))
          : null;

        let liveItems = [];
        if (feedView.sourceType === "active") {
          liveItems = [
            ...myMarketItemsLive.map(mi => ({ ...mi, _sourceTag: "exhibited", _feedKey: `m:${mi.uid}` })),
            ...myWithdrawnLive.map((w, wi) => ({ ...w, _sourceTag: "withdrawn", _withdrawnIdx: wi, _feedKey: `w:${wi}` })),
          ];
        } else if (feedView.sourceType === "history") {
          liveItems = myHistoryLive.map((h, hi) => ({ ...h, _feedKey: `h:${hi}` }));
        } else if (feedView.sourceType === "delivered") {
          liveItems = myDeliveredLive.map((d, di) => ({ ...d, _feedKey: `d:${di}` }));
        } else if (feedView.sourceType === "pending") {
          // v20.2: mostrar solo el pending elegido (no el mosaico completo).
          // startKey viene como "p:{txId}"; si por algún motivo no viene,
          // caemos al primer pending disponible.
          const targetTxId = feedView.startKey && feedView.startKey.startsWith("p:")
            ? feedView.startKey.slice(2)
            : null;
          const chosen = targetTxId
            ? myPendingLive.find(ptx => ptx.id === targetTxId)
            : myPendingLive[0];
          liveItems = chosen ? [{ ...chosen, _feedKey: `p:${chosen.id}` }] : [];
        } else if (feedView.sourceType === "liked") {
          liveItems = myLikedItemLive ? [{ ...myLikedItemLive, _feedKey: `m:${myLikedItemLive.uid}` }] : [];
        }

        // Si quedó vacío (todos los items fueron retirados/eliminados/etc), cerrar el feed.
        if (liveItems.length === 0) {
          // Usamos setTimeout para no llamar setState durante el render.
          setTimeout(() => setFeedView(null), 0);
          return null;
        }

        return (
          <div style={{
            position: "fixed", inset: 0, background: th.bg, zIndex: 300,
            display: "flex", flexDirection: "column",
            fontFamily: "'Segoe UI', system-ui, sans-serif", color: th.text,
          }}>
            {/* Header */}
            <div style={{
              height: 52, flexShrink: 0,
              padding: "0 12px", display: "flex", alignItems: "center", gap: 10,
              borderBottom: `1px solid ${th.borderLight}`, background: th.bgSecondary,
            }}>
              <button
                onClick={() => setFeedView(null)}
                style={{
                  background: th.bgCard, border: `1px solid ${th.borderColor}`,
                  borderRadius: 8, padding: "6px 10px", cursor: "pointer",
                  color: th.text, display: "flex", alignItems: "center", gap: 6,
                  fontSize: 13, fontWeight: 600,
                }}
                aria-label={t.back}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12"></line>
                  <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
                {t.back}
              </button>
              <h2 style={{ fontSize: 16, fontWeight: 700, flex: 1, textAlign: "center", marginRight: 60 }}>
                {feedView.title}
              </h2>
            </div>

            {/* Feed content */}
            <div
              ref={(el) => {
                if (el && feedView.startKey) {
                  // Scroll al item inicial (solo la primera vez que el ref se monta).
                  // Si el item ya no existe, se queda en el tope, que es el comportamiento correcto.
                  requestAnimationFrame(() => {
                    const target = el.querySelector(`[data-feed-key="${CSS.escape(feedView.startKey)}"]`);
                    if (target) target.scrollIntoView({ block: "start", behavior: "auto" });
                  });
                }
              }}
              style={{ flex: 1, overflow: "auto" }}
            >
              <div style={{ maxWidth: 600, margin: "0 auto" }}>
                {liveItems.map((item) => {
                  // v20: Render especial para transacciones pendientes (imagen grande +
                  // tiempo restante + botones de voto). Chat va en etapa 4, rating en 5.
                  if (feedView.sourceType === "pending") {
                    const ptx = item; // es una pending transaction, no un market item
                    const iAmBuyer = ptx.buyerId === pid;
                    const otherId = iAmBuyer ? ptx.ownerId : ptx.buyerId;
                    const other = players[otherId] || {};
                    const remaining = (ptx.expiresAt || 0) - Date.now();
                    const timeLeftStr = remaining > 0 ? formatTimeLeft(remaining) : t.pendingExpired;
                    const urgent = remaining < 24 * 60 * 60 * 1000;
                    const itemImages = getItemImages(ptx.itemSnapshot || {});
                    const myVote = ptx.closeVotes?.[pid] || null;
                    const otherVote = ptx.closeVotes?.[otherId] || null;
                    const hadConflict = !!ptx._conflict;
                    return (
                      <div key={item._feedKey} data-feed-key={item._feedKey} style={{ marginBottom: "24px", borderBottom: `1px solid ${th.borderLight}`, paddingBottom: "16px" }}>
                        {/* Counterparty bar */}
                        <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: "8px" }}>
                          {other.photo ? (
                            <img src={other.photo} style={{ width: 32, height: 32, borderRadius: "50%" }} />
                          ) : (
                            <div style={{ width: 32, height: 32, borderRadius: "50%", background: th.bgCard, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", color: th.textSecondary }}>
                              {(other.name || "?")[0]}
                            </div>
                          )}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {(iAmBuyer ? t.pendingReceiveFrom : t.pendingDeliverTo).replace("{user}", other.name || "?")}
                              {" "}<span style={{ fontSize: 10, color: th.textMuted, fontWeight: 500 }}>{getRatingStr(other)}</span>
                            </div>
                            <div style={{ fontSize: "12px", color: urgent ? "#ef4444" : "#f59e0b", fontWeight: 700 }}>
                              ⏱ {t.pendingTimeLeft.replace("{time}", timeLeftStr)}
                            </div>
                          </div>
                        </div>
                        {/* Image carousel */}
                        <div style={{ width: "100%", aspectRatio: "1/1", overflow: "hidden", background: th.imageBg }}>
                          <ImageCarousel images={itemImages} theme={theme} t={t} />
                        </div>
                        {/* Item name + description */}
                        <div style={{ padding: "10px 14px 0" }}>
                          <div style={{ fontSize: "14px", fontWeight: 700 }}>{ptx.itemSnapshot?.name || ""}</div>
                          {ptx.itemSnapshot?.description && (
                            <div style={{ fontSize: "12px", color: th.textSecondary, marginTop: 2 }}>{ptx.itemSnapshot.description}</div>
                          )}
                        </div>
                        {/* Chat acoplado */}
                        {(() => {
                          const msgsArr = ptx.messages ? Object.entries(ptx.messages)
                            .map(([mid, m]) => ({ ...m, id: mid }))
                            .sort((a, b) => (a.time || 0) - (b.time || 0)) : [];
                          return (
                            <PendingChatBox
                              txId={ptx.id}
                              messages={msgsArr}
                              pid={pid}
                              otherName={other.name || "?"}
                              theme={theme}
                              t={t}
                              lang={lang}
                              onSend={(txt) => sendChatMessage(ptx.id, txt)}
                              onMarkRead={() => markChatRead(ptx.id)}
                              readOnly={false}
                            />
                          );
                        })()}
                        {/* Close transaction section */}
                        <div style={{
                          margin: "14px 14px 0", padding: "12px",
                          background: th.bgCard, borderRadius: 10,
                          border: `1px solid ${th.borderLight}`,
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: th.textSecondary, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.3 }}>
                            {t.closeTitle}
                          </div>
                          <div style={{ fontSize: 11, color: th.textMuted, marginBottom: 10, lineHeight: 1.4 }}>
                            {t.closeExplain}
                          </div>
                          {hadConflict && (
                            <div style={{
                              fontSize: 11, color: "#f59e0b", marginBottom: 10,
                              padding: "6px 8px", background: "rgba(245,158,11,0.1)",
                              borderRadius: 6, border: "1px solid rgba(245,158,11,0.3)",
                            }}>
                              ⚠️ {t.closeConflict}
                            </div>
                          )}
                          {/* Estado actual de los votos */}
                          {myVote && (
                            <div style={{ fontSize: 12, color: th.text, marginBottom: 8 }}>
                              {t.closeYouVoted.replace("{choice}", myVote === "complete" ? t.closeChoiceComplete : t.closeChoiceCancel)}
                              {otherVote === myVote ? null : (
                                <span style={{ color: th.textMuted, marginLeft: 6 }}>
                                  · {t.closeWaitingOther.replace("{user}", other.name || "?")}
                                </span>
                              )}
                            </div>
                          )}
                          {/* Botones */}
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              onClick={() => castCloseVote(ptx.id, myVote === "complete" ? null : "complete")}
                              style={{
                                flex: 1, minWidth: 120,
                                background: myVote === "complete" ? "#10b981" : "rgba(16,185,129,0.15)",
                                color: myVote === "complete" ? "#fff" : "#10b981",
                                border: `1px solid ${myVote === "complete" ? "#10b981" : "rgba(16,185,129,0.3)"}`,
                                borderRadius: 8, padding: "10px 12px",
                                fontSize: 12, fontWeight: 700, cursor: "pointer",
                              }}
                            >
                              ✅ {myVote === "complete" ? t.closeRemoveVote : t.closeComplete}
                            </button>
                            <button
                              onClick={() => castCloseVote(ptx.id, myVote === "cancel" ? null : "cancel")}
                              style={{
                                flex: 1, minWidth: 120,
                                background: myVote === "cancel" ? "#ef4444" : "rgba(239,68,68,0.12)",
                                color: myVote === "cancel" ? "#fff" : "#ef4444",
                                border: `1px solid ${myVote === "cancel" ? "#ef4444" : "rgba(239,68,68,0.3)"}`,
                                borderRadius: 8, padding: "10px 12px",
                                fontSize: 12, fontWeight: 700, cursor: "pointer",
                              }}
                            >
                              ❌ {myVote === "cancel" ? t.closeRemoveVote : t.closeCancel}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  // Para "Artículos recibidos" y "Artículos entregados" usamos una
                  // tarjeta simplificada: imagen + fecha + contraparte (sin like
                  // ni acciones del market).
                  const isHistoryKind = feedView.sourceType === "history" || feedView.sourceType === "delivered";
                  if (isHistoryKind) {
                    const isDelivered = feedView.sourceType === "delivered";
                    const counterpartId = isDelivered ? item.toId : item.fromId;
                    const counterpart = counterpartId ? players[counterpartId] : null;
                    const counterpartName = counterpart ? counterpart.name : null;
                    const counterpartPhoto = counterpart ? counterpart.photo : null;
                    const dateStr = item.date ? new Date(item.date).toLocaleDateString(lang) : null;
                    const itemImages = getItemImages(item);
                    const catLabel = localizedCategory(item, lang);
                    return (
                      <div key={item._feedKey} data-feed-key={item._feedKey} style={{ marginBottom: "24px", borderBottom: `1px solid ${th.borderLight}`, paddingBottom: "16px" }}>
                        {/* Counterparty bar */}
                        <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: "8px" }}>
                          {counterpartPhoto ? (
                            <img src={counterpartPhoto} style={{ width: 32, height: 32, borderRadius: "50%" }} />
                          ) : (
                            <div style={{ width: 32, height: 32, borderRadius: "50%", background: th.bgCard, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", color: th.textSecondary }}>
                              {(counterpartName || "?")[0]}
                            </div>
                          )}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {counterpartName ? `${isDelivered ? t.deliveredTo : t.receivedFrom} ${counterpartName}` : (catLabel || "")}
                              {counterpart && <> <span style={{ fontSize: 10, color: th.textMuted, fontWeight: 500 }}>{getRatingStr(counterpart)}</span></>}
                            </div>
                            {dateStr && (
                              <div style={{ fontSize: "11px", color: th.textMuted }}>{dateStr}</div>
                            )}
                          </div>
                        </div>
                        {/* Image carousel */}
                        <div style={{ width: "100%", aspectRatio: "1/1", overflow: "hidden", background: th.imageBg }}>
                          <ImageCarousel images={itemImages} theme={theme} t={t} />
                        </div>
                        {/* v20: chat archivado (solo lectura) si el item vino de un pending con mensajes */}
                        {Array.isArray(item.chatArchive) && item.chatArchive.length > 0 && (
                          <PendingChatBox
                            txId={item.txId || item._feedKey}
                            messages={item.chatArchive}
                            pid={pid}
                            otherName={counterpartName || "?"}
                            theme={theme}
                            t={t}
                            lang={lang}
                            onSend={() => {}}
                            onMarkRead={() => {}}
                            readOnly={true}
                          />
                        )}
                      </div>
                    );
                  }
                  return (
                    <div key={item._feedKey} data-feed-key={item._feedKey}>
                      {renderMarketCard(item)}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* UNLIKE CONFIRMATION MODAL */}
      {unlikeConfirmModal && (() => {
        const item = unlikeConfirmModal.item;
        const itemImgs = getItemImages(item);
        return (
          <div style={{ position: "fixed", inset: 0, background: th.overlayBg, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: "16px" }}>
            <div style={{ background: th.modalBg, borderRadius: "16px", padding: "20px", maxWidth: "360px", width: "100%", border: `1px solid ${th.borderColor}` }}>
              <h3 style={{ fontSize: "16px", color: "#f59e0b", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
                💔 {t.unlikeConfirmTitle}
              </h3>
              <div style={{ display: "flex", gap: "12px", marginBottom: "14px", alignItems: "center" }}>
                <div style={{ width: 56, height: 56, borderRadius: 10, overflow: "hidden", flexShrink: 0, background: th.bgCard }}>
                  <ItemImage src={itemImgs[0]} theme={theme} t={t} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: th.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                  {item.description && (
                    <div style={{ fontSize: 11, color: th.textSecondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.description}</div>
                  )}
                </div>
              </div>
              <p style={{ fontSize: "12px", color: th.textSecondary, marginBottom: "16px", lineHeight: 1.5 }}>
                {t.unlikeConfirmText}
              </p>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => setUnlikeConfirmModal(null)}
                  style={{ flex: 1, background: "transparent", color: th.textSecondary, border: `1px solid ${th.borderLight}`, borderRadius: "10px", padding: "12px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
                >
                  {t.cancel}
                </button>
                <button
                  onClick={async () => {
                    await doUnlike(item);
                    setUnlikeConfirmModal(null);
                    // Si estábamos en el feed fullscreen de "Me gusta", lo cerramos automáticamente
                    // (el item ya no está en la lista)
                    if (feedView && feedView.sourceType === "liked") {
                      setFeedView(null);
                    }
                  }}
                  style={{ flex: 1, background: "#f59e0b", color: "#fff", border: "none", borderRadius: "10px", padding: "12px", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}
                >
                  💔 {t.unlikeConfirm}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* v20: RATING MODAL BLOQUEANTE. Se muestra mientras haya entradas en mi cola. */}
      {Array.isArray(me.pendingRatings) && me.pendingRatings.length > 0 && (() => {
        const entry = me.pendingRatings[0];
        return (
          <RatingModal
            key={`${entry.txId}-${entry.ratedId}`}
            entry={entry}
            theme={theme}
            t={t}
            onSubmit={(stars) => submitRating(entry, stars)}
          />
        );
      })()}

      {/* v20.2: ONBOARDING MODAL BLOQUEANTE. Se muestra en el primer registro,
          hasta que el jugador confirme nombre + foto. Tiene menor prioridad que
          el rating modal: si ambos aplican, el rating se resuelve primero. */}
      {me.onboarded !== true && !(Array.isArray(me.pendingRatings) && me.pendingRatings.length > 0) && (
        <ProfileEditModal
          mode="onboarding"
          currentName={me.name || ""}
          currentPhoto={me.photo || null}
          googlePhoto={me.googlePhoto || null}
          theme={theme}
          t={t}
          onSave={updateProfile}
          onCancel={() => {}}
        />
      )}

      {/* v20.2: EDIT PROFILE MODAL. Abierto desde el header del perfil. */}
      {profileEditOpen && me.onboarded === true && (
        <ProfileEditModal
          mode="edit"
          currentName={me.name || ""}
          currentPhoto={me.photo || null}
          googlePhoto={me.googlePhoto || null}
          theme={theme}
          t={t}
          onSave={async (params) => {
            const res = await updateProfile(params);
            if (res.ok) setProfileEditOpen(false);
            return res;
          }}
          onCancel={() => setProfileEditOpen(false)}
        />
      )}
    </div>
  );
}
