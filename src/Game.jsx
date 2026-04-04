import { useState, useEffect, useRef } from "react";
import {
  db, ref, get, onValue, update, push,
  storage, storageRef, uploadBytes, getDownloadURL,
} from "./firebase.js";
import { CATEGORIES } from "./categories.js";

function addLog(type, message) {
  push(ref(db, "game/log"), { type, message, time: Date.now() });
}

export default function Game({ user, onLogout }) {
  const [game, setGame] = useState(null);
  const [showPublish, setShowPublish] = useState(false);
  const [pubName, setPubName] = useState("");
  const [pubDesc, setPubDesc] = useState("");
  const [pubCategory, setPubCategory] = useState(CATEGORIES[0]);
  const [pubImage, setPubImage] = useState(null);
  const [pubPreview, setPubPreview] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [saleModal, setSaleModal] = useState(null);
  const [saleTimer, setSaleTimer] = useState(null);
  const [offerTimer, setOfferTimer] = useState(null);
  const saleTimerRef = useRef(null);
  const offerTimerRef = useRef(null);
  const logRef = useRef(null);
  const fileInputRef = useRef(null);

  const pid = user.uid;

  useEffect(() => {
    const unsub = onValue(ref(db, "game"), (snap) => {
      if (snap.exists()) setGame(snap.val());
      else setGame({ players: {}, market: {}, log: {}, buyOffer: null });
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [game?.log]);

  // Offer timer
  useEffect(() => {
    if (game?.buyOffer) {
      setOfferTimer(10);
      offerTimerRef.current = setInterval(() => {
        setOfferTimer(prev => { if (prev <= 1) { clearInterval(offerTimerRef.current); return 0; } return prev - 1; });
      }, 1000);
      return () => clearInterval(offerTimerRef.current);
    } else { setOfferTimer(null); if (offerTimerRef.current) clearInterval(offerTimerRef.current); }
  }, [game?.buyOffer?.time]);

  useEffect(() => {
    if (offerTimer === 0 && game?.buyOffer) { rejectOffer(); }
  }, [offerTimer]);

  // Sale timer
  useEffect(() => {
    if (saleModal) {
      setSaleTimer(10);
      saleTimerRef.current = setInterval(() => {
        setSaleTimer(prev => { if (prev <= 1) { clearInterval(saleTimerRef.current); return 0; } return prev - 1; });
      }, 1000);
      return () => clearInterval(saleTimerRef.current);
    } else { setSaleTimer(null); if (saleTimerRef.current) clearInterval(saleTimerRef.current); }
  }, [saleModal]);

  useEffect(() => {
    if (saleTimer === 0 && saleModal) {
      addLog("system", `\u23f0 Tiempo agotado para vender "${saleModal.name}".`);
      setSaleModal(null);
    }
  }, [saleTimer]);

  if (!game || !game.players?.[pid]) {
    return <div style={{ minHeight: "100vh", background: "#0a0e1a", color: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>Cargando...</div>;
  }

  const me = game.players[pid];
  const players = game.players;
  const market = game.market || {};
  const marketItems = Object.entries(market).map(([uid, obj]) => ({ ...obj, uid }));
  const buyOffer = game.buyOffer || null;
  const logEntries = game.log ? Object.values(game.log).sort((a, b) => a.time - b.time).slice(-40) : [];

  const getLikes = (uid) => Object.values(players).filter(p => p.likedObjectId === uid).length;

  // PUBLISH PRODUCT
  const publishProduct = async () => {
    if (!pubName.trim() || !pubImage) return;
    setPublishing(true);
    try {
      const uid = `${pid}-${Date.now()}`;
      const imgRef = storageRef(storage, `products/${uid}`);
      await uploadBytes(imgRef, pubImage);
      const imageURL = await getDownloadURL(imgRef);
      await update(ref(db, `game/market/${uid}`), {
        name: pubName.trim(),
        description: pubDesc.trim(),
        category: pubCategory,
        imageURL,
        ownerId: pid,
        createdAt: Date.now(),
      });
      addLog("exhibit", `\ud83d\udce6 ${me.name} public\u00f3 "${pubName.trim()}" en el mercado.`);
      setPubName(""); setPubDesc(""); setPubCategory(CATEGORIES[0]); setPubImage(null); setPubPreview(null); setShowPublish(false);
    } catch (err) {
      console.error(err);
    }
    setPublishing(false);
  };

  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // Resize for efficiency
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxSize = 600;
        let w = img.width, h = img.height;
        if (w > h) { if (w > maxSize) { h = h * maxSize / w; w = maxSize; } }
        else { if (h > maxSize) { w = w * maxSize / h; h = maxSize; } }
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          setPubImage(blob);
          setPubPreview(canvas.toDataURL());
        }, "image/jpeg", 0.8);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  // WITHDRAW
  const withdrawObject = async (mObj) => {
    if (buyOffer && buyOffer.uid === mObj.uid) return;
    const updates = {};
    Object.entries(players).forEach(([p, data]) => {
      if (data.likedObjectId === mObj.uid) updates[`players/${p}/likedObjectId`] = null;
    });
    updates[`market/${mObj.uid}`] = null;
    const newObt = [...(me.obtained || []), { name: mObj.name, description: mObj.description, category: mObj.category, imageURL: mObj.imageURL }];
    updates[`players/${pid}/obtained`] = newObt;
    await update(ref(db, "game"), updates);
    addLog("system", `\u21a9\ufe0f ${me.name} retir\u00f3 "${mObj.name}" del mercado.`);
  };

  // RE-EXHIBIT
  const reExhibit = async (idx) => {
    const obj = me.obtained[idx];
    if (!obj) return;
    const uid = `${pid}-${Date.now()}`;
    const newObt = me.obtained.filter((_, i) => i !== idx);
    await update(ref(db, `game/players/${pid}`), { obtained: newObt });
    await update(ref(db, `game/market/${uid}`), { ...obj, ownerId: pid, createdAt: Date.now() });
    addLog("exhibit", `\ud83d\udce6 ${me.name} re-exhibi\u00f3 "${obj.name}" en el mercado.`);
  };

  // LIKE
  const toggleLike = async (mObj) => {
    if (mObj.ownerId === pid) return;
    if (buyOffer && buyOffer.uid === mObj.uid) return;
    if (saleModal && saleModal.uid === mObj.uid) return;
    if (me.likedObjectId === mObj.uid) {
      await update(ref(db, `game/players/${pid}`), { likedObjectId: null });
      addLog("unlike", `\ud83d\udc4e ${me.name} retir\u00f3 su like de "${mObj.name}".`);
    } else {
      if (me.likedObjectId) {
        const prev = marketItems.find(m => m.uid === me.likedObjectId);
        if (prev) addLog("unlike", `\ud83d\udc4e ${me.name} movi\u00f3 su like de "${prev.name}".`);
      }
      await update(ref(db, `game/players/${pid}`), { likedObjectId: mObj.uid });
      addLog("like", `\ud83d\udc4d ${me.name} le dio like a "${mObj.name}".`);
    }
  };

  // SELL
  const openSellModal = (mObj) => {
    if (buyOffer && buyOffer.uid === mObj.uid) return;
    const likers = Object.entries(players).filter(([p, data]) => data.likedObjectId === mObj.uid && p !== mObj.ownerId);
    if (likers.length === 0) { addLog("system", `\u274c "${mObj.name}" no tiene likes.`); return; }
    setSaleModal({ ...mObj, likers, basePrice: getLikes(mObj.uid) });
  };

  const executeSale = async (mObj, buyerPid, sellerReceives, debtCancelled) => {
    const buyer = players[buyerPid];
    const seller = players[mObj.ownerId];
    const likeCount = getLikes(mObj.uid);
    const sr = sellerReceives !== undefined ? sellerReceives : likeCount;
    const dc = debtCancelled !== undefined ? debtCancelled : 0;
    let buyerNewLikes = buyer.likes < 0 ? -sr : (buyer.likes || 0) - likeCount;

    const updates = {};
    updates[`players/${buyerPid}/likes`] = buyerNewLikes;
    updates[`players/${buyerPid}/obtained`] = [...(buyer.obtained || []), { name: mObj.name, description: mObj.description || "", category: mObj.category || "", imageURL: mObj.imageURL || "" }];
    if (buyer.likedObjectId === mObj.uid) updates[`players/${buyerPid}/likedObjectId`] = null;
    updates[`players/${mObj.ownerId}/likes`] = (seller.likes || 0) + sr;
    Object.entries(players).forEach(([p, data]) => {
      if (data.likedObjectId === mObj.uid) updates[`players/${p}/likedObjectId`] = null;
    });
    updates[`market/${mObj.uid}`] = null;
    updates[`buyOffer`] = null;
    await update(ref(db, "game"), updates);

    if (dc > 0) {
      addLog("sell", `\ud83d\udcb0 ${seller.name} vendi\u00f3 "${mObj.name}" a ${buyer.name}. ${dc} cancelaron deuda, recibe ${sr} likes.`);
    } else {
      addLog("sell", `\ud83d\udcb0 ${seller.name} vendi\u00f3 "${mObj.name}" a ${buyer.name} por ${likeCount} likes.`);
    }
    if (buyerNewLikes < 0 && dc === 0) {
      addLog("credit", `\ud83d\udd34 ${buyer.name} compr\u00f3 a cr\u00e9dito (${buyerNewLikes} likes).`);
    }
    setSaleModal(null);
  };

  // BUY OFFER
  const makeBuyOffer = async (mObj) => {
    const likeCount = getLikes(mObj.uid);
    if (likeCount === 0) return;
    const debt = Math.abs(Math.min(0, me.likes || 0));
    let sr, dc;
    if ((me.likes || 0) >= 0) {
      if ((me.likes || 0) < likeCount) return;
      sr = likeCount; dc = 0;
    } else {
      if (likeCount < debt) return;
      sr = likeCount - debt; dc = debt;
    }
    await update(ref(db, "game/buyOffer"), {
      uid: mObj.uid, name: mObj.name, imageURL: mObj.imageURL || "", ownerId: mObj.ownerId,
      buyerId: pid, price: likeCount, sellerReceives: sr, debtCancelled: dc, time: Date.now(),
    });
    if (dc > 0) {
      addLog("system", `\ud83d\uded2 ${me.name} ofrece comprar "${mObj.name}": ${dc} cancelan deuda + ${sr} para vendedor.`);
    } else {
      addLog("system", `\ud83d\uded2 ${me.name} ofrece comprar "${mObj.name}" por ${likeCount} likes.`);
    }
  };

  const acceptOffer = async () => {
    if (!buyOffer) return;
    const mObj = { uid: buyOffer.uid, name: buyOffer.name, ownerId: buyOffer.ownerId, imageURL: buyOffer.imageURL,
      description: market[buyOffer.uid]?.description || "", category: market[buyOffer.uid]?.category || "" };
    await executeSale(mObj, buyOffer.buyerId, buyOffer.sellerReceives, buyOffer.debtCancelled);
    addLog("sell", `\u2705 Oferta aceptada por "${buyOffer.name}".`);
  };

  const rejectOffer = async () => {
    if (!buyOffer) return;
    await update(ref(db, "game"), { buyOffer: null });
    addLog("system", `\u274c Oferta por "${buyOffer.name}" rechazada.`);
  };

  const isMyOffer = buyOffer && buyOffer.ownerId === pid;
  const iMadeOffer = buyOffer && buyOffer.buyerId === pid;
  const logColors = { sell: "#10b981", like: "#f59e0b", unlike: "#94a3b8", exhibit: "#8b5cf6", credit: "#ef4444", system: "#64748b" };
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;

  const inputStyle = {
    background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "8px", padding: "10px 12px", fontSize: "14px", color: "#e2e8f0", width: "100%", outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #0a0e1a 0%, #111827 40%, #1a1a2e 100%)",
      fontFamily: "'Segoe UI', system-ui, sans-serif", color: "#e2e8f0", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)",
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "18px" }}>🏠</span>
          <span style={{ fontWeight: 800, fontSize: "15px", background: "linear-gradient(135deg, #38bdf8, #818cf8)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>El Trueque</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "12px" }}>
          <span style={{ color: "#94a3b8" }}>Billetera: <strong style={{ color: (me.likes || 0) >= 0 ? "#10b981" : "#ef4444" }}>{me.likes || 0} ❤️</strong></span>
          <span style={{ color: "#94a3b8" }}>Like: <strong style={{ color: "#f59e0b" }}>{me.likedObjectId ? "✓" : "libre"}</strong></span>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {user.photo && <img src={user.photo} style={{ width: 22, height: 22, borderRadius: "50%" }} />}
            <span style={{ color: "#94a3b8", fontSize: "11px" }}>{user.name}</span>
            <button onClick={onLogout} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "11px" }}>Salir</button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ padding: "5px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.2)",
        display: "flex", gap: "14px", fontSize: "11px", color: "#64748b", flexWrap: "wrap" }}>
        <span>Likes total: <strong style={{ color: "#f59e0b" }}>{Object.values(players).reduce((s, p) => s + (p.likes || 0), 0)}</strong></span>
        <span>Mercado: <strong style={{ color: "#8b5cf6" }}>{marketItems.length}</strong></span>
        <span>Jugadores: <strong style={{ color: "#38bdf8" }}>{Object.keys(players).length}</strong></span>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden", flexDirection: isMobile ? "column" : "row" }}>
        {/* Main */}
        <div style={{ flex: 1, overflow: "auto", padding: "10px", display: "flex", flexDirection: "column", gap: "10px" }}>

          {/* Publish button */}
          <button onClick={() => setShowPublish(true)} style={{
            background: "linear-gradient(135deg, #8b5cf6, #6d28d9)", color: "#fff", border: "none",
            borderRadius: "10px", padding: "12px", fontSize: "14px", fontWeight: 700, cursor: "pointer", width: "100%" }}>
            + Publicar producto
          </button>

          {/* Obtained */}
          {me.obtained && me.obtained.length > 0 && (
            <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: "10px", padding: "10px", border: "1px solid rgba(255,255,255,0.05)" }}>
              <h3 style={{ fontSize: "11px", color: "#22c55e", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "6px" }}>🏠 Obtenidos</h3>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {me.obtained.map((obj, i) => (
                  <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
                    <div style={{ width: 60, height: 60, borderRadius: "6px", overflow: "hidden", border: "1px solid rgba(34,197,94,0.25)" }}>
                      {obj.imageURL ? <img src={obj.imageURL} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> :
                        <div style={{ width: "100%", height: "100%", background: "rgba(34,197,94,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "#22c55e" }}>{obj.name}</div>}
                    </div>
                    <span style={{ fontSize: "9px", color: "#22c55e" }}>{obj.name}</span>
                    <button onClick={() => reExhibit(i)} style={{ background: "transparent", border: "1px solid rgba(139,92,246,0.25)",
                      borderRadius: "3px", padding: "1px 5px", fontSize: "8px", color: "#8b5cf6", cursor: "pointer" }}>Re-exhibir</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Market */}
          <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: "10px", padding: "10px", border: "1px solid rgba(255,255,255,0.05)", flex: 1 }}>
            <h3 style={{ fontSize: "11px", color: "#f59e0b", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>🏪 Mercado</h3>
            {marketItems.length === 0 ? (
              <p style={{ color: "#64748b", fontSize: "12px" }}>El mercado está vacío. ¡Publicá algo!</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? "140px" : "150px"}, 1fr))`, gap: "8px" }}>
                {marketItems.map(mObj => {
                  const likeCount = getLikes(mObj.uid);
                  const isLiked = me.likedObjectId === mObj.uid;
                  const isOwn = mObj.ownerId === pid;
                  const hasPending = buyOffer && buyOffer.uid === mObj.uid;
                  const isLocked = hasPending;
                  const debt = (me.likes || 0) < 0 ? Math.abs(me.likes) : 0;
                  const canBuySolvent = isLiked && !isOwn && (me.likes || 0) >= 0 && (me.likes || 0) >= likeCount && likeCount > 0 && !isLocked;
                  const canBuyIndebted = isLiked && !isOwn && (me.likes || 0) < 0 && likeCount >= debt && likeCount > 0 && !isLocked;
                  const canBuy = canBuySolvent || canBuyIndebted;
                  const offerAmt = canBuyIndebted ? likeCount - debt : likeCount;
                  const ownerName = players[mObj.ownerId]?.name || "?";

                  return (
                    <div key={mObj.uid} style={{
                      background: isLiked ? "rgba(56,189,248,0.08)" : "rgba(255,255,255,0.03)",
                      border: isLiked ? "1px solid rgba(56,189,248,0.3)" : "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "10px", overflow: "hidden", position: "relative",
                      opacity: isLocked && !isOwn ? 0.5 : 1,
                    }}>
                      {isLocked && (
                        <div style={{ position: "absolute", top: 4, left: 4, background: "#f59e0b", color: "#000",
                          fontSize: "8px", fontWeight: 800, padding: "1px 5px", borderRadius: "3px", zIndex: 2 }}>OFERTA</div>
                      )}
                      {likeCount > 0 && (
                        <div style={{ position: "absolute", top: 4, right: 4, background: "linear-gradient(135deg, #f59e0b, #d97706)",
                          color: "#000", borderRadius: "50%", width: 20, height: 20, display: "flex", alignItems: "center",
                          justifyContent: "center", fontSize: "10px", fontWeight: 800, zIndex: 2 }}>{likeCount}</div>
                      )}
                      <div onClick={() => { if (isLocked) return; isOwn ? openSellModal(mObj) : toggleLike(mObj); }}
                        style={{ cursor: isLocked ? "default" : "pointer", height: 100, overflow: "hidden" }}>
                        {mObj.imageURL ? <img src={mObj.imageURL} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> :
                          <div style={{ width: "100%", height: "100%", background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>{mObj.name}</div>}
                      </div>
                      <div style={{ padding: "6px 8px" }}>
                        <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "2px", lineHeight: 1.2,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mObj.name}</div>
                        {mObj.description && <div style={{ fontSize: "10px", color: "#94a3b8", lineHeight: 1.3, marginBottom: "3px",
                          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{mObj.description}</div>}
                        <div style={{ fontSize: "9px", color: "#64748b", marginBottom: "4px" }}>{mObj.category} · {ownerName}</div>
                        <div style={{ fontSize: "9px", color: "#64748b" }}>
                          {isLocked ? "🔒 Bloqueado" : isOwn ? (
                            <span>
                              <span style={{ cursor: "pointer", color: "#10b981" }} onClick={() => openSellModal(mObj)}>Vender</span>
                              {" | "}
                              <span style={{ cursor: "pointer", color: "#94a3b8" }} onClick={() => withdrawObject(mObj)}>Retirar</span>
                            </span>
                          ) : (isLiked ? "👍 Tu like" : "Tocá para dar like")}
                        </div>
                        {canBuy && (
                          <button onClick={() => makeBuyOffer(mObj)} style={{
                            marginTop: "4px", width: "100%",
                            background: canBuyIndebted ? "linear-gradient(135deg, #f59e0b, #d97706)" : "linear-gradient(135deg, #10b981, #059669)",
                            color: "#fff", border: "none", borderRadius: "5px", padding: "4px", fontSize: "10px", fontWeight: 700, cursor: "pointer" }}>
                            {canBuyIndebted ? (offerAmt === 0 ? "Pedir donación" : `Ofertar ${offerAmt}`) : `Comprar (${likeCount})`}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Side panel */}
        <div style={{ width: isMobile ? "100%" : "220px",
          borderLeft: isMobile ? "none" : "1px solid rgba(255,255,255,0.06)",
          borderTop: isMobile ? "1px solid rgba(255,255,255,0.06)" : "none",
          display: "flex", flexDirection: "column", background: "rgba(0,0,0,0.15)",
          maxHeight: isMobile ? "250px" : "none" }}>

          <div style={{ padding: "10px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <h3 style={{ fontSize: "11px", color: "#818cf8", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "6px" }}>Jugadores</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              {Object.entries(players).map(([p, data]) => (
                <div key={p} style={{
                  padding: "5px 7px", borderRadius: "5px", fontSize: "11px",
                  background: p === pid ? "rgba(56,189,248,0.1)" : "rgba(255,255,255,0.02)",
                  display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    {data.photo && <img src={data.photo} style={{ width: 16, height: 16, borderRadius: "50%" }} />}
                    {data.name} {p === pid && "(vos)"}
                  </span>
                  <span style={{ color: (data.likes || 0) >= 0 ? "#10b981" : "#ef4444", fontWeight: 700, fontSize: "10px" }}>
                    {data.likes || 0} ❤️
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, padding: "10px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <h3 style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "6px" }}>Registro</h3>
            <div ref={logRef} style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
              {logEntries.map((e, i) => (
                <div key={i} style={{ padding: "3px 6px", borderLeft: `2px solid ${logColors[e.type] || "#64748b"}`,
                  background: "rgba(255,255,255,0.02)", borderRadius: "0 3px 3px 0", fontSize: "10px", color: "#c8d6e5", lineHeight: 1.3 }}>
                  {e.message}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* PUBLISH MODAL */}
      {showPublish && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "16px" }}>
          <div style={{ background: "linear-gradient(135deg, #1e293b, #0f172a)", borderRadius: "16px", padding: "20px", maxWidth: "400px", width: "100%", border: "1px solid rgba(255,255,255,0.1)" }}>
            <h3 style={{ fontSize: "16px", marginBottom: "14px" }}>📦 Publicar producto</h3>

            <div onClick={() => fileInputRef.current?.click()} style={{
              width: "100%", height: 140, borderRadius: "10px", marginBottom: "10px", cursor: "pointer",
              border: "2px dashed rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center",
              overflow: "hidden", background: "rgba(255,255,255,0.03)" }}>
              {pubPreview ? <img src={pubPreview} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> :
                <span style={{ color: "#64748b", fontSize: "13px" }}>Tocá para subir foto</span>}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageSelect} style={{ display: "none" }} />

            <input type="text" placeholder="Nombre del producto" value={pubName} onChange={e => setPubName(e.target.value)}
              maxLength={50} style={{ ...inputStyle, marginBottom: "8px" }} />

            <textarea placeholder="Descripción (máx 140 caracteres)" value={pubDesc} onChange={e => setPubDesc(e.target.value.slice(0, 140))}
              rows={2} style={{ ...inputStyle, marginBottom: "8px", resize: "none" }} />
            <div style={{ fontSize: "10px", color: "#64748b", textAlign: "right", marginBottom: "8px" }}>{pubDesc.length}/140</div>

            <select value={pubCategory} onChange={e => setPubCategory(e.target.value)}
              style={{ ...inputStyle, marginBottom: "14px" }}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={publishProduct} disabled={publishing || !pubName.trim() || !pubImage} style={{
                flex: 1, background: "linear-gradient(135deg, #8b5cf6, #6d28d9)", color: "#fff", border: "none",
                borderRadius: "10px", padding: "12px", fontSize: "14px", fontWeight: 700, cursor: "pointer",
                opacity: publishing || !pubName.trim() || !pubImage ? 0.5 : 1 }}>
                {publishing ? "Subiendo..." : "Publicar"}
              </button>
              <button onClick={() => { setShowPublish(false); setPubPreview(null); setPubImage(null); }} style={{
                background: "rgba(255,255,255,0.05)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "10px", padding: "12px 20px", fontSize: "14px", cursor: "pointer" }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BUY OFFER MODAL */}
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
              <strong>{players[buyOffer.buyerId]?.name}</strong> quiere tu <strong>"{buyOffer.name}"</strong>.
              {buyOffer.debtCancelled > 0 ? (
                <> Deuda: {buyOffer.debtCancelled}. Recibirías <strong style={{ color: "#10b981" }}>{buyOffer.sellerReceives} likes</strong>.</>
              ) : (
                <> Recibirías <strong style={{ color: "#10b981" }}>{buyOffer.sellerReceives} likes</strong>.</>
              )}
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={acceptOffer} style={{ flex: 1, background: "linear-gradient(135deg, #10b981, #059669)", color: "#fff", border: "none", borderRadius: "10px", padding: "12px", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}>✅ Aceptar</button>
              <button onClick={rejectOffer} style={{ flex: 1, background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "10px", padding: "12px", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}>❌ Rechazar</button>
            </div>
          </div>
        </div>
      )}

      {/* WAITING */}
      {iMadeOffer && buyOffer && (
        <div style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)",
          background: "linear-gradient(135deg, #1e293b, #0f172a)", border: "1px solid rgba(245,158,11,0.25)",
          borderRadius: "12px", padding: "10px 20px", zIndex: 90, display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ color: "#f59e0b", fontSize: "12px", fontWeight: 600 }}>Esperando respuesta... ⏱ {offerTimer}s</span>
        </div>
      )}

      {/* SALE MODAL */}
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
            <p style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "10px" }}>Valor: <strong style={{ color: "#f59e0b" }}>{saleModal.basePrice} likes</strong></p>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
              {saleModal.likers.map(([lp, ld]) => {
                const ind = (ld.likes || 0) < 0;
                const lDebt = ind ? Math.abs(ld.likes) : 0;
                const canA = ind ? saleModal.basePrice >= lDebt : true;
                const sr = ind ? saleModal.basePrice - lDebt : saleModal.basePrice;
                const dc = ind ? lDebt : 0;
                const blocked = ind && !canA;
                return (
                  <button key={lp} onClick={blocked ? undefined : () => executeSale(saleModal, lp, sr, dc)} disabled={blocked}
                    style={{ background: blocked ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.05)",
                      border: blocked ? "1px solid rgba(239,68,68,0.2)" : "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "8px", padding: "10px", color: blocked ? "#64748b" : "#e2e8f0",
                      cursor: blocked ? "not-allowed" : "pointer", display: "flex", justifyContent: "space-between",
                      alignItems: "center", textAlign: "left", opacity: blocked ? 0.6 : 1 }}>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 600 }}>{ld.name}</div>
                      <div style={{ fontSize: "10px", color: "#94a3b8" }}>
                        {ld.likes || 0} likes
                        {ind && canA && <span style={{ color: "#f59e0b" }}> (recibirías {sr})</span>}
                        {blocked && <span style={{ color: "#ef4444" }}> (deuda excede valor)</span>}
                        {!ind && (ld.likes || 0) < saleModal.basePrice && <span style={{ color: "#f59e0b" }}> (a crédito)</span>}
                      </div>
                    </div>
                    {!blocked && <span style={{ color: "#10b981", fontWeight: 700, fontSize: "12px" }}>→</span>}
                  </button>
                );
              })}
            </div>
            <button onClick={() => setSaleModal(null)} style={{ background: "transparent", color: "#64748b",
              border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "8px", fontSize: "12px", cursor: "pointer", width: "100%" }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
