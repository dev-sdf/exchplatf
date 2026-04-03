import { useState, useEffect, useRef, useCallback } from "react";
import { db, ref, set, get, onValue, update, push } from "./firebase.js";
import { OBJECTS } from "./objects.js";

function addLogEntry(roomCode, type, message) {
  const logRef = ref(db, `rooms/${roomCode}/log`);
  push(logRef, { type, message, time: Date.now() });
}

export default function Game({ roomCode, playerId }) {
  const [room, setRoom] = useState(null);
  const [selectedExhibit, setSelectedExhibit] = useState(null);
  const [saleModal, setSaleModal] = useState(null);
  const [saleTimer, setSaleTimer] = useState(null);
  const [offerTimer, setOfferTimer] = useState(null);
  const saleTimerRef = useRef(null);
  const offerTimerRef = useRef(null);
  const logRef = useRef(null);

  // Listen to room changes
  useEffect(() => {
    const roomRef = ref(db, `rooms/${roomCode}`);
    const unsub = onValue(roomRef, (snapshot) => {
      if (snapshot.exists()) setRoom(snapshot.val());
    });
    return () => unsub();
  }, [roomCode]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [room?.log]);

  // Offer timer
  useEffect(() => {
    if (room?.buyOffer) {
      setOfferTimer(10);
      offerTimerRef.current = setInterval(() => {
        setOfferTimer(prev => {
          if (prev <= 1) { clearInterval(offerTimerRef.current); return 0; }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(offerTimerRef.current);
    } else {
      setOfferTimer(null);
      if (offerTimerRef.current) clearInterval(offerTimerRef.current);
    }
  }, [room?.buyOffer?.time]);

  // Auto-reject offer on timeout
  useEffect(() => {
    if (offerTimer === 0 && room?.buyOffer) {
      rejectOffer();
    }
  }, [offerTimer]);

  // Sale timer
  useEffect(() => {
    if (saleModal) {
      setSaleTimer(10);
      saleTimerRef.current = setInterval(() => {
        setSaleTimer(prev => {
          if (prev <= 1) { clearInterval(saleTimerRef.current); return 0; }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(saleTimerRef.current);
    } else {
      setSaleTimer(null);
      if (saleTimerRef.current) clearInterval(saleTimerRef.current);
    }
  }, [saleModal]);

  useEffect(() => {
    if (saleTimer === 0 && saleModal) {
      addLogEntry(roomCode, "system", `\u23f0 Se agot\u00f3 el tiempo para vender "${saleModal.name}". Venta cancelada.`);
      setSaleModal(null);
    }
  }, [saleTimer]);

  if (!room || !room.players || !room.players[playerId]) {
    return <div style={{ minHeight: "100vh", background: "#0a0e1a", color: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>Cargando...</div>;
  }

  const me = room.players[playerId];
  const players = room.players;
  const market = room.market || {};
  const marketItems = Object.entries(market).map(([uid, obj]) => ({ ...obj, uid }));
  const buyOffer = room.buyOffer || null;
  const logEntries = room.log ? Object.values(room.log).sort((a, b) => a.time - b.time).slice(-30) : [];

  const getLikesForObject = (uid) => {
    return Object.values(players).filter(p => p.likedObjectId === uid).length;
  };

  // === ACTIONS ===
  const exhibitObject = async (objIndex) => {
    const obj = me.hand[objIndex];
    const uid = `${playerId}-${obj.id}-${Date.now()}`;
    const newHand = me.hand.filter((_, i) => i !== objIndex);
    await update(ref(db, `rooms/${roomCode}/players/${playerId}`), { hand: newHand });
    await update(ref(db, `rooms/${roomCode}/market/${uid}`), {
      id: obj.id, name: obj.name, emoji: obj.emoji, category: obj.category, ownerId: playerId,
    });
    addLogEntry(roomCode, "exhibit", `\ud83d\udce6 ${me.name} exhibi\u00f3 "${obj.name}" en el mercado.`);
    setSelectedExhibit(null);
  };

  const exhibitObtained = async (obtIndex) => {
    const objId = me.obtained[obtIndex];
    const obj = OBJECTS.find(o => o.id === objId);
    if (!obj) return;
    const uid = `${playerId}-${obj.id}-${Date.now()}`;
    const newObtained = me.obtained.filter((_, i) => i !== obtIndex);
    await update(ref(db, `rooms/${roomCode}/players/${playerId}`), { obtained: newObtained });
    await update(ref(db, `rooms/${roomCode}/market/${uid}`), {
      id: obj.id, name: obj.name, emoji: obj.emoji, category: obj.category, ownerId: playerId,
    });
    addLogEntry(roomCode, "exhibit", `\ud83d\udce6 ${me.name} re-exhibi\u00f3 "${obj.name}" en el mercado.`);
  };

  const withdrawObject = async (mObj) => {
    if (buyOffer && buyOffer.uid === mObj.uid) return;
    // Free likes
    const updates = {};
    Object.entries(players).forEach(([pid, p]) => {
      if (p.likedObjectId === mObj.uid) updates[`players/${pid}/likedObjectId`] = null;
    });
    updates[`market/${mObj.uid}`] = null;
    const newHand = [...(me.hand || []), { id: mObj.id, name: mObj.name, emoji: mObj.emoji, category: mObj.category }];
    updates[`players/${playerId}/hand`] = newHand;
    await update(ref(db, `rooms/${roomCode}`), updates);
    addLogEntry(roomCode, "system", `\u21a9\ufe0f ${me.name} retir\u00f3 "${mObj.name}" del mercado.`);
  };

  const toggleLike = async (mObj) => {
    if (mObj.ownerId === playerId) return;
    if (buyOffer && buyOffer.uid === mObj.uid) return;
    if (saleModal && saleModal.uid === mObj.uid) return;

    if (me.likedObjectId === mObj.uid) {
      await update(ref(db, `rooms/${roomCode}/players/${playerId}`), { likedObjectId: null });
      addLogEntry(roomCode, "unlike", `\ud83d\udc4e ${me.name} retir\u00f3 su like de "${mObj.name}".`);
    } else {
      if (me.likedObjectId) {
        const prevObj = marketItems.find(m => m.uid === me.likedObjectId);
        if (prevObj) addLogEntry(roomCode, "unlike", `\ud83d\udc4e ${me.name} movi\u00f3 su like de "${prevObj.name}".`);
      }
      await update(ref(db, `rooms/${roomCode}/players/${playerId}`), { likedObjectId: mObj.uid });
      addLogEntry(roomCode, "like", `\ud83d\udc4d ${me.name} le dio like a "${mObj.name}".`);
    }
  };

  const openSellModal = (mObj) => {
    if (buyOffer && buyOffer.uid === mObj.uid) return;
    const likers = Object.entries(players).filter(([pid, p]) => p.likedObjectId === mObj.uid && pid !== mObj.ownerId);
    if (likers.length === 0) {
      addLogEntry(roomCode, "system", `\u274c "${mObj.name}" no tiene likes. No se puede vender.`);
      return;
    }
    const likeCount = getLikesForObject(mObj.uid);
    setSaleModal({ ...mObj, likers, basePrice: likeCount });
  };

  const executeSale = async (mObj, buyerPid, sellerReceives, debtCancelled) => {
    const buyer = players[buyerPid];
    const seller = players[mObj.ownerId];
    const likeCount = getLikesForObject(mObj.uid);
    const actualSellerReceives = sellerReceives !== undefined ? sellerReceives : likeCount;
    const actualDebtCancelled = debtCancelled !== undefined ? debtCancelled : 0;

    let buyerNewLikes;
    if (buyer.likes < 0) {
      buyerNewLikes = -actualSellerReceives;
    } else {
      buyerNewLikes = buyer.likes - likeCount;
    }

    const updates = {};
    updates[`players/${buyerPid}/likes`] = buyerNewLikes;
    updates[`players/${buyerPid}/obtained`] = [...(buyer.obtained || []), mObj.id];
    if (buyer.likedObjectId === mObj.uid) updates[`players/${buyerPid}/likedObjectId`] = null;
    updates[`players/${mObj.ownerId}/likes`] = (seller.likes || 0) + actualSellerReceives;
    // Free all likes on this object
    Object.entries(players).forEach(([pid, p]) => {
      if (p.likedObjectId === mObj.uid) updates[`players/${pid}/likedObjectId`] = null;
    });
    updates[`market/${mObj.uid}`] = null;
    updates[`buyOffer`] = null;

    await update(ref(db, `rooms/${roomCode}`), updates);

    if (actualDebtCancelled > 0) {
      addLogEntry(roomCode, "sell", `\ud83d\udcb0 ${seller.name} vendi\u00f3 "${mObj.name}" a ${buyer.name}. ${actualDebtCancelled} cancelaron deuda, recibe ${actualSellerReceives} likes.`);
    } else {
      addLogEntry(roomCode, "sell", `\ud83d\udcb0 ${seller.name} vendi\u00f3 "${mObj.name}" a ${buyer.name} por ${likeCount} likes.`);
    }
    if (buyerNewLikes < 0 && actualDebtCancelled === 0) {
      addLogEntry(roomCode, "credit", `\ud83d\udd34 ${buyer.name} compr\u00f3 a cr\u00e9dito y queda con saldo de ${buyerNewLikes} likes.`);
    }
    setSaleModal(null);
  };

  const makeBuyOffer = async (mObj) => {
    const likeCount = getLikesForObject(mObj.uid);
    if (likeCount === 0) return;
    const debt = Math.abs(Math.min(0, me.likes));

    let sellerReceives, debtCancelled;
    if (me.likes >= 0) {
      if (me.likes < likeCount) return;
      sellerReceives = likeCount;
      debtCancelled = 0;
    } else {
      if (likeCount < debt) return;
      sellerReceives = likeCount - debt;
      debtCancelled = debt;
    }

    await update(ref(db, `rooms/${roomCode}/buyOffer`), {
      uid: mObj.uid, name: mObj.name, emoji: mObj.emoji, id: mObj.id,
      ownerId: mObj.ownerId, buyerId: playerId,
      price: likeCount, sellerReceives, debtCancelled, time: Date.now(),
    });

    if (debtCancelled > 0) {
      addLogEntry(roomCode, "system", `\ud83d\uded2 ${me.name} ofrece comprar "${mObj.name}": ${debtCancelled} cancelan deuda + ${sellerReceives} para vendedor.`);
    } else {
      addLogEntry(roomCode, "system", `\ud83d\uded2 ${me.name} ofrece comprar "${mObj.name}" por ${likeCount} likes.`);
    }
  };

  const acceptOffer = async () => {
    if (!buyOffer) return;
    const mObj = { uid: buyOffer.uid, id: buyOffer.id, name: buyOffer.name, ownerId: buyOffer.ownerId };
    await executeSale(mObj, buyOffer.buyerId, buyOffer.sellerReceives, buyOffer.debtCancelled);
    addLogEntry(roomCode, "sell", `\u2705 Oferta aceptada por "${buyOffer.name}".`);
  };

  const rejectOffer = async () => {
    if (!buyOffer) return;
    await update(ref(db, `rooms/${roomCode}`), { buyOffer: null });
    addLogEntry(roomCode, "system", `\u274c Oferta por "${buyOffer.name}" rechazada.`);
  };

  // === RENDER ===
  const isMyOffer = buyOffer && buyOffer.ownerId === playerId;
  const iMadeOffer = buyOffer && buyOffer.buyerId === playerId;

  const logColors = { sell: "#10b981", like: "#f59e0b", unlike: "#94a3b8", exhibit: "#8b5cf6", credit: "#ef4444", system: "#64748b" };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #0a0e1a 0%, #111827 40%, #1a1a2e 100%)",
      fontFamily: "'Segoe UI', system-ui, sans-serif", color: "#e2e8f0", display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)",
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "20px" }}>🏠</span>
          <span style={{ fontWeight: 800, fontSize: "16px", background: "linear-gradient(135deg, #38bdf8, #818cf8)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>El Trueque</span>
          <span style={{ fontSize: "11px", color: "#64748b", background: "rgba(255,255,255,0.05)", padding: "2px 8px", borderRadius: "4px" }}>
            Sala: {roomCode}
          </span>
        </div>
        <div style={{ display: "flex", gap: "16px", fontSize: "12px" }}>
          <span style={{ color: "#94a3b8" }}>Billetera: <strong style={{ color: me.likes >= 0 ? "#10b981" : "#ef4444" }}>{me.likes} ❤️</strong></span>
          <span style={{ color: "#94a3b8" }}>Like: <strong style={{ color: "#f59e0b" }}>{me.likedObjectId ? "✓" : "libre"}</strong></span>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ padding: "6px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.2)",
        display: "flex", gap: "16px", fontSize: "11px", color: "#64748b", flexWrap: "wrap" }}>
        <span>Likes total: <strong style={{ color: "#f59e0b" }}>{Object.values(players).reduce((s, p) => s + (p.likes || 0), 0)}</strong></span>
        <span>Mercado: <strong style={{ color: "#8b5cf6" }}>{marketItems.length}</strong></span>
        <span>Jugadores: <strong style={{ color: "#38bdf8" }}>{Object.keys(players).length}</strong></span>
        <span>Endeudados: <strong style={{ color: "#ef4444" }}>{Object.values(players).filter(p => (p.likes || 0) < 0).length}</strong></span>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden", flexDirection: window.innerWidth < 640 ? "column" : "row" }}>
        {/* Main panel */}
        <div style={{ flex: 1, overflow: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>

          {/* Obtained */}
          <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: "12px", padding: "12px", border: "1px solid rgba(255,255,255,0.05)" }}>
            <h3 style={{ fontSize: "11px", color: "#22c55e", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>
              🏠 Obtenidos por intercambio
            </h3>
            {(!me.obtained || me.obtained.length === 0) ? (
              <p style={{ color: "#64748b", fontSize: "12px" }}>Nada todavía.</p>
            ) : (
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {me.obtained.map((objId, i) => {
                  const obj = OBJECTS.find(o => o.id === objId);
                  return obj ? (
                    <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
                      <div style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "11px",
                        background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.25)", color: "#22c55e",
                        display: "flex", alignItems: "center", gap: "4px" }}>
                        {obj.emoji} {obj.name}
                      </div>
                      <button onClick={() => exhibitObtained(i)} style={{
                        background: "transparent", border: "1px solid rgba(139,92,246,0.25)", borderRadius: "4px",
                        padding: "1px 6px", fontSize: "9px", color: "#8b5cf6", cursor: "pointer" }}>
                        Re-exhibir
                      </button>
                    </div>
                  ) : null;
                })}
              </div>
            )}
          </div>

          {/* Hand */}
          <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: "12px", padding: "12px", border: "1px solid rgba(255,255,255,0.05)" }}>
            <h3 style={{ fontSize: "11px", color: "#38bdf8", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>
              🃏 Tu mano
            </h3>
            {(!me.hand || me.hand.length === 0) ? (
              <p style={{ color: "#64748b", fontSize: "12px" }}>No tenés objetos en mano.</p>
            ) : (
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {me.hand.map((obj, i) => (
                  <div key={i} onClick={() => setSelectedExhibit(selectedExhibit === i ? null : i)} style={{
                    background: selectedExhibit === i ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.05)",
                    border: selectedExhibit === i ? "1px solid rgba(56,189,248,0.4)" : "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px", padding: "8px", cursor: "pointer", textAlign: "center", minWidth: "70px" }}>
                    <div style={{ fontSize: "24px" }}>{obj.emoji}</div>
                    <div style={{ fontSize: "10px", color: "#e2e8f0", marginTop: "2px" }}>{obj.name}</div>
                  </div>
                ))}
              </div>
            )}
            {selectedExhibit !== null && me.hand[selectedExhibit] && (
              <button onClick={() => exhibitObject(selectedExhibit)} style={{
                marginTop: "8px", background: "linear-gradient(135deg, #8b5cf6, #6d28d9)", color: "#fff",
                border: "none", borderRadius: "8px", padding: "8px 16px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>
                📦 Exhibir "{me.hand[selectedExhibit].name}"
              </button>
            )}
          </div>

          {/* Market */}
          <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: "12px", padding: "12px", border: "1px solid rgba(255,255,255,0.05)", flex: 1 }}>
            <h3 style={{ fontSize: "11px", color: "#f59e0b", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>
              🏪 Mercado
            </h3>
            {marketItems.length === 0 ? (
              <p style={{ color: "#64748b", fontSize: "12px" }}>El mercado está vacío.</p>
            ) : (
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {marketItems.map(mObj => {
                  const likeCount = getLikesForObject(mObj.uid);
                  const isLiked = me.likedObjectId === mObj.uid;
                  const isOwn = mObj.ownerId === playerId;
                  const hasPendingOffer = buyOffer && buyOffer.uid === mObj.uid;
                  const isLocked = hasPendingOffer;
                  const debt = me.likes < 0 ? Math.abs(me.likes) : 0;
                  const canBuySolvent = isLiked && !isOwn && me.likes >= 0 && me.likes >= likeCount && likeCount > 0 && !isLocked;
                  const canBuyIndebted = isLiked && !isOwn && me.likes < 0 && likeCount >= debt && likeCount > 0 && !isLocked;
                  const canBuy = canBuySolvent || canBuyIndebted;
                  const offerAmount = canBuyIndebted ? likeCount - debt : likeCount;
                  const ownerName = players[mObj.ownerId]?.name || "?";

                  return (
                    <div key={mObj.uid} style={{ display: "flex", flexDirection: "column", gap: "3px", alignItems: "center", position: "relative" }}>
                      {isLocked && (
                        <div style={{ position: "absolute", top: "-7px", left: "50%", transform: "translateX(-50%)",
                          background: "#f59e0b", color: "#000", fontSize: "8px", fontWeight: 800, padding: "1px 6px", borderRadius: "3px", zIndex: 2, whiteSpace: "nowrap" }}>
                          OFERTA
                        </div>
                      )}
                      <div onClick={() => { if (isLocked) return; isOwn ? openSellModal(mObj) : toggleLike(mObj); }}
                        style={{
                          background: isLiked ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.05)",
                          border: isLiked ? "1px solid rgba(56,189,248,0.4)" : "1px solid rgba(255,255,255,0.1)",
                          borderRadius: "8px", padding: "8px", cursor: isLocked ? "default" : "pointer",
                          textAlign: "center", minWidth: "70px", opacity: isLocked && !isOwn ? 0.5 : 1, position: "relative" }}>
                        <div style={{ fontSize: "24px" }}>{mObj.emoji}</div>
                        <div style={{ fontSize: "10px", color: "#e2e8f0", marginTop: "2px" }}>{mObj.name}</div>
                        {likeCount > 0 && (
                          <div style={{ position: "absolute", top: "-5px", right: "-5px",
                            background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#000",
                            borderRadius: "50%", width: "18px", height: "18px", display: "flex",
                            alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 800 }}>
                            {likeCount}
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: "9px", color: "#64748b" }}>
                        {isLocked ? "🔒" : isOwn ? (
                          <span>
                            <span style={{ cursor: "pointer", color: "#10b981" }} onClick={() => openSellModal(mObj)}>Vender</span>
                            {" | "}
                            <span style={{ cursor: "pointer", color: "#94a3b8" }} onClick={() => withdrawObject(mObj)}>Retirar</span>
                          </span>
                        ) : (isLiked ? "👍 Tu like" : "Click = like")}
                      </div>
                      {canBuy && (
                        <button onClick={() => makeBuyOffer(mObj)} style={{
                          background: canBuyIndebted ? "linear-gradient(135deg, #f59e0b, #d97706)" : "linear-gradient(135deg, #10b981, #059669)",
                          color: "#fff", border: "none", borderRadius: "5px", padding: "3px 8px", fontSize: "9px", fontWeight: 700, cursor: "pointer" }}>
                          {canBuyIndebted
                            ? (offerAmount === 0 ? `Pedir donacion` : `Ofertar ${offerAmount}`)
                            : `Comprar (${likeCount})`}
                        </button>
                      )}
                      <div style={{ fontSize: "8px", color: "#475569" }}>de {ownerName}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Side panel */}
        <div style={{ width: window.innerWidth < 640 ? "100%" : "240px",
          borderLeft: window.innerWidth < 640 ? "none" : "1px solid rgba(255,255,255,0.06)",
          borderTop: window.innerWidth < 640 ? "1px solid rgba(255,255,255,0.06)" : "none",
          display: "flex", flexDirection: "column", background: "rgba(0,0,0,0.15)",
          maxHeight: window.innerWidth < 640 ? "300px" : "none" }}>

          {/* Players */}
          <div style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <h3 style={{ fontSize: "11px", color: "#818cf8", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>Jugadores</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {Object.entries(players).map(([pid, p]) => (
                <div key={pid} style={{
                  padding: "6px 8px", borderRadius: "6px", fontSize: "12px",
                  background: pid === playerId ? "rgba(56,189,248,0.1)" : "rgba(255,255,255,0.03)",
                  border: pid === playerId ? "1px solid rgba(56,189,248,0.25)" : "1px solid transparent",
                  display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{p.name} {pid === playerId && "(vos)"}</span>
                  <span style={{ color: (p.likes || 0) >= 0 ? "#10b981" : "#ef4444", fontWeight: 700, fontSize: "11px" }}>
                    {p.likes || 0} ❤️
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Log */}
          <div style={{ flex: 1, padding: "12px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <h3 style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>Registro</h3>
            <div ref={logRef} style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
              {logEntries.map((entry, i) => (
                <div key={i} style={{
                  padding: "4px 8px", borderLeft: `2px solid ${logColors[entry.type] || "#64748b"}`,
                  background: "rgba(255,255,255,0.02)", borderRadius: "0 4px 4px 0", fontSize: "11px", color: "#c8d6e5", lineHeight: 1.3 }}>
                  {entry.message}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Buy Offer Modal - someone wants to buy YOUR object */}
      {isMyOffer && buyOffer && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "16px" }}>
          <div style={{ background: "linear-gradient(135deg, #1e293b, #0f172a)", borderRadius: "16px", padding: "20px", maxWidth: "380px", width: "100%", border: "1px solid rgba(245,158,11,0.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <h3 style={{ fontSize: "16px", color: "#f59e0b" }}>🛒 Oferta de compra</h3>
              <span style={{ fontSize: "13px", fontWeight: 800, color: offerTimer <= 3 ? "#ef4444" : "#f59e0b",
                background: offerTimer <= 3 ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)", padding: "3px 8px", borderRadius: "6px" }}>
                ⏱ {offerTimer}s
              </span>
            </div>
            <div style={{ height: "3px", background: "rgba(255,255,255,0.1)", borderRadius: "2px", marginBottom: "12px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(offerTimer / 10) * 100}%`, background: offerTimer <= 3 ? "#ef4444" : "#f59e0b", transition: "width 1s linear" }} />
            </div>
            <p style={{ fontSize: "13px", color: "#cbd5e1", marginBottom: "14px", lineHeight: 1.5 }}>
              <strong>{players[buyOffer.buyerId]?.name}</strong> quiere tu <strong>{buyOffer.emoji} {buyOffer.name}</strong>.
              {buyOffer.debtCancelled > 0 ? (
                <><br/>Deuda del comprador: {buyOffer.debtCancelled}. Recibirías <strong style={{ color: "#10b981" }}>{buyOffer.sellerReceives} likes</strong>.</>
              ) : (
                <> Recibirías <strong style={{ color: "#10b981" }}>{buyOffer.sellerReceives} likes</strong>.</>
              )}
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={acceptOffer} style={{ flex: 1, background: "linear-gradient(135deg, #10b981, #059669)", color: "#fff", border: "none", borderRadius: "10px", padding: "12px", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}>
                ✅ Aceptar
              </button>
              <button onClick={rejectOffer} style={{ flex: 1, background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "10px", padding: "12px", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}>
                ❌ Rechazar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Waiting for offer response */}
      {iMadeOffer && buyOffer && (
        <div style={{ position: "fixed", bottom: "16px", left: "50%", transform: "translateX(-50%)",
          background: "linear-gradient(135deg, #1e293b, #0f172a)", border: "1px solid rgba(245,158,11,0.25)",
          borderRadius: "12px", padding: "10px 20px", zIndex: 90, display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ color: "#f59e0b", fontSize: "12px", fontWeight: 600 }}>
            Esperando respuesta por "{buyOffer.name}"... ⏱ {offerTimer}s
          </span>
        </div>
      )}

      {/* Sale Modal */}
      {saleModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "16px" }}>
          <div style={{ background: "linear-gradient(135deg, #1e293b, #0f172a)", borderRadius: "16px", padding: "20px", maxWidth: "380px", width: "100%", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <h3 style={{ fontSize: "16px" }}>💰 Vender "{saleModal.name}"</h3>
              <span style={{ fontSize: "13px", fontWeight: 800, color: saleTimer <= 3 ? "#ef4444" : "#f59e0b",
                background: saleTimer <= 3 ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)", padding: "3px 8px", borderRadius: "6px" }}>
                ⏱ {saleTimer}s
              </span>
            </div>
            <div style={{ height: "3px", background: "rgba(255,255,255,0.1)", borderRadius: "2px", marginBottom: "12px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(saleTimer / 10) * 100}%`, background: saleTimer <= 3 ? "#ef4444" : "#f59e0b", transition: "width 1s linear" }} />
            </div>
            <p style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "12px" }}>
              Valor: <strong style={{ color: "#f59e0b" }}>{saleModal.basePrice} likes</strong>
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
              {saleModal.likers.map(([pid, liker]) => {
                const isIndebted = (liker.likes || 0) < 0;
                const likerDebt = isIndebted ? Math.abs(liker.likes) : 0;
                const canAfford = isIndebted ? saleModal.basePrice >= likerDebt : true;
                const sellerWouldReceive = isIndebted ? saleModal.basePrice - likerDebt : saleModal.basePrice;
                const debtCancelled = isIndebted ? likerDebt : 0;
                const isBlocked = isIndebted && !canAfford;

                return (
                  <button key={pid} onClick={isBlocked ? undefined : () => executeSale(saleModal, pid, sellerWouldReceive, debtCancelled)}
                    disabled={isBlocked}
                    style={{ background: isBlocked ? "rgba(239,68,68,0.08)" : canAfford && isIndebted ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.05)",
                      border: isBlocked ? "1px solid rgba(239,68,68,0.2)" : "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "8px", padding: "10px", color: isBlocked ? "#64748b" : "#e2e8f0",
                      cursor: isBlocked ? "not-allowed" : "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left", opacity: isBlocked ? 0.6 : 1 }}>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 600 }}>{liker.name}</div>
                      <div style={{ fontSize: "10px", color: "#94a3b8" }}>
                        {liker.likes} likes
                        {isIndebted && canAfford && <span style={{ color: "#f59e0b" }}> (recibirías {sellerWouldReceive})</span>}
                        {isBlocked && <span style={{ color: "#ef4444" }}> (deuda excede valor)</span>}
                        {!isIndebted && (liker.likes || 0) < saleModal.basePrice && <span style={{ color: "#f59e0b" }}> (a crédito)</span>}
                      </div>
                    </div>
                    {!isBlocked && <span style={{ color: "#10b981", fontWeight: 700, fontSize: "12px" }}>→</span>}
                  </button>
                );
              })}
            </div>
            <button onClick={() => setSaleModal(null)} style={{
              background: "transparent", color: "#64748b", border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "8px", padding: "8px", fontSize: "12px", cursor: "pointer", width: "100%" }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
