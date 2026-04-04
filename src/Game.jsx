import { useState, useEffect, useRef } from "react";
import {
  db, ref, get, onValue, update, push,
  storage, storageRef, uploadBytes, getDownloadURL,
} from "./firebase.js";
import { translations, CATEGORIES } from "./i18n.js";

function addLog(type, message) {
  push(ref(db, "game/log"), { type, message, time: Date.now() });
}

export default function Game({ user, onLogout, lang, setLang }) {
  const [game, setGame] = useState(null);
  const [tab, setTab] = useState("market");
  const [searchMode, setSearchMode] = useState("categories");
  const [searchText, setSearchText] = useState("");
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);
  const [pubName, setPubName] = useState("");
  const [pubDesc, setPubDesc] = useState("");
  const [pubCategory, setPubCategory] = useState("");
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
  const t = translations[lang];
  const cats = CATEGORIES[lang];

  useEffect(() => { if (!pubCategory) setPubCategory(cats[0]); }, [lang]);

  useEffect(() => {
    const unsub = onValue(ref(db, "game"), (snap) => {
      if (snap.exists()) setGame(snap.val());
      else setGame({ players: {}, market: {}, log: {}, buyOffer: null });
    });
    return () => unsub();
  }, []);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [game?.log]);

  // Offer timer
  useEffect(() => {
    if (game?.buyOffer) {
      setOfferTimer(10);
      offerTimerRef.current = setInterval(() => {
        setOfferTimer(p => { if (p <= 1) { clearInterval(offerTimerRef.current); return 0; } return p - 1; });
      }, 1000);
      return () => clearInterval(offerTimerRef.current);
    } else { setOfferTimer(null); if (offerTimerRef.current) clearInterval(offerTimerRef.current); }
  }, [game?.buyOffer?.time]);

  useEffect(() => { if (offerTimer === 0 && game?.buyOffer) rejectOffer(); }, [offerTimer]);

  // Sale timer
  useEffect(() => {
    if (saleModal) {
      setSaleTimer(10);
      saleTimerRef.current = setInterval(() => {
        setSaleTimer(p => { if (p <= 1) { clearInterval(saleTimerRef.current); return 0; } return p - 1; });
      }, 1000);
      return () => clearInterval(saleTimerRef.current);
    } else { setSaleTimer(null); if (saleTimerRef.current) clearInterval(saleTimerRef.current); }
  }, [saleModal]);

  useEffect(() => {
    if (saleTimer === 0 && saleModal) {
      addLog("system", `${t.timeUp}: "${saleModal.name}".`);
      setSaleModal(null);
    }
  }, [saleTimer]);

  if (!game || !game.players?.[pid]) {
    return <div style={{ minHeight: "100vh", background: "#0a0e1a", color: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>{t.loading}</div>;
  }

  const me = game.players[pid];
  const players = game.players;
  const market = game.market || {};
  const marketItems = Object.entries(market).map(([uid, obj]) => ({ ...obj, uid }));
  const buyOffer = game.buyOffer || null;
  const logEntries = game.log ? Object.values(game.log).sort((a, b) => a.time - b.time).slice(-50) : [];
  const getLikes = (uid) => Object.values(players).filter(p => p.likedObjectId === uid).length;

  // Filter market
  const filteredItems = marketItems.filter(item => {
    if (searchMode === "categories") {
      if (selectedCategories.length === 0) return true;
      return selectedCategories.includes(item.category);
    }
    if (searchMode === "items") {
      if (!searchText.trim()) return true;
      return item.name.toLowerCase().includes(searchText.toLowerCase()) || (item.description || "").toLowerCase().includes(searchText.toLowerCase());
    }
    if (searchMode === "users") {
      if (!searchText.trim()) return true;
      const ownerName = players[item.ownerId]?.name || "";
      return ownerName.toLowerCase().includes(searchText.toLowerCase());
    }
    return true;
  });

  // === ACTIONS ===
  const publishProduct = async () => {
    if (!pubName.trim() || !pubImage) return;
    setPublishing(true);
    try {
      const uid = `${pid}-${Date.now()}`;
      const imgRef = storageRef(storage, `products/${uid}`);
      await uploadBytes(imgRef, pubImage);
      const imageURL = await getDownloadURL(imgRef);
      await update(ref(db, `game/market/${uid}`), {
        name: pubName.trim(), description: pubDesc.trim(), category: pubCategory,
        imageURL, ownerId: pid, createdAt: Date.now(),
      });
      addLog("exhibit", `📦 ${me.name}: "${pubName.trim()}"`);
      setPubName(""); setPubDesc(""); setPubCategory(cats[0]); setPubImage(null); setPubPreview(null);
      setTab("market");
    } catch (err) { console.error(err); }
    setPublishing(false);
  };

  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const max = 800;
        let w = img.width, h = img.height;
        if (w > h) { if (w > max) { h = h * max / w; w = max; } } else { if (h > max) { w = w * max / h; h = max; } }
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => { setPubImage(blob); setPubPreview(canvas.toDataURL()); }, "image/jpeg", 0.85);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const withdrawObject = async (mObj) => {
    if (buyOffer && buyOffer.uid === mObj.uid) return;
    const updates = {};
    Object.entries(players).forEach(([p, d]) => { if (d.likedObjectId === mObj.uid) updates[`players/${p}/likedObjectId`] = null; });
    updates[`market/${mObj.uid}`] = null;
    updates[`players/${pid}/obtained`] = [...(me.obtained || []), { name: mObj.name, description: mObj.description, category: mObj.category, imageURL: mObj.imageURL }];
    await update(ref(db, "game"), updates);
    addLog("system", `↩️ ${me.name}: "${mObj.name}"`);
  };

  const reExhibit = async (idx) => {
    const obj = me.obtained[idx];
    if (!obj) return;
    const uid = `${pid}-${Date.now()}`;
    const newObt = me.obtained.filter((_, i) => i !== idx);
    await update(ref(db, `game/players/${pid}`), { obtained: newObt });
    await update(ref(db, `game/market/${uid}`), { ...obj, ownerId: pid, createdAt: Date.now() });
    addLog("exhibit", `📦 ${me.name} re: "${obj.name}"`);
  };

  const toggleLike = async (mObj) => {
    if (mObj.ownerId === pid || (buyOffer && buyOffer.uid === mObj.uid) || (saleModal && saleModal.uid === mObj.uid)) return;
    if (me.likedObjectId === mObj.uid) {
      await update(ref(db, `game/players/${pid}`), { likedObjectId: null });
      addLog("unlike", `👎 ${me.name} ✕ "${mObj.name}"`);
    } else {
      await update(ref(db, `game/players/${pid}`), { likedObjectId: mObj.uid });
      addLog("like", `👍 ${me.name} → "${mObj.name}"`);
    }
  };

  const openSellModal = (mObj) => {
    if (buyOffer && buyOffer.uid === mObj.uid) return;
    const likers = Object.entries(players).filter(([p, d]) => d.likedObjectId === mObj.uid && p !== mObj.ownerId);
    if (likers.length === 0) return;
    setSaleModal({ ...mObj, likers, basePrice: getLikes(mObj.uid) });
  };

  const executeSale = async (mObj, buyerPid, sellerReceives, debtCancelled) => {
    const buyer = players[buyerPid];
    const seller = players[mObj.ownerId];
    const likeCount = getLikes(mObj.uid);
    const sr = sellerReceives !== undefined ? sellerReceives : likeCount;
    const dc = debtCancelled !== undefined ? debtCancelled : 0;
    let buyerNew = buyer.likes < 0 ? -sr : (buyer.likes || 0) - likeCount;
    const updates = {};
    updates[`players/${buyerPid}/likes`] = buyerNew;
    updates[`players/${buyerPid}/obtained`] = [...(buyer.obtained || []), { name: mObj.name, description: mObj.description || "", category: mObj.category || "", imageURL: mObj.imageURL || "" }];
    if (buyer.likedObjectId === mObj.uid) updates[`players/${buyerPid}/likedObjectId`] = null;
    updates[`players/${mObj.ownerId}/likes`] = (seller.likes || 0) + sr;
    Object.entries(players).forEach(([p, d]) => { if (d.likedObjectId === mObj.uid) updates[`players/${p}/likedObjectId`] = null; });
    updates[`market/${mObj.uid}`] = null;
    updates[`buyOffer`] = null;
    await update(ref(db, "game"), updates);
    addLog("sell", `💰 ${seller.name} → ${buyer.name}: "${mObj.name}" (${sr} ${t.likes})`);
    if (buyerNew < 0 && dc === 0) addLog("credit", `🔴 ${buyer.name}: ${buyerNew} ${t.likes}`);
    setSaleModal(null);
  };

  const makeBuyOffer = async (mObj) => {
    const likeCount = getLikes(mObj.uid);
    if (likeCount === 0) return;
    const debt = Math.abs(Math.min(0, me.likes || 0));
    let sr, dc;
    if ((me.likes || 0) >= 0) { if ((me.likes || 0) < likeCount) return; sr = likeCount; dc = 0; }
    else { if (likeCount < debt) return; sr = likeCount - debt; dc = debt; }
    await update(ref(db, "game/buyOffer"), {
      uid: mObj.uid, name: mObj.name, imageURL: mObj.imageURL || "", ownerId: mObj.ownerId,
      buyerId: pid, price: likeCount, sellerReceives: sr, debtCancelled: dc, time: Date.now(),
    });
    addLog("system", `🛒 ${me.name} → "${mObj.name}" (${sr} ${t.likes})`);
  };

  const acceptOffer = async () => {
    if (!buyOffer) return;
    const mObj = { uid: buyOffer.uid, name: buyOffer.name, ownerId: buyOffer.ownerId, imageURL: buyOffer.imageURL, description: market[buyOffer.uid]?.description || "", category: market[buyOffer.uid]?.category || "" };
    await executeSale(mObj, buyOffer.buyerId, buyOffer.sellerReceives, buyOffer.debtCancelled);
  };

  const rejectOffer = async () => {
    if (!buyOffer) return;
    await update(ref(db, "game"), { buyOffer: null });
    addLog("system", `❌ "${buyOffer.name}"`);
  };

  const isMyOffer = buyOffer && buyOffer.ownerId === pid;
  const iMadeOffer = buyOffer && buyOffer.buyerId === pid;
  const logColors = { sell: "#10b981", like: "#f59e0b", unlike: "#94a3b8", exhibit: "#8b5cf6", credit: "#ef4444", system: "#64748b" };

  const toggleCategory = (cat) => {
    setSelectedCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  };

  // === RENDER ===
  const headerH = 52;
  const searchH = 48;
  const bottomH = 56;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e1a", fontFamily: "'Segoe UI', system-ui, sans-serif", color: "#e2e8f0", display: "flex", flexDirection: "column" }}>

      {/* HEADER */}
      <div style={{ height: headerH, padding: "0 12px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(0,0,0,0.4)", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <span style={{ fontWeight: 800, fontSize: "18px", background: "linear-gradient(135deg, #38bdf8, #818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{t.appName}</span>
        <div style={{ display: "flex", gap: "3px" }}>
          {["es", "it", "en"].map(l => (
            <button key={l} onClick={() => setLang(l)} style={{
              background: lang === l ? "rgba(255,255,255,0.12)" : "transparent",
              border: "none", borderRadius: "4px", padding: "3px 8px", fontSize: "11px", fontWeight: 600,
              color: lang === l ? "#e2e8f0" : "#64748b", cursor: "pointer", textTransform: "uppercase" }}>{l}</button>
          ))}
        </div>
      </div>

      {/* SEARCH BAR */}
      {tab === "market" && (
        <div style={{ height: searchH, padding: "6px 12px", display: "flex", alignItems: "center", gap: "6px", background: "rgba(0,0,0,0.25)", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
          <select value={searchMode} onChange={e => { setSearchMode(e.target.value); setSearchText(""); setSelectedCategories([]); setCatDropdownOpen(false); }}
            style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "8px", padding: "6px 8px", fontSize: "12px", color: "#e2e8f0", outline: "none", minWidth: "90px" }}>
            <option value="categories">{t.searchCategories}</option>
            <option value="items">{t.searchItems}</option>
            <option value="users">{t.searchUsers}</option>
          </select>

          {searchMode === "categories" ? (
            <div style={{ flex: 1, position: "relative" }}>
              <div onClick={() => setCatDropdownOpen(!catDropdownOpen)} style={{
                background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "8px",
                padding: "6px 10px", fontSize: "12px", color: selectedCategories.length ? "#e2e8f0" : "#94a3b8", cursor: "pointer",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {selectedCategories.length === 0 ? t.allCategories : selectedCategories.join(", ")}
              </div>
              {catDropdownOpen && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1e293b", border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: "8px", marginTop: "4px", zIndex: 50, maxHeight: "240px", overflow: "auto" }}>
                  <div onClick={() => { setSelectedCategories([]); setCatDropdownOpen(false); }} style={{
                    padding: "8px 12px", fontSize: "12px", cursor: "pointer", color: selectedCategories.length === 0 ? "#38bdf8" : "#94a3b8",
                    background: selectedCategories.length === 0 ? "rgba(56,189,248,0.1)" : "transparent" }}>
                    {t.allCategories}
                  </div>
                  {cats.map(cat => (
                    <div key={cat} onClick={() => toggleCategory(cat)} style={{
                      padding: "8px 12px", fontSize: "12px", cursor: "pointer",
                      color: selectedCategories.includes(cat) ? "#38bdf8" : "#e2e8f0",
                      background: selectedCategories.includes(cat) ? "rgba(56,189,248,0.1)" : "transparent",
                      display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ width: 14, height: 14, borderRadius: "3px", border: "1px solid rgba(255,255,255,0.2)",
                        background: selectedCategories.includes(cat) ? "#38bdf8" : "transparent", display: "inline-block", flexShrink: 0 }} />
                      {cat}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <input type="text" value={searchText} onChange={e => setSearchText(e.target.value)}
              placeholder={searchMode === "users" ? t.searchPlaceholderUsers : t.searchPlaceholderItems}
              style={{ flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: "8px", padding: "6px 10px", fontSize: "12px", color: "#e2e8f0", outline: "none" }} />
          )}
        </div>
      )}

      {/* CONTENT */}
      <div style={{ flex: 1, overflow: "auto", paddingBottom: bottomH + 8 }} onClick={() => setCatDropdownOpen(false)}>

        {/* MARKET TAB - Instagram style */}
        {tab === "market" && (
          <div>
            {filteredItems.length === 0 ? (
              <p style={{ textAlign: "center", color: "#64748b", padding: "60px 20px", fontSize: "14px" }}>
                {marketItems.length === 0 ? t.emptyMarket : t.noResults}
              </p>
            ) : (
              filteredItems.map(mObj => {
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
                const ownerData = players[mObj.ownerId];
                const hasLikers = Object.values(players).some(p => p.likedObjectId === mObj.uid && mObj.ownerId !== pid);

                return (
                  <div key={mObj.uid} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    {/* Owner info bar */}
                    <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: "8px" }}>
                      {ownerData?.photo ? <img src={ownerData.photo} style={{ width: 28, height: 28, borderRadius: "50%" }} /> :
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px" }}>{(ownerData?.name || "?")[0]}</div>}
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: 600 }}>{ownerData?.name} {isOwn && "(vos)"}</div>
                        <div style={{ fontSize: "10px", color: "#64748b" }}>{mObj.category}</div>
                      </div>
                      {isLocked && <span style={{ marginLeft: "auto", background: "#f59e0b", color: "#000", fontSize: "9px", fontWeight: 800, padding: "2px 6px", borderRadius: "4px" }}>{t.offerLabel}</span>}
                    </div>

                    {/* Image */}
                    <div onClick={() => { if (!isLocked && !isOwn) toggleLike(mObj); }}
                      style={{ width: "100%", aspectRatio: "1/1", position: "relative", cursor: isOwn || isLocked ? "default" : "pointer", overflow: "hidden", background: "#111" }}>
                      {mObj.imageURL ? <img src={mObj.imageURL} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> :
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: "20px" }}>{mObj.name}</div>}

                      {/* Overlay bottom */}
                      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0,
                        background: "linear-gradient(transparent, rgba(0,0,0,0.8))", padding: "40px 14px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "2px" }}>{mObj.name}</div>
                            {mObj.description && <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)", lineHeight: 1.3 }}>{mObj.description}</div>}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
                            {/* Like count */}
                            <div style={{ textAlign: "center" }}>
                              <div style={{ fontSize: "22px", lineHeight: 1 }}>{isLiked ? "❤️" : "🤍"}</div>
                              <div style={{ fontSize: "12px", fontWeight: 700, marginTop: "2px" }}>{likeCount}</div>
                            </div>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                          {isOwn && !isLocked && hasLikers && (
                            <button onClick={(e) => { e.stopPropagation(); openSellModal(mObj); }} style={{
                              background: "rgba(16,185,129,0.9)", color: "#fff", border: "none", borderRadius: "8px",
                              padding: "7px 16px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>{t.sell}</button>
                          )}
                          {isOwn && !isLocked && (
                            <button onClick={(e) => { e.stopPropagation(); withdrawObject(mObj); }} style={{
                              background: "rgba(255,255,255,0.15)", color: "#e2e8f0", border: "none", borderRadius: "8px",
                              padding: "7px 16px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>{t.withdraw}</button>
                          )}
                          {canBuy && (
                            <button onClick={(e) => { e.stopPropagation(); makeBuyOffer(mObj); }} style={{
                              background: canBuyIndebted ? "rgba(245,158,11,0.9)" : "rgba(16,185,129,0.9)",
                              color: "#fff", border: "none", borderRadius: "8px",
                              padding: "7px 16px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>
                              {canBuyIndebted ? (offerAmt === 0 ? t.askDonation : `${t.offer} ${offerAmt}`) : `${t.buy} (${likeCount})`}
                            </button>
                          )}
                          {!isOwn && !isLiked && !isLocked && (
                            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", alignSelf: "center" }}>{t.tapToLike}</span>
                          )}
                          {isLiked && !canBuy && !isOwn && (
                            <span style={{ fontSize: "11px", color: "#f59e0b", alignSelf: "center" }}>{t.yourLike}</span>
                          )}
                          {isLocked && <span style={{ fontSize: "11px", color: "#f59e0b", alignSelf: "center" }}>🔒 {t.locked}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* PUBLISH TAB */}
        {tab === "publish" && (
          <div style={{ padding: "20px 16px", maxWidth: "500px", margin: "0 auto" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>{t.publishTitle}</h2>
            <div onClick={() => fileInputRef.current?.click()} style={{
              width: "100%", aspectRatio: "1/1", maxHeight: "300px", borderRadius: "12px", marginBottom: "12px", cursor: "pointer",
              border: "2px dashed rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "rgba(255,255,255,0.03)" }}>
              {pubPreview ? <img src={pubPreview} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> :
                <span style={{ color: "#64748b", fontSize: "14px" }}>{t.uploadPhoto}</span>}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageSelect} style={{ display: "none" }} />
            <input type="text" placeholder={t.productName} value={pubName} onChange={e => setPubName(e.target.value)} maxLength={50}
              style={{ width: "100%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "10px", padding: "12px", fontSize: "14px", color: "#e2e8f0", outline: "none", marginBottom: "10px" }} />
            <textarea placeholder={t.productDesc} value={pubDesc} onChange={e => setPubDesc(e.target.value.slice(0, 140))} rows={2}
              style={{ width: "100%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "10px", padding: "12px", fontSize: "14px", color: "#e2e8f0", outline: "none", marginBottom: "4px", resize: "none" }} />
            <div style={{ fontSize: "11px", color: "#64748b", textAlign: "right", marginBottom: "10px" }}>{pubDesc.length}/140</div>
            <select value={pubCategory} onChange={e => setPubCategory(e.target.value)}
              style={{ width: "100%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "10px", padding: "12px", fontSize: "14px", color: "#e2e8f0", outline: "none", marginBottom: "16px" }}>
              {cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={publishProduct} disabled={publishing || !pubName.trim() || !pubImage}
              style={{ width: "100%", background: "linear-gradient(135deg, #8b5cf6, #6d28d9)", color: "#fff", border: "none", borderRadius: "12px", padding: "14px", fontSize: "15px", fontWeight: 700, cursor: "pointer", opacity: publishing || !pubName.trim() || !pubImage ? 0.5 : 1 }}>
              {publishing ? t.publishing : t.publish}
            </button>
          </div>
        )}

        {/* WALLET TAB */}
        {tab === "wallet" && (
          <div style={{ padding: "20px 16px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>{t.walletTitle}</h2>
            <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: "12px", padding: "16px", marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                <span style={{ color: "#94a3b8" }}>{t.balance}</span>
                <span style={{ fontSize: "24px", fontWeight: 800, color: (me.likes || 0) >= 0 ? "#10b981" : "#ef4444" }}>{me.likes || 0} ❤️</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#94a3b8" }}>{t.likeStatus}</span>
                <span style={{ color: me.likedObjectId ? "#f59e0b" : "#64748b" }}>{me.likedObjectId ? t.likeAssigned : t.likeFree}</span>
              </div>
            </div>

            <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "10px" }}>{t.obtained}</h3>
            {(!me.obtained || me.obtained.length === 0) ? (
              <p style={{ color: "#64748b", fontSize: "13px" }}>{t.nothingObtained}</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: "8px" }}>
                {me.obtained.map((obj, i) => (
                  <div key={i} style={{ background: "rgba(255,255,255,0.03)", borderRadius: "10px", overflow: "hidden", border: "1px solid rgba(34,197,94,0.2)" }}>
                    <div style={{ aspectRatio: "1/1", overflow: "hidden" }}>
                      {obj.imageURL ? <img src={obj.imageURL} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> :
                        <div style={{ width: "100%", height: "100%", background: "rgba(34,197,94,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "#22c55e" }}>{obj.name}</div>}
                    </div>
                    <div style={{ padding: "6px" }}>
                      <div style={{ fontSize: "11px", fontWeight: 600, marginBottom: "4px" }}>{obj.name}</div>
                      <button onClick={() => reExhibit(i)} style={{
                        width: "100%", background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)",
                        borderRadius: "6px", padding: "4px", fontSize: "10px", color: "#8b5cf6", cursor: "pointer" }}>{t.reExhibit}</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* PROFILE TAB */}
        {tab === "profile" && (
          <div style={{ padding: "20px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
              {user.photo && <img src={user.photo} style={{ width: 48, height: 48, borderRadius: "50%" }} />}
              <div>
                <div style={{ fontSize: "16px", fontWeight: 700 }}>{user.name}</div>
                <div style={{ fontSize: "12px", color: "#64748b" }}>{user.email}</div>
              </div>
              <button onClick={onLogout} style={{ marginLeft: "auto", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px", padding: "6px 12px", fontSize: "12px", color: "#94a3b8", cursor: "pointer" }}>{t.logout}</button>
            </div>

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "20px" }}>
              {[
                [t.totalLikes, Object.values(players).reduce((s, p) => s + (p.likes || 0), 0), "#f59e0b"],
                [t.marketItems, marketItems.length, "#8b5cf6"],
                [t.playerCount, Object.keys(players).length, "#38bdf8"],
              ].map(([label, val, color]) => (
                <div key={label} style={{ background: "rgba(255,255,255,0.03)", borderRadius: "10px", padding: "12px", textAlign: "center" }}>
                  <div style={{ fontSize: "20px", fontWeight: 800, color }}>{val}</div>
                  <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "2px" }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Players */}
            <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>{t.players}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "20px" }}>
              {Object.entries(players).map(([p, d]) => (
                <div key={p} style={{ padding: "8px 10px", borderRadius: "8px", fontSize: "12px",
                  background: p === pid ? "rgba(56,189,248,0.08)" : "rgba(255,255,255,0.02)",
                  display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    {d.photo && <img src={d.photo} style={{ width: 20, height: 20, borderRadius: "50%" }} />}
                    {d.name}
                  </span>
                  <span style={{ color: (d.likes || 0) >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>{d.likes || 0} ❤️</span>
                </div>
              ))}
            </div>

            {/* Log */}
            <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>{t.activityLog}</h3>
            <div ref={logRef} style={{ maxHeight: "300px", overflow: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
              {logEntries.map((e, i) => (
                <div key={i} style={{ padding: "4px 8px", borderLeft: `2px solid ${logColors[e.type] || "#64748b"}`,
                  background: "rgba(255,255,255,0.02)", borderRadius: "0 4px 4px 0", fontSize: "11px", color: "#c8d6e5" }}>
                  {e.message}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM NAV */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, height: bottomH,
        background: "rgba(10,14,26,0.95)", borderTop: "1px solid rgba(255,255,255,0.08)",
        display: "flex", alignItems: "center", justifyContent: "space-around", zIndex: 40,
        backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
      }}>
        {[
          { id: "wallet", icon: "💰", label: t.tabWallet },
          { id: "market", icon: "🏪", label: t.tabMarket },
          { id: "publish", icon: "➕", label: t.tabPublish },
          { id: "profile", icon: "👤", label: t.tabProfile },
        ].map(item => (
          <button key={item.id} onClick={() => setTab(item.id)} style={{
            background: "none", border: "none", cursor: "pointer", padding: "4px 16px",
            display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
            color: tab === item.id ? "#38bdf8" : "#64748b", transition: "color 0.2s" }}>
            <span style={{ fontSize: "20px" }}>{item.icon}</span>
            <span style={{ fontSize: "10px", fontWeight: 600 }}>{item.label}</span>
          </button>
        ))}
      </div>

      {/* BUY OFFER MODAL */}
      {isMyOffer && buyOffer && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "16px" }}>
          <div style={{ background: "#1e293b", borderRadius: "16px", padding: "20px", maxWidth: "360px", width: "100%", border: "1px solid rgba(245,158,11,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <h3 style={{ fontSize: "16px", color: "#f59e0b" }}>🛒 {t.buyOffer}</h3>
              <span style={{ fontSize: "14px", fontWeight: 800, color: offerTimer <= 3 ? "#ef4444" : "#f59e0b" }}>⏱ {offerTimer}s</span>
            </div>
            <div style={{ height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 2, marginBottom: 14, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(offerTimer / 10) * 100}%`, background: offerTimer <= 3 ? "#ef4444" : "#f59e0b", transition: "width 1s linear" }} />
            </div>
            <p style={{ fontSize: "13px", color: "#cbd5e1", marginBottom: "14px", lineHeight: 1.5 }}>
              <strong>{players[buyOffer.buyerId]?.name}</strong> {t.wantsToBuy} <strong>"{buyOffer.name}"</strong>.
              {buyOffer.debtCancelled > 0 && <><br/>{t.debtOf} {buyOffer.debtCancelled}. </>}
              {t.youWouldReceive} <strong style={{ color: "#10b981" }}>{buyOffer.sellerReceives} ❤️</strong>.
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={acceptOffer} style={{ flex: 1, background: "#10b981", color: "#fff", border: "none", borderRadius: "10px", padding: "12px", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}>✅ {t.accept}</button>
              <button onClick={rejectOffer} style={{ flex: 1, background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "10px", padding: "12px", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}>❌ {t.reject}</button>
            </div>
          </div>
        </div>
      )}

      {/* WAITING */}
      {iMadeOffer && buyOffer && (
        <div style={{ position: "fixed", bottom: bottomH + 8, left: "50%", transform: "translateX(-50%)",
          background: "#1e293b", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "12px", padding: "10px 20px", zIndex: 50, display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: "#f59e0b", fontSize: "12px", fontWeight: 600 }}>{t.waitingResponse} ⏱ {offerTimer}s</span>
        </div>
      )}

      {/* SALE MODAL */}
      {saleModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "16px" }}>
          <div style={{ background: "#1e293b", borderRadius: "16px", padding: "20px", maxWidth: "360px", width: "100%", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <h3 style={{ fontSize: "16px" }}>💰 {t.sellTitle} "{saleModal.name}"</h3>
              <span style={{ fontSize: "14px", fontWeight: 800, color: saleTimer <= 3 ? "#ef4444" : "#f59e0b" }}>⏱ {saleTimer}s</span>
            </div>
            <div style={{ height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 2, marginBottom: 12, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(saleTimer / 10) * 100}%`, background: saleTimer <= 3 ? "#ef4444" : "#f59e0b", transition: "width 1s linear" }} />
            </div>
            <p style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "10px" }}>{t.value}: <strong style={{ color: "#f59e0b" }}>{saleModal.basePrice} ❤️</strong></p>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
              {saleModal.likers.map(([lp, ld]) => {
                const ind = (ld.likes || 0) < 0;
                const lD = ind ? Math.abs(ld.likes) : 0;
                const canA = ind ? saleModal.basePrice >= lD : true;
                const sr = ind ? saleModal.basePrice - lD : saleModal.basePrice;
                const dc = ind ? lD : 0;
                const blocked = ind && !canA;
                return (
                  <button key={lp} onClick={blocked ? undefined : () => executeSale(saleModal, lp, sr, dc)} disabled={blocked}
                    style={{ background: blocked ? "rgba(239,68,68,0.06)" : "rgba(255,255,255,0.04)",
                      border: blocked ? "1px solid rgba(239,68,68,0.15)" : "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "8px", padding: "10px", color: blocked ? "#64748b" : "#e2e8f0",
                      cursor: blocked ? "not-allowed" : "pointer", display: "flex", justifyContent: "space-between",
                      alignItems: "center", opacity: blocked ? 0.6 : 1 }}>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 600, textAlign: "left" }}>{ld.name}</div>
                      <div style={{ fontSize: "10px", color: "#94a3b8", textAlign: "left" }}>
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
            <button onClick={() => setSaleModal(null)} style={{ width: "100%", background: "transparent", color: "#64748b",
              border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "10px", fontSize: "12px", cursor: "pointer" }}>{t.cancel}</button>
          </div>
        </div>
      )}
    </div>
  );
}
