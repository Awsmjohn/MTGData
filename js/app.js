import { Storage } from "./storage.js";
import { Scryfall } from "./scryfall.js";
import { Assistant } from "./assistant.js";

const drawerBody = document.getElementById("drawer-body");
const modalRoot = document.getElementById("modal-root");
const printArea = document.getElementById("print-area");

let state = {
  tab: "collection",
  collectionFilter: { text: "", color: "", tag: "", boxed: "" },
  currentDeckId: null,
  storageBox: null,
};

// ---------------- helpers ----------------
function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function colorDots(colors = []) {
  if (!colors.length) return `<span class="color-dot C"></span>`;
  return colors.map((c) => `<span class="color-dot ${esc(c)}"></span>`).join("");
}

function download(filename, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function openModal(innerHtml, onMount) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal">${innerHtml}</div></div>`;
  modalRoot.querySelector(".modal-backdrop").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop")) closeModal();
  });
  if (onMount) onMount(modalRoot);
}
function closeModal() {
  modalRoot.innerHTML = "";
}

// ---------------- tabs ----------------
document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".drawer-tab");
  if (!btn) return;
  state.tab = btn.dataset.tab;
  state.currentDeckId = null;
  render();
});

function render() {
  document.querySelectorAll(".drawer-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  if (state.tab === "collection") renderCollection();
  else if (state.tab === "decks") renderDecks();
  else if (state.tab === "assistant") renderAssistant();
  else if (state.tab === "storage") renderStorage();
  else if (state.tab === "io") renderIO();
}

// ================= COLLECTION =================
function renderCollection() {
  const all = Storage.allCards();
  const f = state.collectionFilter;
  const filtered = all.filter((c) => {
    if (f.text && !c.name.toLowerCase().includes(f.text.toLowerCase())) return false;
    if (f.color) {
      if (f.color === "C" && (c.colors || []).length !== 0) return false;
      if (f.color !== "C" && !(c.colors || []).includes(f.color)) return false;
    }
    if (f.tag && !Storage.allTagsFor(c).some((t) => t.toLowerCase() === f.tag.toLowerCase())) return false;
    if (f.boxed === "filed" && !c.locationCode) return false;
    if (f.boxed === "unfiled" && c.locationCode) return false;
    return true;
  });

  drawerBody.innerHTML = `
    <div class="toolbar">
      <div class="field"><input id="col-search" placeholder="Search by name…" value="${esc(f.text)}"/></div>
      <div class="field">
        <select id="col-color">
          <option value="">Any color</option>
          <option value="W">White</option><option value="U">Blue</option><option value="B">Black</option>
          <option value="R">Red</option><option value="G">Green</option><option value="C">Colorless</option>
        </select>
      </div>
      <div class="field"><input id="col-tag" placeholder="Filter by tag…" value="${esc(f.tag)}"/></div>
      <div class="field">
        <select id="col-boxed">
          <option value="">Filed + unfiled</option>
          <option value="filed">Filed only</option>
          <option value="unfiled">Unfiled only</option>
        </select>
      </div>
      <div class="spacer"></div>
      <button class="primary" id="add-card-btn">+ Add card</button>
    </div>
    ${
      filtered.length === 0
        ? `<div class="empty-state"><h3>No cards here yet</h3><p class="hint">Add a card by name — Codex pulls the details from Scryfall automatically.</p></div>`
        : `<div class="card-grid">${filtered.map(cardTile).join("")}</div>`
    }
  `;

  document.getElementById("col-search").value = f.text;
  document.getElementById("col-color").value = f.color;
  document.getElementById("col-boxed").value = f.boxed;

  document.getElementById("col-search").addEventListener("input", (e) => { f.text = e.target.value; renderCollection(); });
  document.getElementById("col-color").addEventListener("change", (e) => { f.color = e.target.value; renderCollection(); });
  document.getElementById("col-tag").addEventListener("input", (e) => { f.tag = e.target.value; renderCollection(); });
  document.getElementById("col-boxed").addEventListener("change", (e) => { f.boxed = e.target.value; renderCollection(); });
  document.getElementById("add-card-btn").addEventListener("click", () => openAddCardModal());

  drawerBody.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openAddCardModal(Storage.findCard(btn.dataset.edit)))
  );
  drawerBody.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (confirm("Remove this card from your Codex?")) {
        Storage.deleteCard(btn.dataset.delete);
        renderCollection();
      }
    })
  );
  drawerBody.querySelectorAll("[data-file]").forEach((btn) =>
    btn.addEventListener("click", () => openFileCardModal(btn.dataset.file))
  );
  drawerBody.querySelectorAll("[data-refresh]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const card = Storage.findCard(btn.dataset.refresh);
      if (!card) return;
      btn.textContent = "…";
      btn.disabled = true;
      try {
        const fresh = await Scryfall.getByExactName(card.name);
        Storage.updateCard(card.id, fresh);
      } catch (e) {
        alert("Couldn't reach Scryfall for that card right now.");
      }
      renderCollection();
    })
  );
}

function cardTile(c) {
  return `
    <div class="index-card">
      ${c.imageUrl ? `<img class="thumb" src="${esc(c.imageUrl)}" alt="${esc(c.name)}" loading="lazy"/>` : `<div class="thumb"></div>`}
      <h4>${esc(c.name)}</h4>
      <div class="meta">${colorDots(c.colors)} ${esc(c.typeLine || "")} · Qty ${c.quantity}</div>
      <div>
        ${(c.tags || []).map((t) => `<span class="tag-chip">${esc(t)}</span>`).join(" ")}
        ${(c.autoTags || []).map((t) => `<span class="tag-chip auto" title="From Scryfall">${esc(t)}</span>`).join(" ")}
      </div>
      <span class="code-chip ${c.locationCode ? "" : "unfiled"}">${c.locationCode ? esc(c.locationCode) : "unfiled"}</span>
      <div class="actions">
        <button data-file="${c.id}">${c.locationCode ? "Refile" : "File"}</button>
        <button data-refresh="${c.id}" title="Re-fetch image/text/tags from Scryfall">Refresh</button>
        <button data-edit="${c.id}">Edit</button>
        <button class="danger" data-delete="${c.id}">Delete</button>
      </div>
    </div>
  `;
}

function openAddCardModal(existing) {
  const isEdit = !!existing;
  openModal(
    `
    <h3>${isEdit ? "Edit card" : "Add a card"}</h3>
    <div class="field autocomplete-wrap">
      <label>Card name</label>
      <input id="card-name" autocomplete="off" value="${isEdit ? esc(existing.name) : ""}" placeholder="Start typing… e.g. Sol Ring" />
      <div class="autocomplete-list" id="ac-list" style="display:none;"></div>
    </div>
    <div class="row">
      <div class="field"><label>Quantity owned</label><input id="card-qty" type="number" min="1" value="${isEdit ? existing.quantity : 1}"/></div>
      <div class="field"><label>Tags (comma-separated)</label><input id="card-tags" value="${isEdit ? esc((existing.tags||[]).join(', ')) : ''}" placeholder="removal, elves"/></div>
    </div>
    <p class="hint" id="preview-hint">${isEdit ? "Editing keeps the existing card data unless you pick a new name from the list." : "Pick a suggestion from the dropdown to pull in card data automatically."}</p>
    <div class="modal-close-row">
      <button id="cancel-btn">Cancel</button>
      <button class="primary" id="save-card-btn">${isEdit ? "Save changes" : "Add to Codex"}</button>
    </div>
  `,
    (root) => {
      let pendingScryfallData = null;
      const nameInput = root.querySelector("#card-name");
      const acList = root.querySelector("#ac-list");
      let debounceTimer;

      nameInput.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        const q = nameInput.value;
        debounceTimer = setTimeout(async () => {
          const names = await Scryfall.autocomplete(q);
          if (!names.length) { acList.style.display = "none"; return; }
          acList.innerHTML = names.map((n) => `<div data-name="${esc(n)}">${esc(n)}</div>`).join("");
          acList.style.display = "block";
          acList.querySelectorAll("div").forEach((row) =>
            row.addEventListener("click", async () => {
              nameInput.value = row.dataset.name;
              acList.style.display = "none";
              root.querySelector("#preview-hint").textContent = "Loading card data…";
              try {
                pendingScryfallData = await Scryfall.getByExactName(row.dataset.name);
                root.querySelector("#preview-hint").textContent = `Loaded: ${pendingScryfallData.typeLine} — ${pendingScryfallData.manaCost || "no cost"}`;
              } catch (err) {
                root.querySelector("#preview-hint").textContent = "Couldn't fetch that card — it will be saved with just the name.";
              }
            })
          );
        }, 250);
      });

      root.querySelector("#cancel-btn").addEventListener("click", closeModal);
      root.querySelector("#save-card-btn").addEventListener("click", async () => {
        const name = nameInput.value.trim();
        if (!name) return;
        const qty = Math.max(1, parseInt(root.querySelector("#card-qty").value, 10) || 1);
        const tags = root.querySelector("#card-tags").value.split(",").map((t) => t.trim()).filter(Boolean);

        if (isEdit) {
          Storage.updateCard(existing.id, { ...(pendingScryfallData || {}), name, quantity: qty, tags });
        } else {
          let data = pendingScryfallData;
          if (!data) {
            try { data = await Scryfall.getByFuzzyName(name); } catch (e) { data = { name }; }
          }
          Storage.addCard({ ...data, name: data.name || name, quantity: qty, tags });
        }
        closeModal();
        renderCollection();
      });
    }
  );
}

function openFileCardModal(cardId) {
  const card = Storage.findCard(cardId);
  const settings = Storage.getSettings();
  const cls = Storage.classFor(card);
  openModal(
    `
    <h3>File "${esc(card.name)}"</h3>
    <p class="hint">Class <b>${cls.code}</b> — ${esc(cls.label)}. Choose which physical box this card lives in; Codex assigns the next sequence number in that box automatically.</p>
    <div class="field">
      <label>Box number (1–${settings.numberOfBoxes})</label>
      <input id="box-num" type="number" min="1" max="${settings.numberOfBoxes}" value="${card.box || 1}"/>
    </div>
    ${card.locationCode ? `<p class="hint">Currently filed at <b>${esc(card.locationCode)}</b>.</p>` : ""}
    <div class="modal-close-row">
      ${card.locationCode ? `<button class="danger" id="unfile-btn">Remove from storage</button>` : ""}
      <button id="cancel-btn">Cancel</button>
      <button class="primary" id="file-btn">File it</button>
    </div>
  `,
    (root) => {
      root.querySelector("#cancel-btn").addEventListener("click", closeModal);
      const unfileBtn = root.querySelector("#unfile-btn");
      if (unfileBtn) unfileBtn.addEventListener("click", () => { Storage.clearLocation(cardId); closeModal(); renderCollection(); });
      root.querySelector("#file-btn").addEventListener("click", () => {
        const box = parseInt(root.querySelector("#box-num").value, 10) || 1;
        Storage.assignLocation(cardId, box);
        closeModal();
        renderCollection();
      });
    }
  );
}

// ================= DECKS =================
function renderDecks() {
  if (state.currentDeckId) return renderDeckDetail(state.currentDeckId);
  const decks = Storage.allDecks();
  drawerBody.innerHTML = `
    <div class="toolbar"><h3 style="margin:0">Your decks</h3><div class="spacer"></div><button class="primary" id="new-deck-btn">+ New deck</button></div>
    ${
      decks.length === 0
        ? `<div class="empty-state"><h3>No decks yet</h3><p class="hint">Create a deck, then add cards from your Collection.</p></div>`
        : `<div class="deck-list">${decks.map((d) => `
            <div class="deck-summary" data-deck="${d.id}">
              <h4>${esc(d.name)}</h4>
              <div class="fmt">${esc(d.format || "Unspecified format")} · ${d.cards.reduce((s, c) => s + c.quantity, 0)} cards</div>
            </div>`).join("")}</div>`
    }
  `;
  document.getElementById("new-deck-btn").addEventListener("click", () => openNewDeckModal());
  drawerBody.querySelectorAll("[data-deck]").forEach((el) =>
    el.addEventListener("click", () => { state.currentDeckId = el.dataset.deck; renderDeckDetail(el.dataset.deck); })
  );
}

function openNewDeckModal() {
  openModal(
    `
    <h3>New deck</h3>
    <div class="field"><label>Deck name</label><input id="deck-name" placeholder="e.g. Mono-Red Aggro"/></div>
    <div class="field"><label>Format</label>
      <select id="deck-format">
        <option>Standard</option><option>Pioneer</option><option>Modern</option><option>Legacy</option>
        <option>Vintage</option><option value="Commander">Commander</option><option>Pauper</option><option>Casual / Other</option>
      </select>
    </div>
    <div class="modal-close-row"><button id="cancel-btn">Cancel</button><button class="primary" id="create-deck-btn">Create</button></div>
  `,
    (root) => {
      root.querySelector("#cancel-btn").addEventListener("click", closeModal);
      root.querySelector("#create-deck-btn").addEventListener("click", () => {
        const name = root.querySelector("#deck-name").value.trim();
        if (!name) return;
        const format = root.querySelector("#deck-format").value;
        const deck = Storage.addDeck({ name, format });
        closeModal();
        state.currentDeckId = deck.id;
        renderDeckDetail(deck.id);
      });
    }
  );
}

function renderDeckDetail(deckId) {
  const deck = Storage.findDeck(deckId);
  if (!deck) { state.currentDeckId = null; return renderDecks(); }
  const deckCardObjects = deck.cards.map((dc) => ({ ...Storage.findCard(dc.cardId), inDeckQty: dc.quantity })).filter((c) => c.id);
  const targetSize = (deck.format || "").toLowerCase() === "commander" ? 100 : 60;
  const analysis = Assistant.analyzeDeck(deck, deckCardObjects, Storage.allCards(), targetSize);

  drawerBody.innerHTML = `
    <div class="toolbar">
      <button id="back-btn">← All decks</button>
      <div class="spacer"></div>
      <button class="danger" id="delete-deck-btn">Delete deck</button>
    </div>
    <h3>${esc(deck.name)} <span class="hint">(${esc(deck.format || "")})</span></h3>

    <div class="stat-row">
      <div class="stat"><b>${analysis.deckSize}</b>cards</div>
      <div class="stat"><b>${analysis.removalInDeck}</b>removal</div>
      <div class="stat"><b>${analysis.drawInDeck}</b>card draw</div>
      <div class="stat"><b>${analysis.landCount}</b>lands</div>
    </div>

    <div class="curve-chart">
      ${Object.entries(analysis.curve).map(([label, count]) => {
        const max = Math.max(1, ...Object.values(analysis.curve));
        const h = Math.round((count / max) * 90) + 10;
        return `<div class="curve-bar" style="height:${h}px"><span class="count">${count}</span><span class="label">${label}</span></div>`;
      }).join("")}
    </div>

    <div class="row">
      <div class="field autocomplete-wrap" style="max-width:340px">
        <label>Add a card from your collection</label>
        <input id="deck-add-search" autocomplete="off" placeholder="Search your collection…"/>
        <div class="autocomplete-list" id="deck-ac-list" style="display:none;"></div>
      </div>
      <div class="field" style="max-width:120px"><label>Export</label><button id="export-deck-btn" style="width:100%">As text list</button></div>
    </div>

    <table class="deck-table">
      <thead><tr><th>Card</th><th>Colors</th><th>CMC</th><th>Qty</th><th>Owned</th><th></th></tr></thead>
      <tbody>
        ${deck.cards.map((dc) => {
          const c = Storage.findCard(dc.cardId);
          if (!c) return "";
          return `<tr>
            <td>${esc(c.name)}</td>
            <td>${colorDots(c.colors)}</td>
            <td>${c.cmc ?? ""}</td>
            <td><div class="qty-controls">
              <button data-qtychange="${c.id}:-1">–</button>${dc.quantity}<button data-qtychange="${c.id}:1">+</button>
            </div></td>
            <td>${c.quantity}</td>
            <td><button class="danger" data-remove="${c.id}">Remove</button></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    ${deck.cards.length === 0 ? `<p class="hint">No cards in this deck yet — search above to add from your collection.</p>` : ""}
  `;

  document.getElementById("back-btn").addEventListener("click", () => { state.currentDeckId = null; renderDecks(); });
  document.getElementById("delete-deck-btn").addEventListener("click", () => {
    if (confirm(`Delete "${deck.name}"? This can't be undone.`)) { Storage.deleteDeck(deck.id); state.currentDeckId = null; renderDecks(); }
  });
  document.getElementById("export-deck-btn").addEventListener("click", () => {
    const lines = deck.cards.map((dc) => { const c = Storage.findCard(dc.cardId); return `${dc.quantity} ${c ? c.name : "Unknown"}`; });
    download(`${deck.name.replace(/\s+/g, "_")}.txt`, lines.join("\n"));
  });

  const searchInput = document.getElementById("deck-add-search");
  const acList = document.getElementById("deck-ac-list");
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.toLowerCase();
    if (!q) { acList.style.display = "none"; return; }
    const matches = Storage.allCards().filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) { acList.style.display = "none"; return; }
    acList.innerHTML = matches.map((c) => `<div data-id="${c.id}">${esc(c.name)} <span class="hint">(own ${c.quantity})</span></div>`).join("");
    acList.style.display = "block";
    acList.querySelectorAll("div").forEach((row) =>
      row.addEventListener("click", () => {
        const current = deck.cards.find((dc) => dc.cardId === row.dataset.id);
        Storage.setDeckCardQty(deck.id, row.dataset.id, (current ? current.quantity : 0) + 1);
        searchInput.value = "";
        acList.style.display = "none";
        renderDeckDetail(deck.id);
      })
    );
  });

  drawerBody.querySelectorAll("[data-qtychange]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const [cardId, delta] = btn.dataset.qtychange.split(":");
      const current = deck.cards.find((dc) => dc.cardId === cardId);
      Storage.setDeckCardQty(deck.id, cardId, (current ? current.quantity : 0) + Number(delta));
      renderDeckDetail(deck.id);
    })
  );
  drawerBody.querySelectorAll("[data-remove]").forEach((btn) =>
    btn.addEventListener("click", () => { Storage.setDeckCardQty(deck.id, btn.dataset.remove, 0); renderDeckDetail(deck.id); })
  );
}

// ================= ASSISTANT =================
function renderAssistant() {
  const decks = Storage.allDecks();
  drawerBody.innerHTML = `
    <h3>Deck-building assistant</h3>
    <p class="hint">Suggestions are drawn only from cards already in your Codex — no outside data, no external AI calls. It looks at your mana curve, removal, card draw, ramp, land count, and shared tags.</p>
    <div class="field" style="max-width:320px"><label>Choose a deck</label>
      <select id="assist-deck-select"><option value="">— select —</option>${decks.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("")}</select>
    </div>
    <div id="assist-results"></div>
  `;
  const select = document.getElementById("assist-deck-select");
  if (state.currentDeckId) select.value = state.currentDeckId;
  select.addEventListener("change", () => runAssistant(select.value));
  if (select.value) runAssistant(select.value);
}

function runAssistant(deckId) {
  const results = document.getElementById("assist-results");
  if (!deckId) { results.innerHTML = ""; return; }
  const deck = Storage.findDeck(deckId);
  const deckCardObjects = deck.cards.map((dc) => Storage.findCard(dc.cardId)).filter(Boolean);
  const targetSize = (deck.format || "").toLowerCase() === "commander" ? 100 : 60;
  const analysis = Assistant.analyzeDeck(deck, deckCardObjects, Storage.allCards(), targetSize);

  results.innerHTML = `
    <h4>Suggestions for ${esc(deck.name)}</h4>
    ${
      analysis.suggestions.length === 0
        ? `<div class="empty-state"><h3>Nothing jumps out</h3><p class="hint">Either this deck looks well-rounded, or your collection doesn't have more cards that fit its colors yet.</p></div>`
        : analysis.suggestions.map((s) => `
          <div class="suggestion">
            <div><b>${esc(s.name)}</b><div class="reason">${esc(s.reason)}</div></div>
            <button data-suggest-add="${s.cardId}">+ Add to deck</button>
          </div>`).join("")
    }
  `;
  results.querySelectorAll("[data-suggest-add]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const cardId = btn.dataset.suggestAdd;
      const current = deck.cards.find((dc) => dc.cardId === cardId);
      Storage.setDeckCardQty(deck.id, cardId, (current ? current.quantity : 0) + 1);
      runAssistant(deckId);
    })
  );
}

// ================= STORAGE MAP =================
function renderStorage() {
  const counts = Storage.classCounts();
  const settings = Storage.getSettings();
  drawerBody.innerHTML = `
    <h3>Storage map</h3>
    <p class="hint">Codex files cards under a Dewey-style code: <b>class.box.sequence</b> — the class digit mirrors Magic's color pie (000 Artifact, 100 White, 200 Blue, 300 Black, 400 Red, 500 Green, 600 Multicolor, 700 Land, 800 Tokens, 900 Special), the middle number is the physical box, and the last is where the card sits in that box.</p>

    <div class="class-grid">
      ${Object.entries(counts).map(([code, info]) => `
        <div class="class-tile">
          <div class="code">${code}</div>
          <div>${esc(info.label)}</div>
          <div class="hint">${info.filed} filed / ${info.total} total</div>
        </div>`).join("")}
    </div>

    <h4 style="margin-top:1.5rem">Browse a box</h4>
    <div class="field" style="max-width:220px"><label>Number of boxes</label><input id="num-boxes" type="number" min="1" value="${settings.numberOfBoxes}"/></div>
    <div class="box-picker" id="box-picker">
      ${Array.from({ length: settings.numberOfBoxes }, (_, i) => i + 1)
        .map((n) => `<button class="box-chip ${state.storageBox === n ? "active" : ""}" data-box="${n}">Box ${n}</button>`)
        .join("")}
    </div>
    <div id="box-contents"></div>

    <h4 style="margin-top:1.5rem">Find a card</h4>
    <div class="field" style="max-width:320px"><input id="find-card" placeholder="Type a card name…"/></div>
    <div id="find-result"></div>

    <div class="toolbar" style="margin-top:1.5rem">
      <button id="print-labels-btn">Print label sheet</button>
    </div>
  `;

  document.getElementById("num-boxes").addEventListener("change", (e) => {
    Storage.updateSettings({ numberOfBoxes: Math.max(1, parseInt(e.target.value, 10) || 1) });
    renderStorage();
  });
  document.querySelectorAll("[data-box]").forEach((btn) =>
    btn.addEventListener("click", () => { state.storageBox = Number(btn.dataset.box); renderStorage(); showBoxContents(); })
  );
  if (state.storageBox) showBoxContents();

  document.getElementById("find-card").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    const resultEl = document.getElementById("find-result");
    if (!q) { resultEl.innerHTML = ""; return; }
    const matches = Storage.allCards().filter((c) => c.name.toLowerCase().includes(q)).slice(0, 10);
    resultEl.innerHTML = matches.map((c) => `<div>${esc(c.name)} — <span class="code-chip ${c.locationCode ? "" : "unfiled"}">${c.locationCode || "unfiled"}</span></div>`).join("") || `<p class="hint">No matches.</p>`;
  });

  document.getElementById("print-labels-btn").addEventListener("click", printLabels);
}

function showBoxContents() {
  const el = document.getElementById("box-contents");
  if (!el) return;
  const cards = Storage.cardsInBox(state.storageBox);
  el.innerHTML = `
    <table class="location-table">
      <thead><tr><th>Code</th><th>Card</th><th>Type</th></tr></thead>
      <tbody>${cards.map((c) => `<tr><td>${esc(c.locationCode)}</td><td>${esc(c.name)}</td><td>${esc(c.typeLine || "")}</td></tr>`).join("")}</tbody>
    </table>
    ${cards.length === 0 ? `<p class="hint">No cards filed in Box ${state.storageBox} yet.</p>` : ""}
  `;
}

function printLabels() {
  const all = Storage.allCards().filter((c) => c.locationCode).sort((a, b) => a.locationCode.localeCompare(b.locationCode));
  printArea.innerHTML = `
    <h3>Codex — Label sheet</h3>
    <table>
      <thead><tr><th>Location</th><th>Card</th><th>Set</th></tr></thead>
      <tbody>${all.map((c) => `<tr><td>${esc(c.locationCode)}</td><td>${esc(c.name)}</td><td>${esc(c.set || "")}</td></tr>`).join("")}</tbody>
    </table>
  `;
  printArea.style.display = "block";
  window.print();
  setTimeout(() => (printArea.style.display = "none"), 500);
}

// ================= IMPORT / EXPORT =================
function renderIO() {
  drawerBody.innerHTML = `
    <h3>Import · Export</h3>
    <p class="hint">Codex stores everything in this browser only. Export regularly and keep the file somewhere safe — clearing browser data or switching devices means starting over unless you re-import.</p>

    <h4>Full backup</h4>
    <div class="toolbar">
      <button id="export-json-btn">Export full backup (JSON)</button>
      <label class="field" style="margin:0"><button id="import-json-trigger">Import backup (JSON)</button><input type="file" id="import-json-input" accept=".json" style="display:none"/></label>
      <select id="import-mode"><option value="merge">Merge with current data</option><option value="replace">Replace current data</option></select>
    </div>

    <h4 style="margin-top:1.5rem">Collection CSV</h4>
    <p class="hint">Columns: name, quantity, tags (semicolon-separated), box. Each row is looked up on Scryfall automatically.</p>
    <div class="toolbar">
      <button id="export-csv-btn">Export collection (CSV)</button>
      <label class="field" style="margin:0"><button id="import-csv-trigger">Bulk import (CSV)</button><input type="file" id="import-csv-input" accept=".csv" style="display:none"/></label>
    </div>
    <div id="import-status" class="hint"></div>
  `;

  document.getElementById("export-json-btn").addEventListener("click", () => {
    download("codex-backup.json", JSON.stringify(Storage.getDB(), null, 2));
  });

  document.getElementById("import-json-trigger").addEventListener("click", () => document.getElementById("import-json-input").click());
  document.getElementById("import-json-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const parsed = JSON.parse(text);
      const mode = document.getElementById("import-mode").value;
      if (mode === "replace") Storage.replaceDB(parsed);
      else Storage.mergeDB(parsed);
      document.getElementById("import-status").textContent = "Backup imported.";
      render();
    } catch (err) {
      document.getElementById("import-status").textContent = "That file didn't look like a valid Codex backup.";
    }
  });

  document.getElementById("export-csv-btn").addEventListener("click", () => {
    const rows = ["name,quantity,tags,box,location_code,set,type_line"];
    Storage.allCards().forEach((c) => {
      rows.push([c.name, c.quantity, (c.tags || []).join(";"), c.box || "", c.locationCode || "", c.set || "", c.typeLine || ""]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    });
    download("codex-collection.csv", rows.join("\n"));
  });

  document.getElementById("import-csv-trigger").addEventListener("click", () => document.getElementById("import-csv-input").click());
  document.getElementById("import-csv-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const header = lines.shift();
    const statusEl = document.getElementById("import-status");
    let done = 0;
    for (const line of lines) {
      const cols = parseCsvLine(line);
      const [name, quantity, tags, box] = cols;
      if (!name) continue;
      statusEl.textContent = `Importing "${name}"… (${++done}/${lines.length})`;
      let data;
      try { data = await Scryfall.getByFuzzyName(name); } catch { data = { name }; }
      const card = Storage.addCard({
        ...data,
        name: data.name || name,
        quantity: parseInt(quantity, 10) || 1,
        tags: (tags || "").split(";").map((t) => t.trim()).filter(Boolean),
      });
      if (box) Storage.assignLocation(card.id, parseInt(box, 10) || 1);
      await new Promise((r) => setTimeout(r, 120)); // be polite to Scryfall's API
    }
    statusEl.textContent = `Done — imported ${done} card(s).`;
    render();
  });
}

function parseCsvLine(line) {
  // minimal CSV parser: handles quoted fields with commas
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { result.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  result.push(cur);
  return result.map((s) => s.trim());
}

render();
