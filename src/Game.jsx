import { useState, useEffect, useRef } from "react";
import {
  db, ref, get, onValue, update, push,
  storage, storageRef, uploadBytes, getDownloadURL,
} from "./firebase.js";
import { translations, CATEGORIES, themes } from "./i18n.js";

function addLog(type, message) {
  push(ref(db, "game/log"), { type, message, time: Date.now() });
}

export default function Game({ user, onLogout, lang, setLang, theme, setTheme }) {
  const [game, setGame] = useState(null);
  const [tab, setTab] = useState("market");
  const [searchMode, setSearchMode] = useState("categories");
  const [searchText, setSearchText] = useState("");
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);
  const [searchModeOpen, setSearchModeOpen] = useState(false);
  const [pubName, setPubName] = useState("");
  const [pubDesc, setPubDesc] = useState("");
  const [pubCategory, setPubCategory] = useState("");
  const [pubCatOpen, setPubCatOpen] = useState(false);
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
  const th = themes[theme];
  const cats = CATEGORIES[lang];
  const toggleTheme = () => setTheme(prev => prev === "dark" ? "light" : "dark");

  useEffect(() => { if (!pubCategory) setPubCategory(cats[0]); }, [lang]);

  useEffect(() => {
    const unsub = onValue(ref(db, "game"), (snap) => {
      if (snap.exists()) setGame(snap.val());
      else setGame({ players: {}, market: {}, log: {}, buyOffer: null });
    });
    return () => unsub();
  }, []);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [game?.log]);

  useEffect(() => {
    if (game?.buyOffer) {
      setOfferTimer(10);
      offerTimerRef.current = setInterval(() => { setOfferTimer(p => { if (p <= 1) { clearInterval(offerTimerRef.current); return 0; } return p - 1; }); }, 1000);
      return () => clearInterval(offerTimerRef.current);
    } else { setOfferTimer(null); if (offerTimerRef.current) clearInterval(offerTimerRef.current); }
  }, [game?.buyOffer?.time]);
  useEffect(() => { if (offerTimer === 0 && game?.buyOffer) rejectOffer(); }, [offerTimer]);

  useEffect(() => {
    if (saleModal) {
      setSaleTimer(10);
      saleTimerRef.current = setInterval(() => { setSaleTimer(p => { if (p <= 1) { clearInterval(saleTimerRef.current); return 0; } return p - 1; }); }, 1000);
      return () => clearInterval(saleTimerRef.current);
    } else { setSaleTimer(null); if (saleTimerRef.current) clearInterval(saleTimerRef.current); }
  }, [saleModal]);
  useEffect(() => { if (saleTimer === 0 && saleModal) { addLog("system", `${t.timeUp}: "${saleModal.name}"`); setSaleModal(null); } }, [saleTimer]);

  if (!game || !game.players?.[pid]) {
    return <div style={{ minHeight: "100vh", background: th.bg, color: th.text, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>{t.loading}</div>;
  }

  const me = game.players[pid];
  const players = game.players;
  const market = game.market || {};
  const marketItems = Object.entries(market).map(([uid, obj]) => ({ ...obj, uid }));
  const buyOffer = game.buyOffer || null;
  const logEntries = game.log ? Object.values(game.log).sort((a, b) => a.time - b.time).slice(-50) : [];
  const getLikes = (uid) => Object.values(players).filter(p => p.likedObjectId === uid).length;

  const filteredItems = marketItems.filter(item => {
    if (searchMode === "categories") { if (selectedCategories.length === 0) return true; return selectedCategories.includes(item.category); }
    if (searchMode === "items") { if (!searchText.trim()) return true; return item.name.toLowerCase().includes(searchText.toLowerCase()) || (item.description || "").toLowerCase().includes(searchText.toLowerCase()); }
    if (searchMode === "users") { if (!searchText.trim()) return true; return (players[item.ownerId]?.name || "").toLowerCase().includes(searchText.toLowerCase()); }
    return true;
  });

  // ACTIONS
  const publishProduct = async () => {
    if (!pubName.trim() || !pubImage) return;
    setPublishing(true);
    try {
      const uid = `${pid}-${Date.now()}`;
      const imgRef = storageRef(storage, `products/${uid}`);
      await uploadBytes(imgRef, pubImage);
      const imageURL = await getDownloadURL(imgRef);
      await update(ref(db, `game/market/${uid}`), { name: pubName.trim(), description: pubDesc.trim(), category: pubCategory, imageURL, ownerId: pid, createdAt: Date.now() });
      addLog("exhibit", `📦 ${me.name}: "${pubName.trim()}"`);
      setPubName(""); setPubDesc(""); setPubCategory(cats[0]); setPubImage(null); setPubPreview(null); setTab("market");
    } catch (err) { console.error(err); }
    setPublishing(false);
  };

  const handleImageSelect = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas"); const max = 800;
        let w = img.width, h = img.height;
        if (w > h) { if (w > max) { h = h * max / w; w = max; } } else { if (h > max) { w = w * max / h; h = max; } }
        canvas.width = w; canvas.height = h; canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => { setPubImage(blob); setPubPreview(canvas.toDataURL()); }, "image/jpeg", 0.85);
      }; img.src = ev.target.result;
    }; reader.readAsDataURL(file);
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
    const obj = me.obtained[idx]; if (!obj) return;
    const uid = `${pid}-${Date.now()}`;
    await update(ref(db, `game/players/${pid}`), { obtained: me.obtained.filter((_, i) => i !== idx) });
    await update(ref(db, `game/market/${uid}`), { ...obj, ownerId: pid, createdAt: Date.now() });
    addLog("exhibit", `📦 ${me.name}: "${obj.name}"`);
  };

  const toggleLike = async (mObj) => {
    if (mObj.ownerId === pid || (buyOffer && buyOffer.uid === mObj.uid) || (saleModal && saleModal.uid === mObj.uid)) return;
    if (me.likedObjectId === mObj.uid) { await update(ref(db, `game/players/${pid}`), { likedObjectId: null }); addLog("unlike", `👎 ${me.name} ✕ "${mObj.name}"`); }
    else { await update(ref(db, `game/players/${pid}`), { likedObjectId: mObj.uid }); addLog("like", `👍 ${me.name} → "${mObj.name}"`); }
  };

  const openSellModal = (mObj) => {
    if (buyOffer && buyOffer.uid === mObj.uid) return;
    const likers = Object.entries(players).filter(([p, d]) => d.likedObjectId === mObj.uid && p !== mObj.ownerId);
    if (likers.length === 0) { addLog("system", `❌ "${mObj.name}" - ${t.noLikesYet}`); return; }
    setSaleModal({ ...mObj, likers, basePrice: getLikes(mObj.uid) });
  };

  const executeSale = async (mObj, buyerPid, sellerReceives, debtCancelled) => {
    const buyer = players[buyerPid]; const seller = players[mObj.ownerId];
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
    updates[`market/${mObj.uid}`] = null; updates[`buyOffer`] = null;
    await update(ref(db, "game"), updates);
    addLog("sell", `💰 ${seller.name} → ${buyer.name}: "${mObj.name}" (${sr} ${t.likes})`);
    if (buyerNew < 0 && dc === 0) addLog("credit", `🔴 ${buyer.name}: ${buyerNew} ${t.likes}`);
    setSaleModal(null);
  };

  const makeBuyOffer = async (mObj) => {
    const likeCount = getLikes(mObj.uid); if (likeCount === 0) return;
    const debt = Math.abs(Math.min(0, me.likes || 0));
    let sr, dc;
    if ((me.likes || 0) >= 0) { if ((me.likes || 0) < likeCount) return; sr = likeCount; dc = 0; }
    else { if (likeCount < debt) return; sr = likeCount - debt; dc = debt; }
    await update(ref(db, "game/buyOffer"), { uid: mObj.uid, name: mObj.name, imageURL: mObj.imageURL || "", ownerId: mObj.ownerId, buyerId: pid, price: likeCount, sellerReceives: sr, debtCancelled: dc, time: Date.now() });
    addLog("system", `🛒 ${me.name} → "${mObj.name}" (${sr} ${t.likes})`);
  };

  const acceptOffer = async () => {
    if (!buyOffer) return;
    await executeSale({ uid: buyOffer.uid, name: buyOffer.name, ownerId: buyOffer.ownerId, imageURL: buyOffer.imageURL, description: market[buyOffer.uid]?.description || "", category: market[buyOffer.uid]?.category || "" }, buyOffer.buyerId, buyOffer.sellerReceives, buyOffer.debtCancelled);
  };
  const rejectOffer = async () => { if (!buyOffer) return; await update(ref(db, "game"), { buyOffer: null }); addLog("system", `❌ "${buyOffer.name}"`); };

  const isMyOffer = buyOffer && buyOffer.ownerId === pid;
  const iMadeOffer = buyOffer && buyOffer.buyerId === pid;
  const logColors = { sell: "#10b981", like: "#f59e0b", unlike: "#94a3b8", exhibit: "#8b5cf6", credit: "#ef4444", system: "#64748b" };
  const bottomH = 56;

  const inputStyle = { background: th.bgInput, border: `1px solid ${th.borderColor}`, borderRadius: "10px", padding: "12px", fontSize: "14px", color: th.text, width: "100%", outline: "none" };

  // Custom dropdown component
  const CustomDropdown = ({ value, options, onSelect, open, setOpen, placeholder }) => (
    <div style={{ position: "relative", flex: 1 }}>
      <div onClick={() => setOpen(!open)} style={{ background: th.bgInput, border: `1px solid ${th.borderColor}`, borderRadius: "8px", padding: "7px 10px", fontSize: "12px", color: value ? th.text : th.textMuted, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {value || placeholder}
      </div>
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: th.dropdown, border: `1px solid ${th.dropdownBorder}`, borderRadius: "8px", marginTop: "4px", zIndex: 50, maxHeight: "240px", overflow: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
          {options.map(opt => (
            <div key={opt} onClick={() => { onSelect(opt); setOpen(false); }} style={{ padding: "8px 12px", fontSize: "12px", cursor: "pointer", color: th.text, background: value === opt ? th.bgHover : "transparent" }}>
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const closeAllDropdowns = () => { setCatDropdownOpen(false); setSearchModeOpen(false); setPubCatOpen(false); };

  const searchModeLabels = { categories: t.searchCategories, items: t.searchItems, users: t.searchUsers };
  const toggleCategory = (cat) => { setSelectedCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]); };

  return (
    <div style={{ minHeight: "100vh", background: th.bg, fontFamily: "'Segoe UI', system-ui, sans-serif", color: th.text, display: "flex", flexDirection: "column" }} onClick={closeAllDropdowns}>

      {/* HEADER */}
      <div style={{ height: 48, padding: "0 12px", display: "flex", alignItems: "center", justifyContent: "space-between", background: th.bgSecondary, borderBottom: `1px solid ${th.borderLight}`, flexShrink: 0 }}>
        <span style={{ fontSize: "20px" }}>🏠</span>
        <div style={{ display: "flex", gap: "3px", alignItems: "center" }}>
          <button onClick={(e) => { e.stopPropagation(); toggleTheme(); }} style={{ background: th.bgInput, border: `1px solid ${th.borderColor}`, borderRadius: "4px", padding: "3px 7px", fontSize: "13px", cursor: "pointer", color: th.text, lineHeight: 1 }}>{theme === "dark" ? "☀️" : "🌙"}</button>
          {["es", "it", "en"].map(l => (
            <button key={l} onClick={() => setLang(l)} style={{ background: lang === l ? th.bgHover : "transparent", border: "none", borderRadius: "4px", padding: "3px 8px", fontSize: "11px", fontWeight: 600, color: lang === l ? th.text : th.textMuted, cursor: "pointer", textTransform: "uppercase" }}>{l}</button>
          ))}
        </div>
      </div>

      {/* SEARCH BAR */}
      {tab === "market" && (
        <div style={{ borderBottom: `1px solid ${th.borderLight}`, background: th.bgSecondary, flexShrink: 0 }}>
          <div style={{ maxWidth: "600px", margin: "0 auto", height: 44, padding: "6px 12px", display: "flex", alignItems: "center", gap: "6px" }}>
            {/* Search mode selector - custom dropdown */}
            <div style={{ position: "relative", minWidth: "100px" }} onClick={e => e.stopPropagation()}>
              <div onClick={() => setSearchModeOpen(!searchModeOpen)} style={{ background: th.bgInput, border: `1px solid ${th.borderColor}`, borderRadius: "8px", padding: "7px 10px", fontSize: "12px", color: th.text, cursor: "pointer" }}>
                {searchModeLabels[searchMode]}
              </div>
              {searchModeOpen && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: th.dropdown, border: `1px solid ${th.dropdownBorder}`, borderRadius: "8px", marginTop: "4px", zIndex: 50, boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
                  {["categories", "items", "users"].map(mode => (
                    <div key={mode} onClick={() => { setSearchMode(mode); setSearchText(""); setSelectedCategories([]); setSearchModeOpen(false); }}
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
                <div onClick={() => setCatDropdownOpen(!catDropdownOpen)} style={{ background: th.bgInput, border: `1px solid ${th.borderColor}`, borderRadius: "8px", padding: "7px 10px", fontSize: "12px", color: selectedCategories.length ? th.text : th.textMuted, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {selectedCategories.length === 0 ? t.allCategories : selectedCategories.join(", ")}
                </div>
                {catDropdownOpen && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: th.dropdown, border: `1px solid ${th.dropdownBorder}`, borderRadius: "8px", marginTop: "4px", zIndex: 50, maxHeight: "280px", overflow: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
                    <div onClick={() => { setSelectedCategories([]); setCatDropdownOpen(false); }} style={{ padding: "10px 12px", fontSize: "12px", cursor: "pointer", color: selectedCategories.length === 0 ? "#38bdf8" : th.text, background: selectedCategories.length === 0 ? th.bgHover : "transparent", fontWeight: 600 }}>
                      {t.allCategories}
                    </div>
                    {cats.map(cat => (
                      <div key={cat} onClick={() => toggleCategory(cat)} style={{ padding: "10px 12px", fontSize: "12px", cursor: "pointer", color: th.text, background: selectedCategories.includes(cat) ? th.bgHover : "transparent", display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ width: 16, height: 16, borderRadius: "4px", border: `1.5px solid ${th.borderColor}`, background: selectedCategories.includes(cat) ? "#38bdf8" : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "10px", color: "#fff" }}>
                          {selectedCategories.includes(cat) && "✓"}
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
      <div style={{ flex: 1, overflow: "auto", paddingBottom: bottomH + 8 }}>

        {/* MARKET */}
        {tab === "market" && (
          <div style={{ maxWidth: "600px", margin: "0 auto" }}>
            {filteredItems.length === 0 ? (
              <p style={{ textAlign: "center", color: th.textMuted, padding: "60px 20px", fontSize: "14px" }}>{marketItems.length === 0 ? t.emptyMarket : t.noResults}</p>
            ) : filteredItems.map(mObj => {
              const likeCount = getLikes(mObj.uid);
              const isLiked = me.likedObjectId === mObj.uid;
              const isOwn = mObj.ownerId === pid;
              const isLocked = buyOffer && buyOffer.uid === mObj.uid;
              const debt = (me.likes || 0) < 0 ? Math.abs(me.likes) : 0;
              const canBuy = isLiked && !isOwn && !isLocked && likeCount > 0 && ((me.likes || 0) >= 0 ? (me.likes || 0) >= likeCount : likeCount >= debt);
              const canBuyIndebted = canBuy && (me.likes || 0) < 0;
              const offerAmt = canBuyIndebted ? likeCount - debt : likeCount;
              const ownerData = players[mObj.ownerId];
              const hasLikers = Object.values(players).some(p => p.likedObjectId === mObj.uid && mObj.ownerId !== pid);

              return (
                <div key={mObj.uid} style={{ marginBottom: "24px", borderBottom: `1px solid ${th.borderLight}`, paddingBottom: "16px" }}>
                  {/* Owner bar */}
                  <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: "8px" }}>
                    {ownerData?.photo ? <img src={ownerData.photo} style={{ width: 32, height: 32, borderRadius: "50%" }} /> :
                      <div style={{ width: 32, height: 32, borderRadius: "50%", background: th.bgCard, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", color: th.textSecondary }}>{(ownerData?.name || "?")[0]}</div>}
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 600 }}>{ownerData?.name}</div>
                      <div style={{ fontSize: "11px", color: th.textMuted }}>{mObj.category}</div>
                    </div>
                    {isLocked && <span style={{ marginLeft: "auto", background: "#f59e0b", color: "#000", fontSize: "9px", fontWeight: 800, padding: "2px 8px", borderRadius: "4px" }}>{t.offerLabel}</span>}
                  </div>

                  {/* Image */}
                  <div onClick={() => { if (!isLocked && !isOwn) toggleLike(mObj); }}
                    style={{ width: "100%", aspectRatio: "1/1", cursor: isOwn || isLocked ? "default" : "pointer", overflow: "hidden", background: th.imageBg }}>
                    {mObj.imageURL ? <img src={mObj.imageURL} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> :
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: th.textMuted, fontSize: "18px" }}>{mObj.name}</div>}
                  </div>

                  {/* Actions below image */}
                  <div style={{ padding: "10px 14px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
                      <span onClick={() => { if (!isLocked && !isOwn) toggleLike(mObj); }} style={{ fontSize: "24px", cursor: isOwn || isLocked ? "default" : "pointer" }}>{isLiked ? "❤️" : "🤍"}</span>
                      <span style={{ fontSize: "14px", fontWeight: 700 }}>{likeCount} {t.likes}</span>
                      {isLocked && <span style={{ fontSize: "11px", color: "#f59e0b", marginLeft: "auto" }}>🔒 {t.locked}</span>}
                    </div>
                    <div style={{ marginBottom: "8px" }}>
                      <span style={{ fontSize: "14px", fontWeight: 700 }}>{mObj.name}</span>
                      {mObj.description && <span style={{ fontSize: "13px", color: th.textSecondary, marginLeft: "8px" }}>{mObj.description}</span>}
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {isOwn && !isLocked && (
                        <>
                          <button onClick={() => openSellModal(mObj)} style={{ background: hasLikers ? "#10b981" : th.bgInput, color: hasLikers ? "#fff" : th.textMuted, border: "none", borderRadius: "8px", padding: "8px 20px", fontSize: "13px", fontWeight: 700, cursor: hasLikers ? "pointer" : "default", opacity: hasLikers ? 1 : 0.5 }}>
                            {t.sell} {hasLikers ? `(${likeCount} ❤️)` : ""}
                          </button>
                          <button onClick={() => withdrawObject(mObj)} style={{ background: th.bgInput, color: th.textSecondary, border: "none", borderRadius: "8px", padding: "8px 20px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>{t.withdraw}</button>
                        </>
                      )}
                      {canBuy && (
                        <button onClick={() => makeBuyOffer(mObj)} style={{ background: canBuyIndebted ? "#f59e0b" : "#10b981", color: "#fff", border: "none", borderRadius: "8px", padding: "8px 20px", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
                          {canBuyIndebted ? (offerAmt === 0 ? t.askDonation : `${t.offer} ${offerAmt} ❤️`) : `${t.buy} (${likeCount} ❤️)`}
                        </button>
                      )}
                      {!isOwn && !isLiked && !isLocked && <span style={{ fontSize: "12px", color: th.textMuted, alignSelf: "center" }}>{t.tapToLike}</span>}
                      {isLiked && !canBuy && !isOwn && <span style={{ fontSize: "12px", color: "#f59e0b", alignSelf: "center" }}>{t.yourLike}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* PUBLISH */}
        {tab === "publish" && (
          <div style={{ padding: "20px 16px", maxWidth: "600px", margin: "0 auto" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>{t.publishTitle}</h2>
            <div onClick={() => fileInputRef.current?.click()} style={{ width: "100%", aspectRatio: "1/1", maxHeight: "340px", borderRadius: "12px", marginBottom: "12px", cursor: "pointer", border: `2px dashed ${th.borderColor}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: th.bgCard }}>
              {pubPreview ? <img src={pubPreview} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ color: th.textMuted, fontSize: "14px" }}>{t.uploadPhoto}</span>}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageSelect} style={{ display: "none" }} />
            <input type="text" placeholder={t.productName} value={pubName} onChange={e => setPubName(e.target.value)} maxLength={50} style={{ ...inputStyle, marginBottom: "10px" }} />
            <textarea placeholder={t.productDesc} value={pubDesc} onChange={e => setPubDesc(e.target.value.slice(0, 140))} rows={2} style={{ ...inputStyle, marginBottom: "4px", resize: "none" }} />
            <div style={{ fontSize: "11px", color: th.textMuted, textAlign: "right", marginBottom: "10px" }}>{pubDesc.length}/140</div>
            {/* Custom category dropdown */}
            <div style={{ position: "relative", marginBottom: "16px" }} onClick={e => e.stopPropagation()}>
              <div onClick={() => setPubCatOpen(!pubCatOpen)} style={{ ...inputStyle, cursor: "pointer", color: pubCategory ? th.text : th.textMuted }}>
                {pubCategory || t.selectCategory}
              </div>
              {pubCatOpen && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: th.dropdown, border: `1px solid ${th.dropdownBorder}`, borderRadius: "10px", marginTop: "4px", zIndex: 50, maxHeight: "240px", overflow: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
                  {cats.map(c => (
                    <div key={c} onClick={() => { setPubCategory(c); setPubCatOpen(false); }} style={{ padding: "10px 14px", fontSize: "13px", cursor: "pointer", color: th.text, background: pubCategory === c ? th.bgHover : "transparent" }}>{c}</div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={publishProduct} disabled={publishing || !pubName.trim() || !pubImage}
              style={{ width: "100%", background: "linear-gradient(135deg, #8b5cf6, #6d28d9)", color: "#fff", border: "none", borderRadius: "12px", padding: "14px", fontSize: "15px", fontWeight: 700, cursor: "pointer", opacity: publishing || !pubName.trim() || !pubImage ? 0.5 : 1 }}>
              {publishing ? t.publishing : t.publish}
            </button>
          </div>
        )}

        {/* WALLET */}
        {tab === "wallet" && (
          <div style={{ padding: "20px 16px", maxWidth: "600px", margin: "0 auto" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>{t.walletTitle}</h2>
            <div style={{ background: th.bgCard, borderRadius: "12px", padding: "16px", marginBottom: "16px", border: `1px solid ${th.borderLight}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                <span style={{ color: th.textSecondary }}>{t.balance}</span>
                <span style={{ fontSize: "24px", fontWeight: 800, color: (me.likes || 0) >= 0 ? "#10b981" : "#ef4444" }}>{me.likes || 0} ❤️</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: th.textSecondary }}>{t.likeStatus}</span>
                <span style={{ color: me.likedObjectId ? "#f59e0b" : th.textMuted }}>{me.likedObjectId ? t.likeAssigned : t.likeFree}</span>
              </div>
            </div>
            <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "10px" }}>{t.obtained}</h3>
            {(!me.obtained || me.obtained.length === 0) ? <p style={{ color: th.textMuted, fontSize: "13px" }}>{t.nothingObtained}</p> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: "8px" }}>
                {me.obtained.map((obj, i) => (
                  <div key={i} style={{ background: th.bgCard, borderRadius: "10px", overflow: "hidden", border: `1px solid ${th.borderLight}` }}>
                    <div style={{ aspectRatio: "1/1", overflow: "hidden" }}>
                      {obj.imageURL ? <img src={obj.imageURL} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> :
                        <div style={{ width: "100%", height: "100%", background: th.bgCard, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: th.textMuted }}>{obj.name}</div>}
                    </div>
                    <div style={{ padding: "6px" }}>
                      <div style={{ fontSize: "11px", fontWeight: 600, marginBottom: "4px" }}>{obj.name}</div>
                      <button onClick={() => reExhibit(i)} style={{ width: "100%", background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)", borderRadius: "6px", padding: "4px", fontSize: "10px", color: "#8b5cf6", cursor: "pointer" }}>{t.reExhibit}</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* PROFILE */}
        {tab === "profile" && (
          <div style={{ padding: "20px 16px", maxWidth: "600px", margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
              {user.photo && <img src={user.photo} style={{ width: 48, height: 48, borderRadius: "50%" }} />}
              <div>
                <div style={{ fontSize: "16px", fontWeight: 700 }}>{user.name}</div>
                <div style={{ fontSize: "12px", color: th.textMuted }}>{user.email}</div>
              </div>
              <button onClick={onLogout} style={{ marginLeft: "auto", background: th.bgCard, border: `1px solid ${th.borderColor}`, borderRadius: "8px", padding: "6px 12px", fontSize: "12px", color: th.textSecondary, cursor: "pointer" }}>{t.logout}</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "20px" }}>
              {[[t.totalLikes, Object.values(players).reduce((s, p) => s + (p.likes || 0), 0), "#f59e0b"], [t.marketItems, marketItems.length, "#8b5cf6"], [t.playerCount, Object.keys(players).length, "#38bdf8"]].map(([label, val, color]) => (
                <div key={label} style={{ background: th.bgCard, borderRadius: "10px", padding: "12px", textAlign: "center", border: `1px solid ${th.borderLight}` }}>
                  <div style={{ fontSize: "20px", fontWeight: 800, color }}>{val}</div>
                  <div style={{ fontSize: "10px", color: th.textSecondary, marginTop: "2px" }}>{label}</div>
                </div>
              ))}
            </div>
            <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>{t.players}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "20px" }}>
              {Object.entries(players).map(([p, d]) => (
                <div key={p} style={{ padding: "8px 10px", borderRadius: "8px", fontSize: "12px", background: p === pid ? th.bgHover : th.bgCard, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    {d.photo && <img src={d.photo} style={{ width: 20, height: 20, borderRadius: "50%" }} />}
                    {d.name}
                  </span>
                  <span style={{ color: (d.likes || 0) >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>{d.likes || 0} ❤️</span>
                </div>
              ))}
            </div>
            <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>{t.activityLog}</h3>
            <div ref={logRef} style={{ maxHeight: "300px", overflow: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
              {logEntries.map((e, i) => (
                <div key={i} style={{ padding: "4px 8px", borderLeft: `2px solid ${logColors[e.type] || th.textMuted}`, background: th.bgCard, borderRadius: "0 4px 4px 0", fontSize: "11px", color: th.textSecondary }}>{e.message}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM NAV */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: bottomH, background: th.navBg, borderTop: `1px solid ${th.borderLight}`, display: "flex", alignItems: "center", justifyContent: "space-around", zIndex: 40, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
        {[{ id: "wallet", icon: "💰", label: t.tabWallet }, { id: "market", icon: "🏪", label: t.tabMarket }, { id: "publish", icon: "➕", label: t.tabPublish }, { id: "profile", icon: "👤", label: t.tabProfile }].map(item => (
          <button key={item.id} onClick={() => setTab(item.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", color: tab === item.id ? "#38bdf8" : th.textMuted, transition: "color 0.2s" }}>
            <span style={{ fontSize: "20px" }}>{item.icon}</span>
            <span style={{ fontSize: "10px", fontWeight: 600 }}>{item.label}</span>
          </button>
        ))}
      </div>

      {/* BUY OFFER MODAL */}
      {isMyOffer && buyOffer && (
        <div style={{ position: "fixed", inset: 0, background: th.overlayBg, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "16px" }}>
          <div style={{ background: th.modalBg, borderRadius: "16px", padding: "20px", maxWidth: "360px", width: "100%", border: `1px solid ${th.borderColor}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <h3 style={{ fontSize: "16px", color: "#f59e0b" }}>🛒 {t.buyOffer}</h3>
              <span style={{ fontSize: "14px", fontWeight: 800, color: offerTimer <= 3 ? "#ef4444" : "#f59e0b" }}>⏱ {offerTimer}s</span>
            </div>
            <div style={{ height: 3, background: th.bgInput, borderRadius: 2, marginBottom: 14, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(offerTimer / 10) * 100}%`, background: offerTimer <= 3 ? "#ef4444" : "#f59e0b", transition: "width 1s linear" }} />
            </div>
            <p style={{ fontSize: "13px", color: th.textSecondary, marginBottom: "14px", lineHeight: 1.5 }}>
              <strong style={{ color: th.text }}>{players[buyOffer.buyerId]?.name}</strong> {t.wantsToBuy} <strong style={{ color: th.text }}>"{buyOffer.name}"</strong>.
              {buyOffer.debtCancelled > 0 && <> {t.debtOf} {buyOffer.debtCancelled}. </>}
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
        <div style={{ position: "fixed", bottom: bottomH + 8, left: "50%", transform: "translateX(-50%)", background: th.modalBg, border: `1px solid ${th.borderColor}`, borderRadius: "12px", padding: "10px 20px", zIndex: 50, display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: "#f59e0b", fontSize: "12px", fontWeight: 600 }}>{t.waitingResponse} ⏱ {offerTimer}s</span>
        </div>
      )}

      {/* SALE MODAL */}
      {saleModal && (
        <div style={{ position: "fixed", inset: 0, background: th.overlayBg, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "16px" }}>
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
                  <button key={lp} onClick={blocked ? undefined : () => executeSale(saleModal, lp, sr, dc)} disabled={blocked}
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
    </div>
  );
}
