import { supabase } from "./supabaseClient.js";
import { Storage } from "./storage.js";
import { initApp } from "./app.js";

const authRoot = document.getElementById("auth-root");
const appRoot = document.getElementById("app-root");
const accountBar = document.getElementById("account-bar");

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function renderAuthForm(message = "") {
  appRoot.style.display = "none";
  authRoot.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <h1>Codex</h1>
        <p class="tagline">a card catalog for a Magic collection</p>
        ${message ? `<p class="auth-message">${esc(message)}</p>` : ""}
        <div class="field"><label>Email</label><input id="auth-email" type="email" autocomplete="email"/></div>
        <div class="field"><label>Password</label><input id="auth-password" type="password" autocomplete="current-password"/></div>
        <p class="auth-error" id="auth-error" style="display:none;"></p>
        <div class="auth-actions">
          <button class="primary" id="auth-signin-btn">Sign in</button>
          <button id="auth-signup-btn">Create account</button>
        </div>
      </div>
    </div>
  `;

  const emailEl = document.getElementById("auth-email");
  const passEl = document.getElementById("auth-password");
  const errEl = document.getElementById("auth-error");

  function showError(msg) {
    errEl.textContent = msg;
    errEl.style.display = "block";
  }

  document.getElementById("auth-signin-btn").addEventListener("click", async () => {
    errEl.style.display = "none";
    const { error } = await supabase.auth.signInWithPassword({ email: emailEl.value.trim(), password: passEl.value });
    if (error) showError(error.message);
    // success is picked up by onAuthStateChange below
  });

  document.getElementById("auth-signup-btn").addEventListener("click", async () => {
    errEl.style.display = "none";
    const { data, error } = await supabase.auth.signUp({ email: emailEl.value.trim(), password: passEl.value });
    if (error) { showError(error.message); return; }
    if (data.session) return; // auto-confirmed — onAuthStateChange handles it
    renderAuthForm("Check your email to confirm your account, then sign in here.");
  });
}

function renderAccountBar(user) {
  accountBar.innerHTML = `
    <span class="hint" id="sync-status">synced</span>
    <select id="collection-switcher" style="max-width:220px;"></select>
    <span class="hint">${esc(user.email)}</span>
    <button id="sign-out-btn">Sign out</button>
  `;
  document.getElementById("sign-out-btn").addEventListener("click", async () => {
    await supabase.auth.signOut();
  });
  refreshSwitcher(user);
}

async function refreshSwitcher(user) {
  const select = document.getElementById("collection-switcher");
  if (!select) return;
  let shared = [];
  try { shared = await Storage.listSharedWithMe(); } catch (e) { console.error(e); }
  const options = [`<option value="mine">My collection</option>`]
    .concat(shared.map((s) => `<option value="${esc(s.owner_id)}" data-permission="${esc(s.permission)}">${esc(s.owner_email)}'s collection (${esc(s.permission)})</option>`));
  select.innerHTML = options.join("");
  select.value = Storage.isViewingOwnCollection() ? "mine" : Storage.getActiveOwnerId();
  select.onchange = async () => {
    setSyncStatus("saving");
    if (select.value === "mine") {
      await Storage.switchToMine(setSyncStatus);
    } else {
      const chosen = shared.find((s) => s.owner_id === select.value);
      await Storage.switchToOwner(select.value, chosen ? chosen.permission : "view", setSyncStatus);
    }
    window.dispatchEvent(new CustomEvent("codex:collection-switched"));
  };
}

function setSyncStatus(status) {
  const el = document.getElementById("sync-status");
  if (el) {
    el.textContent = status === "saving" ? "saving…" : status === "error" ? "sync error — check connection" : status === "readonly-blocked" ? "view only" : "synced";
  }
  if (status === "readonly-blocked") {
    alert("You have view-only access to this collection and can't make changes here.");
  }
}

let appStarted = false;

async function startApp(user) {
  authRoot.innerHTML = "";
  appRoot.style.display = "block";
  await Storage.initForUser(user.id, user.email, setSyncStatus);
  renderAccountBar(user);
  if (!appStarted) {
    initApp();
    appStarted = true;
  } else {
    // returning from a sign-out/sign-in cycle within the same page load
    location.reload();
  }
  window.addEventListener("codex:collection-switched", () => {
    initApp();
  });
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_IN" && session) {
    startApp(session.user);
  } else if (event === "SIGNED_OUT") {
    Storage.signOut();
    appStarted = false;
    renderAuthForm();
  }
});

// Initial check on page load
supabase.auth.getSession().then(({ data }) => {
  if (data.session) startApp(data.session.user);
  else renderAuthForm();
});
