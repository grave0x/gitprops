// ==UserScript==
// @name         GitHub Respect System
// @namespace    https://respectfb.dev
// @version      3.0.0
// @description  Fork-based distributed respect system. OAuth login via GitHub App — no PAT needed.
// @author       respectfb
// @match        https://github.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-end
// @noframes
// ==/UserScript==

(function () {
  "use strict";

  // ── Configuration ──────────────────────────────────────────────────────

  const DEFAULTS = {
    apiBase: "https://gitprops-app.fly.dev",
    cooldownMs: 3000,
  };

  // ── State ──────────────────────────────────────────────────────────────

  let config = { ...DEFAULTS };
  let respectCache = {};   // username -> {score}
  let cooldowns = {};      // username -> timestamp
  let myUsername = null;   // resolved from App API
  let loggedIn = false;
  let observer = null;

  // ── Storage ────────────────────────────────────────────────────────────

  function loadConfig() {
    try {
      const saved = GM_getValue("respectConfig", null);
      if (saved) config = { ...DEFAULTS, ...JSON.parse(saved) };
    } catch (_) {}
  }

  function saveConfig() {
    GM_setValue("respectConfig", JSON.stringify(config));
  }

  // ── App API ────────────────────────────────────────────────────────────

  function appCall(method, path, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: config.apiBase + path,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        data: body ? JSON.stringify(body) : undefined,
        anonymous: false, // send cookies for session auth
        onload(r) {
          if (r.status === 401) {
            loggedIn = false;
            myUsername = null;
            reject(new Error("Not logged in. Open settings and click Login with GitHub."));
            return;
          }
          try {
            const data = JSON.parse(r.responseText);
            if (r.status >= 400) {
              reject(new Error(data.error || `HTTP ${r.status}`));
            } else {
              resolve(data);
            }
          } catch {
            reject(new Error(`Server error: ${r.status}`));
          }
        },
        onerror: () => reject(new Error("Cannot reach respect server")),
        ontimeout: () => reject(new Error("Server timeout")),
      });
    });
  }

  /**
   * Check if we're logged in and get our username.
   */
  async function checkAuth() {
    try {
      const data = await appCall("GET", "/api/auth/status");
      myUsername = data.login;
      loggedIn = true;
      return true;
    } catch {
      loggedIn = false;
      myUsername = null;
      return false;
    }
  }

  /**
   * Give respect via the App API.
   */
  async function giveRespect(toUser, score, reason) {
    return appCall("POST", "/api/respect", {
      to: toUser,
      score,
      reason: reason || "",
    });
  }

  /**
   * Read aggregated totals.
   */
  async function fetchTotals() {
    try {
      return await appCall("GET", "/api/totals");
    } catch {
      return null;
    }
  }

  /**
   * Fetch scores for a set of usernames.
   */
  async function fetchScores(usernames) {
    const uncached = [...new Set(usernames.filter((u) => !respectCache[u]))];
    if (uncached.length === 0) return;

    const totals = await fetchTotals();
    if (totals && totals.users) {
      uncached.forEach((u) => {
        respectCache[u] = { score: totals.users[u]?.score || 0 };
      });
    }
  }

  // ── UI Components ──────────────────────────────────────────────────────

  function createBadge(username, score) {
    const badge = document.createElement("span");
    badge.className = "respect-badge";
    badge.dataset.username = username;
    badge.title = `Respect score: ${score || 0}`;

    const icon = document.createElement("span");
    icon.className = "respect-icon";
    icon.textContent = "👍";

    const count = document.createElement("span");
    count.className = "respect-count";
    count.textContent = score || 0;

    badge.appendChild(icon);
    badge.appendChild(count);

    badge.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!loggedIn) {
        alert("Log in first — open Violentmonkey menu → ⚙️ Respect Settings");
        return;
      }
      showRespectDialog(username, badge);
    });

    return badge;
  }

  function showRespectDialog(username, triggerEl) {
    document.querySelector(".respect-dialog")?.remove();

    const dialog = document.createElement("div");
    dialog.className = "respect-dialog";
    dialog.innerHTML = `
      <div class="respect-dialog-content">
        <div class="respect-dialog-header">
          <strong>Give respect to @${escapeHtml(username)}</strong>
          <button class="respect-dialog-close" aria-label="Close">&times;</button>
        </div>
        <div class="respect-dialog-body">
          <label>Score (1-5):</label>
          <div class="respect-score-picker">
            ${[1,2,3,4,5].map((s) =>
              `<button class="respect-score-btn" data-score="${s}">${s}</button>`
            ).join("")}
          </div>
          <label for="respect-reason">Reason (optional):</label>
          <textarea id="respect-reason" maxlength="280" rows="2"
            placeholder="Why do you respect this person?"></textarea>
          <button class="respect-submit-btn" disabled>Give Respect</button>
          <div class="respect-dialog-status"></div>
          <small class="respect-dispatch-note">
            Sent via GitHub App. Respect is written to your fork.
          </small>
        </div>
      </div>
    `;

    const rect = triggerEl.getBoundingClientRect();
    dialog.style.position = "fixed";
    dialog.style.top = `${Math.min(rect.bottom + 4, innerHeight - 340)}px`;
    dialog.style.left = `${Math.min(rect.left, innerWidth - 320)}px`;

    document.body.appendChild(dialog);

    let selectedScore = 0;
    const submitBtn = dialog.querySelector(".respect-submit-btn");
    const statusEl = dialog.querySelector(".respect-dialog-status");
    const scoreBtns = dialog.querySelectorAll(".respect-score-btn");

    scoreBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedScore = Number(btn.dataset.score);
        scoreBtns.forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        submitBtn.disabled = false;
      });
    });

    dialog.querySelector(".respect-dialog-close").addEventListener("click", () => dialog.remove());

    submitBtn.addEventListener("click", async () => {
      if (!selectedScore) return;
      if (cooldowns[username] && Date.now() - cooldowns[username] < config.cooldownMs) {
        statusEl.textContent = "Slow down — cooldown active.";
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Sending...";
      statusEl.textContent = "";

      try {
        const reason = dialog.querySelector("#respect-reason").value.trim();
        const result = await giveRespect(username, selectedScore, reason);
        cooldowns[username] = Date.now();
        delete respectCache[username];
        statusEl.innerHTML =
          `<span class="respect-success">+${result.score} for @${escapeHtml(username)}!</span>`;
        setTimeout(() => dialog.remove(), 1500);
        setTimeout(refreshAllBadges, 500);
      } catch (err) {
        statusEl.innerHTML = `<span class="respect-error">${escapeHtml(err.message || String(err))}</span>`;
        submitBtn.disabled = false;
        submitBtn.textContent = "Give Respect";
      }
    });

    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.remove();
    });
  }

  // ── Injection ──────────────────────────────────────────────────────────

  const USERNAME_SELECTOR = [
    'a[data-hovercard-type="user"]',
    ".commit-author.user-mention",
    ".opened-by a",
  ].join(",");

  const RESERVED_PATHS = new Set([
    "settings", "notifications", "organizations", "apps", "marketplace",
    "explore", "topics", "trending", "collections", "events",
    "pulls", "issues", "discussions", "sponsors", "codespaces",
    "security", "pricing", "features", "login", "logout", "signup",
    "account", "new", "import", "join", "enterprise", "orgs",
    "about", "site-policy", "readme", "contact",
  ]);

  function extractUsername(el) {
    const href = el.getAttribute("href") || "";
    const m = href.match(/^\/([^/?#]+)$/);
    if (m && !RESERVED_PATHS.has(m[1])) return m[1];
    return null;
  }

  function injectBadges() {
    if (!loggedIn) return;

    const links = document.querySelectorAll(USERNAME_SELECTOR);
    links.forEach((link) => {
      const username = extractUsername(link);
      if (!username) return;
      if (link.parentNode?.querySelector(".respect-badge")) return;

      const badge = createBadge(username, respectCache[username]?.score || 0);
      link.parentNode.insertBefore(badge, link.nextSibling);
    });

    const usernames = [...links].map(extractUsername).filter(Boolean);
    if (usernames.length > 0) {
      fetchScores(usernames).then(refreshAllBadges);
    }
  }

  function refreshAllBadges() {
    document.querySelectorAll(".respect-badge").forEach((badge) => {
      const count = badge.querySelector(".respect-count");
      if (count) {
        count.textContent = respectCache[badge.dataset.username]?.score || 0;
      }
    });
  }

  function injectProfileCard() {
    if (!loggedIn) return;

    const m = location.pathname.match(/^\/([^/?#]+)$/);
    if (!m || RESERVED_PATHS.has(m[1])) return;

    const profileUser = m[1];
    if (document.querySelector(".respect-profile-card")) return;

    const sidebar =
      document.querySelector(".js-profile-editable-area") ||
      document.querySelector('[itemtype="http://schema.org/Person"]');
    if (!sidebar) return;

    fetchScores([profileUser]).then(() => {
      const score = respectCache[profileUser]?.score || 0;

      const card = document.createElement("div");
      card.className = "respect-profile-card border rounded-2 p-3 mt-3";
      card.innerHTML = `
        <h3 class="h4 mb-2">Respect</h3>
        <div class="respect-profile-score">
          <span class="respect-profile-icon">👍</span>
          <span class="respect-profile-num">${score}</span>
          <span class="respect-profile-label">respect score</span>
        </div>
        <button class="btn btn-sm btn-outline mt-2 respect-profile-give-btn">
          Give Respect
        </button>
      `;

      card.querySelector(".respect-profile-give-btn").addEventListener("click", (e) => {
        showRespectDialog(profileUser, e.target);
      });

      sidebar.appendChild(card);
    });
  }

  // ── Settings Panel ─────────────────────────────────────────────────────

  function showSettings() {
    document.querySelector(".respect-settings-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "respect-settings-overlay";
    overlay.innerHTML = `
      <div class="respect-settings">
        <h2>Respect System Settings</h2>
        <p class="respect-settings-desc">
          Fork-based OAuth model. Login once with GitHub — no PAT needed.
          The GitHub App commits respect data to <em>your</em> fork of the respectfb repo.
        </p>

        <div class="respect-settings-status ${loggedIn ? "respect-logged-in" : "respect-logged-out"}">
          <span class="respect-status-dot"></span>
          <span>${loggedIn ? `Logged in as <strong>@${escapeHtml(myUsername)}</strong>` : "Not logged in"}</span>
        </div>

        ${loggedIn ? '<button class="btn btn-sm btn-danger" id="rs-logout">Logout</button>' : ""}

        <label>
          App Server URL
          <input type="text" id="rs-apiBase" value="${escapeHtml(config.apiBase)}"
            placeholder="http://localhost:3099">
          <small>The GitHub App server address.</small>
        </label>

        <div class="respect-settings-actions">
          ${!loggedIn ? '<button class="btn btn-primary" id="rs-login">🔑 Login with GitHub</button>' : ""}
          <button class="btn btn-primary" id="rs-save">Save</button>
          <button class="btn" id="rs-cancel">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector("#rs-save").addEventListener("click", () => {
      config.apiBase = overlay.querySelector("#rs-apiBase").value.trim();
      saveConfig();
      respectCache = {};
      overlay.remove();
      checkAuth().then(() => injectAll());
    });

    overlay.querySelector("#rs-cancel").addEventListener("click", () => overlay.remove());

    const loginBtn = overlay.querySelector("#rs-login");
    if (loginBtn) {
      loginBtn.addEventListener("click", () => {
        GM_openInTab(config.apiBase + "/api/auth/login", { active: true });
      });
    }

    const logoutBtn = overlay.querySelector("#rs-logout");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        try {
          await appCall("GET", "/api/auth/logout");
        } catch (_) {}
        loggedIn = false;
        myUsername = null;
        overlay.remove();
        showSettings(); // re-render settings
      });
    }

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  // ── Styles ─────────────────────────────────────────────────────────────

  function injectStyles() {
    GM_addStyle(`
      .respect-badge {
        display: inline-flex; align-items: center; gap: 2px;
        margin-left: 6px; padding: 1px 6px;
        border-radius: 12px; background: #f6f8fa; border: 1px solid #d0d7de;
        cursor: pointer; font-size: 11px; line-height: 18px;
        transition: background 0.15s, border-color 0.15s; vertical-align: middle;
      }
      .respect-badge:hover { background: #ddf4ff; border-color: #54aeff; }
      .respect-icon { font-size: 12px; }
      .respect-count { font-weight: 600; color: #1f2328; min-width: 10px; text-align: center; }

      .respect-dialog {
        z-index: 9999; width: 300px;
        background: #fff; border: 1px solid #d0d7de;
        border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      }
      .respect-dialog-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 10px 12px; border-bottom: 1px solid #d0d7de; font-size: 13px;
      }
      .respect-dialog-close {
        background: none; border: none; font-size: 18px;
        cursor: pointer; color: #656d76;
      }
      .respect-dialog-body {
        padding: 12px; display: flex; flex-direction: column; gap: 8px;
      }
      .respect-dialog-body label { font-size: 12px; font-weight: 600; color: #656d76; }
      .respect-score-picker { display: flex; gap: 6px; }
      .respect-score-btn {
        flex: 1; padding: 6px 0; border: 1px solid #d0d7de;
        border-radius: 6px; background: #f6f8fa; cursor: pointer;
        font-weight: 600; font-size: 14px; transition: all 0.15s;
      }
      .respect-score-btn:hover { background: #ddf4ff; border-color: #54aeff; }
      .respect-score-btn.selected { background: #0969da; color: #fff; border-color: #0969da; }
      #respect-reason {
        border: 1px solid #d0d7de; border-radius: 6px;
        padding: 6px 8px; font-size: 12px; resize: vertical; font-family: inherit;
      }
      .respect-submit-btn {
        padding: 8px; border: none; border-radius: 6px;
        background: #1f883d; color: #fff; font-weight: 600;
        cursor: pointer; font-size: 13px;
      }
      .respect-submit-btn:disabled { background: #94d3a2; cursor: not-allowed; }
      .respect-submit-btn:hover:not(:disabled) { background: #1a7f37; }
      .respect-dialog-status { font-size: 12px; min-height: 18px; }
      .respect-success { color: #1a7f37; }
      .respect-error { color: #cf222e; }
      .respect-dispatch-note {
        display: block; color: #656d76; font-size: 11px; margin-top: 4px;
        font-style: italic;
      }

      .respect-profile-card { background: #fff; }
      .respect-profile-score { display: flex; align-items: baseline; gap: 6px; }
      .respect-profile-icon { font-size: 24px; }
      .respect-profile-num { font-size: 28px; font-weight: 700; }
      .respect-profile-label { font-size: 12px; color: #656d76; }

      .respect-settings-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.4);
        z-index: 10000; display: flex; align-items: center; justify-content: center;
      }
      .respect-settings {
        background: #fff; border-radius: 12px; padding: 24px;
        width: 440px; max-width: 90vw; max-height: 80vh; overflow-y: auto;
        display: flex; flex-direction: column; gap: 14px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.2);
      }
      .respect-settings h2 {
        margin: 0; font-size: 18px;
        border-bottom: 1px solid #d0d7de; padding-bottom: 10px;
      }
      .respect-settings-desc {
        margin: 0; font-size: 12px; color: #656d76; line-height: 1.5;
      }
      .respect-settings-status {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 12px; border-radius: 8px; font-size: 13px;
      }
      .respect-logged-in { background: #dafbe1; color: #116329; }
      .respect-logged-out { background: #f6f8fa; color: #656d76; }
      .respect-status-dot {
        width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
      }
      .respect-logged-in .respect-status-dot { background: #1a7f37; }
      .respect-logged-out .respect-status-dot { background: #d0d7de; }
      .respect-settings label {
        display: flex; flex-direction: column; gap: 4px;
        font-size: 13px; font-weight: 600; color: #1f2328;
      }
      .respect-settings label small { font-weight: 400; color: #656d76; }
      .respect-settings label input {
        padding: 6px 10px; border: 1px solid #d0d7de;
        border-radius: 6px; font-size: 13px; font-family: inherit;
      }
      .respect-settings-actions { display: flex; gap: 8px; justify-content: flex-end; }
      .btn-danger { background: #cf222e; color: #fff; border: none; }
      .btn-danger:hover { background: #a40e26; }
    `);
  }

  // ── Utilities ──────────────────────────────────────────────────────────

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  // ── Init ───────────────────────────────────────────────────────────────

  function injectAll() {
    injectBadges();
    injectProfileCard();
  }

  async function start() {
    loadConfig();
    injectStyles();

    await checkAuth();

    if (loggedIn) injectAll();

    // Poll for auth status periodically (in case user logs in via settings tab)
    setInterval(async () => {
      const wasLoggedIn = loggedIn;
      await checkAuth();
      if (!wasLoggedIn && loggedIn) injectAll();
    }, 30_000);

    // Periodically sync respect scores from central repo
    setInterval(async () => {
      if (!loggedIn) return;
      try {
        const totals = await fetchTotals();
        if (totals && totals.users) {
          respectCache = {};
          for (const [user, data] of Object.entries(totals.users)) {
            respectCache[user] = { score: data.score };
          }
          refreshAllBadges();
          // Re-inject profile card if on a profile page
          const card = document.querySelector(".respect-profile-card");
          if (card) {
            card.remove();
            injectProfileCard();
          }
        }
      } catch (_) { /* silent — will retry next cycle */ }
    }, 60_000);

    // Initial score fetch
    if (loggedIn) {
      fetchTotals().then((totals) => {
        if (totals && totals.users) {
          for (const [user, data] of Object.entries(totals.users)) {
            respectCache[user] = { score: data.score };
          }
          refreshAllBadges();
        }
      });
    }

    let debounceTimer = null;
    observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => injectBadges(), 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const origPush = history.pushState;
    history.pushState = function (...args) {
      origPush.apply(this, args);
      setTimeout(injectAll, 500);
    };
    window.addEventListener("popstate", () => setTimeout(injectAll, 500));

    GM_registerMenuCommand("⚙️ Respect Settings", showSettings);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
