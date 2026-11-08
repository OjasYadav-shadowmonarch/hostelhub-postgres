/* =========================================================
   HostelHub — front end
   Talks to the Python (Flask) backend in app.py over a small
   JSON REST API under /api/... . `state` is a local cache of
   whatever the backend last told us; every mutation goes to
   the server first, and the response is used to refresh the
   cache before re-rendering.
   ========================================================= */

/* ---------------------- API helper ---------------------- */

function readCookie(name) {
  const prefix = name + "=";
  return document.cookie
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(prefix))
    ?.slice(prefix.length) || "";
}

async function ensureCsrfToken() {
  const existing = readCookie("hostelhub_csrf");
  if (existing) return existing;

  const res = await fetch("/api/csrf", { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) throw new Error("Could not obtain a security token.");
  const data = await res.json().catch(() => ({}));
  const token = data.token || readCookie("hostelhub_csrf");
  if (!token) throw new Error("Could not obtain a security token.");
  return token;
}

async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store"
  };
  if (options.body !== undefined) opts.body = JSON.stringify(options.body);

  if (method !== "GET" && method !== "HEAD") {
    try {
      opts.headers["X-CSRF-Token"] = await ensureCsrfToken();
    } catch (csrfErr) {
      showToast("Security check failed. Refresh the page and try again.", "error");
      throw csrfErr;
    }
  }

  let res, data;
  try {
    res = await fetch("/api" + path, opts);
    data = await res.json().catch(() => ({}));
  } catch (netErr) {
    showToast("Couldn't reach the backend. Is app.py running?", "error");
    throw netErr;
  }
  if (!res.ok) {
    const message = data && data.error ? data.error : "Something went wrong.";
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------------------- Config (from backend) ---------------------- */

// Populated by loadMeta() on startup — see init() near the bottom of this file.
let COLLEGES = [];
let AMENITY_DEFS = [];

function emptyState() {
  return {
    users: [], hostels: [], inquiries: [], stats: null,
    currentUser: null,
    // "landing" = public home page, "auth" = login/signup card, "app" = logged-in / guest app
    screen: "landing",
    // which portal's login/signup is in view: "student" | "owner"
    activePortal: "student",
    authMode: "login", // "login" | "signup" — only meaningful while screen === "auth"
    guestBrowsing: false,
    pendingContactHostelId: null,
    pendingContactAction: null,
    ownerSubtab: "listings",
    adminSubtab: "approval",
    studentSubtab: "find",
    typeFilter: "all",
    searchQuery: "",
    compareSelection: [],
    editingHostelId: null,
    listingImageData: null,
    wishlist: []
  };
}

let state = emptyState();

/* Re-pull users/hostels/inquiries from the backend into the local cache. */
async function refreshState() {
  const fresh = await api("/state");
  state.users = fresh.users || [];
  state.hostels = fresh.hostels || [];
  state.inquiries = fresh.inquiries || [];
  state.stats = fresh.stats || null;
  if (state.currentUser && state.currentUser.role === "student") {
    try {
      const wl = await api("/wishlist");
      state.wishlist = wl.savedIds || [];
    } catch (_) {
      state.wishlist = [];
    }
  }
}

/* ---------------------- Utilities ---------------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $all = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function currency(n) {
  return "₹" + Number(n).toLocaleString("en-IN");
}

function formatDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function initials(name) {
  return name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
}

function articleFor(role) {
  return role === "admin" ? "an" : "a";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function isValidPhone(phone) {
  return /^\d{10}$/.test(phone);
}

function findUser(id) { return state.users.find(u => u.id === Number(id)); }
function findUserByUsername(username) { return state.users.find(u => u.username.toLowerCase() === String(username).toLowerCase()); }
function findHostel(id) { return state.hostels.find(h => h.id === Number(id)); }
function amenityLabel(id) { return AMENITY_DEFS.find(a => a.id === id); }

function hostelsByOwner(ownerId) { return state.hostels.filter(h => h.ownerId === Number(ownerId)); }
function inquiriesForStudent(studentId) { return state.inquiries.filter(i => i.studentId === Number(studentId)); }
function inquiriesForOwner(ownerId) {
  const ownedIds = hostelsByOwner(ownerId).map(h => h.id);
  return state.inquiries.filter(i => ownedIds.includes(i.hostelId));
}

let toastTimer = null;
function showToast(message, type = "default") {
  const toast = $("#toast");
  toast.className = "toast show" + (type !== "default" ? " " + type : "");
  toast.innerHTML = (type === "success" ? "✅ " : type === "error" ? "⚠️ " : "ℹ️ ") + esc(message);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.classList.remove("show"); }, 3200);
}

/* ---------------------- Landing / portal navigation ---------------------- */

const PORTAL_COPY = {
  student: {
    wordmark: "🏠 HostelHub", icon: "🔑",
    loginTitle: "Welcome Back", loginSubtitle: "Sign in to your account",
    signupTitle: "Create Account", signupSubtitle: "Join HostelHub today",
    signupAllowed: true
  },
  owner: {
    wordmark: "🏠 HostelHub Owners", icon: "🏡",
    loginTitle: "Owner Portal", loginSubtitle: "Sign in to manage your properties",
    signupTitle: "List Your First Property", signupSubtitle: "Create a free owner account",
    signupAllowed: true
  },
  admin: {
    wordmark: "🏠 HostelHub Admin", icon: "🛡️",
    loginTitle: "Admin Portal", loginSubtitle: "Sign in to the control panel",
    signupTitle: "", signupSubtitle: "",
    signupAllowed: false
  }
};

// Editorial panel shown beside the auth form. Copy only — no workflow change.
const AUTH_ASIDE = {
  student: {
    eyebrow: "For students",
    title: "Your next home,<br><em>already waiting.</em>",
    text: "Search verified hostels near your college, compare what matters and talk to the owner directly.",
    points: ["Verified listings, no brokers", "Save and compare up to 3 hostels", "Contact owners in one tap"]
  },
  owner: {
    eyebrow: "For property owners",
    title: "Fill your rooms.<br><em>Skip the middlemen.</em>",
    text: "Publish your property, show it on the map and receive inquiries from students who are ready to move.",
    points: ["Free owner dashboard", "Manage listings and availability", "Inquiries land straight with you"]
  },
  admin: {
    eyebrow: "For administrators",
    title: "Keep the platform<br><em>trustworthy.</em>",
    text: "Review new listings, moderate the marketplace and keep HostelHub accurate for every student.",
    points: ["Approve or reject listings", "Monitor owners and students", "One clear control panel"]
  }
};

// Small inline icons keep the auth controls crisp without extra asset requests.
const AUTH_ICONS = {
  student: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/></svg>`,
  owner: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/></svg>`,
  admin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
  at: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg>`,
  mail: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6.2 6.2l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`
};

const AUTH_PORTALS = [
  { id: "student", label: "Student", icon: AUTH_ICONS.student },
  { id: "owner", label: "Owner", icon: AUTH_ICONS.owner }
];

function showLandingScreen() {
  closeModal();
  state.screen = "landing";
  $("#landingScreen").hidden = false;
  $("#authScreen").hidden = true;
  $("#mainApp").hidden = true;
  const footer = $("#siteFooter");
  if (footer) footer.hidden = false;
  renderLandingStats();
  renderLandingPreview();
  renderLandingNavActions();
  closeMobileNav();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderLandingNavActions() {
  const container = $("#landingNavActions");
  if (!container) return;
  const isLight = document.body.classList.contains("light-theme");
  const themeIcon = isLight ? "🌙" : "☀️";
  if (state.currentUser) {
    const role = state.currentUser.role;
    const roleLabel = role === "admin" ? "Admin Panel" : (role === "owner" ? "Owner Dashboard" : "Find Hostels");
    container.innerHTML = `
      <button class="icon-btn theme-toggle-btn" data-action="toggle-theme" title="Toggle theme" aria-label="Toggle theme">${themeIcon}</button>
      <button class="btn btn-ghost" data-action="logout">Sign Out</button>
      <button class="btn btn-gold" data-action="return-to-app">Go to ${roleLabel} →</button>
    `;
  } else {
    container.innerHTML = `
      <button class="icon-btn theme-toggle-btn" data-action="toggle-theme" title="Toggle theme" aria-label="Toggle theme">${themeIcon}</button>
      <button class="btn btn-ghost" data-action="go-landing-login">Log In</button>
      <button class="btn btn-gold" data-action="browse-guest">Get Started</button>
    `;
  }
  syncThemeUI();
}

function renderLandingStats() {
  const stats = state.stats || {};
  const rated = state.hostels.filter(h => h.status === "verified" && typeof h.rating === "number");
  const fallbackRating = rated.length
    ? rated.reduce((sum, h) => sum + h.rating, 0) / rated.length
    : 0;
  const verifiedCount = stats.verifiedHostels ?? state.hostels.filter(h => h.status === "verified").length;
  const collegeCount = COLLEGES.length;
  const ownerCount = stats.ownerCount ?? state.users.filter(u => u.role === "owner").length;
  const avgRating = stats.averageRating ?? fallbackRating;
  $("#landingStats").innerHTML = `
    <div class="landing-stat-chip"><b data-count="${verifiedCount}">0</b><span>VERIFIED HOSTELS</span></div>
    <div class="landing-stat-chip"><b data-count="${collegeCount}">0</b><span>COLLEGES COVERED</span></div>
    <div class="landing-stat-chip"><b data-count="${ownerCount}">0</b><span>LISTED OWNERS</span></div>
    <div class="landing-stat-chip"><b data-count="${avgRating}" data-decimals="1">0</b><span>AVERAGE RATING</span></div>
  `;
  animateLandingCounters();
}

// Animates each stat chip's number from 0 up to its real (backend-derived)
// value. Purely a presentation layer on top of renderLandingStats() — the
// counted values themselves still come from the scoped state payload, so
// nothing here is hard-coded and no private user records are exposed.
function animateLandingCounters() {
  const nodes = document.querySelectorAll("#landingStats b[data-count]");
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  nodes.forEach((el) => {
    const target = Number(el.dataset.count) || 0;
    const decimals = Number(el.dataset.decimals) || 0;
    if (reduceMotion || !target) { el.textContent = target.toFixed(decimals); return; }
    const duration = 700;
    const start = performance.now();
    function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      const value = target * (1 - Math.pow(1 - progress, 3));
      el.textContent = decimals ? value.toFixed(decimals) : Math.round(value);
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

// Renders a few real, verified listings on the landing page as a marketing
// preview. Guests can already reach the full list via "Browse Hostels" —
// this section just previews it with live data, it never requires login.
function renderLandingPreview() {
  const el = $("#landingPreview");
  if (!el) return;

  const featured = state.hostels
    .filter(h => h.status === "verified" && h.live)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 3);

  if (!featured.length) {
    el.innerHTML = `<div class="l-preview-empty">New verified listings are added regularly — check back soon.</div>`;
    return;
  }

  el.innerHTML = featured.map(h => {
    const amenityChips = (h.amenities || []).slice(0, 3).map(id => {
      const a = amenityLabel(id);
      return a ? `<span>${a.icon} ${esc(a.label)}</span>` : "";
    }).join("");
    return `
      <div class="l-preview-card">
        <div class="l-preview-media">
          ${hostelThumbHTML(h)}
          <span class="l-preview-badge">✓ Verified</span>
          <span class="l-preview-type">${esc(h.type)}</span>
        </div>
        <div class="l-preview-body">
          <div class="l-preview-top">
            <h3>${esc(h.name)}</h3>
            <span class="l-preview-rating">★ ${h.rating.toFixed(1)}</span>
          </div>
          <p class="l-preview-loc">${h.distance} km from college · ${esc(h.college || h.location)}</p>
          <div class="l-preview-amenities">${amenityChips}</div>
          <div class="l-preview-foot">
            <strong>₹${h.rent.toLocaleString("en-IN")}<span>/month</span></strong>
            <button class="btn btn-sm btn-gold" data-action="view-hostel-preview" data-id="${h.id}">View Details</button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

// Clicking a preview card on the landing page sends a guest into the real
// app and opens that hostel's detail view — reuses the existing guest
// browsing + detail-view functionality rather than duplicating it.
function viewHostelFromLanding(id) {
  browseGuest();
  openHostelDetail(id);
}

function toggleMobileNav() {
  const screen = $("#landingScreen");
  const btn = $("#mobileNavToggle");
  const isOpen = screen.classList.toggle("nav-open");
  btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

function closeMobileNav() {
  $("#landingScreen").classList.remove("nav-open");
  const btn = $("#mobileNavToggle");
  if (btn) btn.setAttribute("aria-expanded", "false");
}

// Progressive-enhancement scroll-reveal for the landing page. If
// IntersectionObserver isn't available the .reveal elements are simply
// shown as normal (see the default .reveal CSS rule), so nothing breaks.
function initLandingScrollReveal() {
  const screen = $("#landingScreen");
  if (!("IntersectionObserver" in window)) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  screen.classList.add("js-reveal-ready");
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("in-view");
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  screen.querySelectorAll(".reveal").forEach(node => io.observe(node));
}

function showAuthScreen(portal, mode) {
  // There is no separate admin portal — admins use the same sign-in form
  // as students and owners, regardless of which portal they start from.
  portal = portal === "owner" ? "owner" : "student";
  state.screen = "auth";
  state.activePortal = portal;
  state.authMode = mode;
  $("#authScreen").dataset.bgRole = portal; 
  $("#landingScreen").hidden = true;
  $("#mainApp").hidden = true;
  $("#authScreen").hidden = false;
  const footer = $("#siteFooter");
  if (footer) footer.hidden = true;
  renderAuthCard();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function renderAuthCard() {
  const portal = state.activePortal;
  const copy = PORTAL_COPY[portal];
  const aside = AUTH_ASIDE[portal] || AUTH_ASIDE.student;
  const isSignup = state.authMode === "signup";
  const backLink = `<div class="auth-back-link"><a href="#" data-action="back-to-landing"><span aria-hidden="true">←</span> Back to HostelHub</a></div>`;

  const portalTabs = AUTH_PORTALS.map(({ id, label, icon }) => `
    <button type="button" class="auth-portal-tab${portal === id ? " is-active" : ""}"
      data-action="switch-portal" data-id="${id}" aria-pressed="${portal === id}">
      ${icon}<span>${label}</span>
    </button>`).join("");

  const pendingHostel = state.pendingContactHostelId ? findHostel(state.pendingContactHostelId) : null;
  const pendingNotice = pendingHostel ? `
    <div class="auth-notice">
      <span class="auth-notice-icon" aria-hidden="true">ℹ</span>
      <span>Please log in to contact the owner of <strong>${esc(pendingHostel.name)}</strong>.</span>
    </div>
  ` : "";

  const asidePoints = aside.points.map(point => `
    <li>
      <span class="auth-aside-check" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="m5 12.5 4.2 4.2L19 7"></path>
        </svg>
      </span>
      ${point}
    </li>`).join("");

  const portalSwitcher = `<nav class="auth-portals" aria-label="Choose your portal">${portalTabs}</nav>`;

  let cardHTML;
  if (isSignup) {
    cardHTML = `
      <div class="auth-card">
        ${portalSwitcher}
        <div class="auth-card-head">
          <span class="auth-icon" aria-hidden="true">${copy.icon}</span>
          <div>
            <span class="auth-kicker">New account</span>
            <h1 class="auth-title">${esc(copy.signupTitle)}</h1>
            <p class="auth-subtitle">${esc(copy.signupSubtitle)}</p>
          </div>
        </div>
        ${pendingNotice}

        <div class="field-group auth-field">
          <label for="signupName">Full Name *</label>
          <div class="auth-control">
            <span class="auth-control-icon" aria-hidden="true">${AUTH_ICONS.user}</span>
            <input type="text" id="signupName" placeholder="e.g. Rahul Sharma" autocomplete="name" />
          </div>
        </div>
        <div class="field-group auth-field">
          <label for="signupUsername">Username *</label>
          <div class="auth-control">
            <span class="auth-control-icon" aria-hidden="true">${AUTH_ICONS.at}</span>
            <input type="text" id="signupUsername" placeholder="Choose a username" autocomplete="username" />
          </div>
        </div>
        <div class="field-group auth-field">
          <label for="signupEmail">Email *</label>
          <div class="auth-control">
            <span class="auth-control-icon" aria-hidden="true">${AUTH_ICONS.mail}</span>
            <input type="email" id="signupEmail" placeholder="your@email.com" autocomplete="email" />
          </div>
        </div>
        <div class="field-group auth-field">
          <label for="signupPhone">Phone *</label>
          <div class="auth-control">
            <span class="auth-control-icon" aria-hidden="true">${AUTH_ICONS.phone}</span>
            <input type="tel" id="signupPhone" placeholder="10-digit mobile number" maxlength="10" inputmode="numeric" autocomplete="tel" />
          </div>
        </div>
        <div class="field-group auth-field">
          <label for="signupPassword">Password *</label>
          <div class="auth-control password-field">
            <span class="auth-control-icon" aria-hidden="true">${AUTH_ICONS.lock}</span>
            <input type="password" id="signupPassword" placeholder="Min 8 characters" autocomplete="new-password" aria-describedby="signupStrength" />
            <button type="button" class="eye-btn" data-action="toggle-password" data-id="signupPassword">Show</button>
          </div>
          <p class="auth-caps" hidden aria-live="polite">Caps Lock is on</p>
          <div class="auth-strength" id="signupStrength" hidden aria-live="polite">
            <span class="auth-strength-track"><span class="auth-strength-bar" data-strength-bar data-level="0"></span></span>
            <span class="auth-strength-label" data-strength-label></span>
          </div>
        </div>
        <div class="field-group auth-field">
          <label for="signupConfirm">Confirm Password *</label>
          <div class="auth-control password-field">
            <span class="auth-control-icon" aria-hidden="true">${AUTH_ICONS.lock}</span>
            <input type="password" id="signupConfirm" placeholder="Re-enter password" autocomplete="new-password" aria-describedby="signupMatch" />
            <button type="button" class="eye-btn" data-action="toggle-password" data-id="signupConfirm">Show</button>
          </div>
          <p class="auth-caps" hidden aria-live="polite">Caps Lock is on</p>
          <p class="auth-match" id="signupMatch" hidden aria-live="polite"></p>
        </div>

        <p class="form-error" id="authError" role="alert" hidden></p>
        <button class="btn btn-gold btn-block btn-lg" data-action="signup">Create Account</button>
        <p class="switch-line">Already have an account? <a href="#" data-action="switch-auth-mode" data-id="login">Sign in</a></p>
      </div>`;
  } else {
    cardHTML = `
      <div class="auth-card">
        ${portalSwitcher}
        <div class="auth-card-head">
          <span class="auth-icon" aria-hidden="true">${copy.icon}</span>
          <div>
            <span class="auth-kicker">Secure sign-in</span>
            <h1 class="auth-title">${esc(copy.loginTitle)}</h1>
            <p class="auth-subtitle">${esc(copy.loginSubtitle)}</p>
          </div>
        </div>
        ${pendingNotice}

        <div class="field-group auth-field">
          <label for="loginUsername">Username</label>
          <div class="auth-control">
            <span class="auth-control-icon" aria-hidden="true">${AUTH_ICONS.user}</span>
            <input type="text" id="loginUsername" placeholder="Enter your username" autocomplete="username" />
          </div>
        </div>
        <div class="field-group auth-field">
          <label for="loginPassword">Password</label>
          <div class="auth-control password-field">
            <span class="auth-control-icon" aria-hidden="true">${AUTH_ICONS.lock}</span>
            <input type="password" id="loginPassword" placeholder="Enter your password" autocomplete="current-password" />
            <button type="button" class="eye-btn" data-action="toggle-password" data-id="loginPassword">Show</button>
          </div>
          <p class="auth-caps" hidden aria-live="polite">Caps Lock is on</p>
        </div>

        <p class="form-error" id="authError" role="alert" hidden></p>
        <button class="btn btn-gold btn-block btn-lg" data-action="login">Sign In <span aria-hidden="true">→</span></button>
        ${copy.signupAllowed ? `<p class="switch-line">Don't have an account? <a href="#" data-action="switch-auth-mode" data-id="signup">Create one</a></p><p class="auth-admin-hint">Administrators: sign in through either portal.</p>` : `<div class="auth-portal-note">Administrators can sign in through the Student or Owner portal.</div>`}
      </div>`;
  }

  $("#authCardContainer").innerHTML = `
    <div class="auth-shell auth-shell-${portal}">
      <aside class="auth-aside">
        <div class="auth-aside-brand">
          <span class="auth-aside-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 10.5 12 3l9 7.5"></path>
              <path d="M5.5 9.5V21h13V9.5"></path>
              <path d="M9.5 21v-6h5v6"></path>
            </svg>
          </span>
          <span class="auth-aside-wordmark">Hostel<span>Hub</span></span>
        </div>

        <div class="auth-aside-content">
          <span class="auth-aside-eyebrow"><span class="eyebrow-pulse" aria-hidden="true"></span>${aside.eyebrow}</span>
          <h2 class="auth-aside-title">${aside.title}</h2>
          <p class="auth-aside-text">${aside.text}</p>
          <ul class="auth-aside-points">${asidePoints}</ul>
        </div>

        <div class="auth-aside-stats" aria-label="HostelHub at a glance">
          <div><strong>₹0</strong><span>brokerage</span></div>
          <div><strong>${COLLEGES.length || 9}</strong><span>campuses</span></div>
          <div><strong>24/7</strong><span>access</span></div>
        </div>
      </aside>

      <div class="auth-main">
        ${backLink}
        ${cardHTML}
        <p class="auth-legal">Verified listings · Direct owner contact · Free for students</p>
      </div>
    </div>`;

  enhanceAuthForm();
}

// Adds small, non-blocking form affordances: autofocus, caps-lock warning,
// live password strength and confirm-password matching. None of this changes
// the submit payloads or the existing validation in handleLogin/handleSignup.
function enhanceAuthForm() {
  const isSignup = state.authMode === "signup";
  const focusTarget = isSignup ? $("#signupName") : $("#loginUsername");
  const canAutofocus = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
  if (focusTarget && canAutofocus) {
    requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
  }

  $all(".auth-card .password-field input").forEach(input => {
    const warning = input.closest(".field-group")?.querySelector(".auth-caps");
    if (!warning) return;
    const update = (event) => {
      warning.hidden = !(event.getModifierState && event.getModifierState("CapsLock"));
    };
    input.addEventListener("keydown", update);
    input.addEventListener("keyup", update);
    input.addEventListener("blur", () => { warning.hidden = true; });
  });

  if (!isSignup) return;

  const password = $("#signupPassword");
  const confirm = $("#signupConfirm");
  const strength = $("#signupStrength");
  const bar = strength?.querySelector("[data-strength-bar]");
  const label = strength?.querySelector("[data-strength-label]");
  const match = $("#signupMatch");

  const updateMatch = () => {
    if (!match || !confirm) return;
    const value = confirm.value || "";
    if (!value) { match.hidden = true; return; }
    const matches = value === password.value;
    match.hidden = false;
    match.textContent = matches ? "Passwords match" : "Passwords do not match yet";
    match.dataset.state = matches ? "match" : "mismatch";
  };

  const updateStrength = () => {
    if (!password || !strength) return;
    const value = password.value || "";
    if (!value) {
      strength.hidden = true;
      if (bar) { bar.style.width = "0%"; bar.dataset.level = "0"; }
      if (label) label.textContent = "";
      updateMatch();
      return;
    }

    let score = 0;
    if (value.length >= 8) score++;
    if (value.length >= 12) score++;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
    if (/\d/.test(value)) score++;
    if (/[^A-Za-z0-9]/.test(value)) score++;
    score = Math.min(score, 4);
    if (value.length < 8) score = 0;

    const levels = ["Too short", "Weak", "Fair", "Good", "Strong"];
    strength.hidden = false;
    if (bar) {
      bar.style.width = `${score * 25}%`;
      bar.dataset.level = String(score);
    }
    if (label) {
      label.textContent = levels[score];
      label.dataset.level = String(score);
    }
    updateMatch();
  };

  password?.addEventListener("input", updateStrength);
  confirm?.addEventListener("input", updateMatch);
}

function switchAuthMode(mode) {
  state.authMode = mode;
  renderAuthCard();
}

function togglePassword(btn) {
  const input = document.getElementById(btn.dataset.id);
  if (!input) return;
  const isHidden = input.type === "password";
  input.type = isHidden ? "text" : "password";
  btn.textContent = isHidden ? "Hide" : "Show";
}

function goLandingLogin() { showAuthScreen("student", "login"); }
function goLandingSignup() { showAuthScreen("student", "signup"); }
function goOwnerPortal() { showAuthScreen("owner", "login"); }

function browseGuest() {
  state.currentUser = null;
  state.guestBrowsing = true;
  state.activePortal = "student";
  enterApp();
}

async function handleLogin() {
  const username = $("#loginUsername").value.trim();
  const password = $("#loginPassword").value;
  const errorEl = $("#authError");
  errorEl.hidden = true;

  if (!username || !password) {
    errorEl.innerHTML = "Please enter both username and password.";
    errorEl.hidden = false;
    return;
  }

  let data;
  try {
    // The admin account signs in through whichever portal is on screen —
    // the backend accepts its credentials regardless of `portal`.
    data = await api("/auth/login", { method: "POST", body: { username, password, portal: state.activePortal } });
  } catch (err) {
    if (err.status === 409) {
      // wrong portal for this (non-admin) account — offer to redirect
      const guessRole = state.activePortal === "student" ? "owner" : "student";
      errorEl.innerHTML = esc(err.message) + ` <a href="#" data-action="switch-portal" data-id="${guessRole}">Switch portal →</a>`;
    } else {
      errorEl.textContent = err.message;
    }
    errorEl.hidden = false;
    return;
  }

  await refreshState();
  state.currentUser = data.user;
  state.guestBrowsing = false;
  enterApp();
  if (state.pendingContactHostelId) resumeAfterAuth();
}

async function handleSignup() {
  const name = $("#signupName").value.trim();
  const username = $("#signupUsername").value.trim();
  const email = $("#signupEmail").value.trim();
  const phone = $("#signupPhone").value.trim();
  const password = $("#signupPassword").value;
  const confirm = $("#signupConfirm").value;
  const errorEl = $("#authError");
  errorEl.hidden = true;

  if (!name || !username || !email || !phone || !password || !confirm) {
    errorEl.textContent = "Please fill in all required fields (marked *).";
    errorEl.hidden = false;
    return;
  }
  if (!isValidEmail(email)) {
    errorEl.textContent = "Please enter a valid email address (e.g. name@example.com).";
    errorEl.hidden = false;
    return;
  }
  if (!isValidPhone(phone)) {
    errorEl.textContent = "Phone number must be exactly 10 digits, with no letters or symbols.";
    errorEl.hidden = false;
    return;
  }
  if (password.length < 8) {
    errorEl.textContent = "Password must be at least 8 characters.";
    errorEl.hidden = false;
    return;
  }
  if (password !== confirm) {
    errorEl.textContent = "Passwords do not match.";
    errorEl.hidden = false;
    return;
  }

  let data;
  try {
    data = await api("/auth/signup", {
      method: "POST",
      body: { name, username, email, phone, password, confirm, role: state.activePortal }
    });
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
    return;
  }

  await refreshState();
  state.currentUser = data.user;
  state.guestBrowsing = false;
  const hadPendingContact = !!state.pendingContactHostelId;
  if (!hadPendingContact) showToast(`Welcome to HostelHub, ${name.split(" ")[0]}!`, "success");
  enterApp();
  if (hadPendingContact) resumeAfterAuth();
}

function switchPortal(role) {
  const nextMode = role === "admin" ? "login" : state.authMode;
  showAuthScreen(role, nextMode);
}

async function logout() {
  try { await api("/auth/logout", { method: "POST" }); } catch (e) { /* ignore */ }
  state.currentUser = null;
  state.guestBrowsing = false;
  state.pendingContactHostelId = null;
  state.pendingContactAction = null;
  showLandingScreen();
}

/* ---------------------- App shell / routing ---------------------- */

const NAV_CONFIG = {
  student: [
    { id: "find", label: "Find Hostels", icon: "🔎" },
    { id: "saved", label: "Saved", icon: "❤️" },
    { id: "inquiries", label: "My Inquiries", icon: "💬" },
    { id: "profile", label: "Profile", icon: "👤" }
  ],
  owner: [
    { id: "listings", label: "Dashboard", icon: "🖥️" },
    { id: "inquiries", label: "Inquiries", icon: "💬" },
    { id: "profile", label: "Profile", icon: "👤" }
  ],
  admin: [
    { id: "panel", label: "Admin Panel", icon: "🛡️" },
    { id: "profile", label: "Profile", icon: "👤" }
  ]
};

function enterApp() {
  state.screen = "app";
  $("#landingScreen").hidden = true;
  $("#authScreen").hidden = true;
  $("#mainApp").hidden = false;
  const footer = $("#siteFooter");
  if (footer) footer.hidden = false;

  const user = state.currentUser;
  const portal = state.guestBrowsing ? "student" : user.role;
  $("#mainApp").dataset.bgRole = portal;
  $("#navLogo").textContent = PORTAL_COPY[portal].wordmark;
  $("#navRoleTag").textContent = state.guestBrowsing ? "Guest" : (user.role[0].toUpperCase() + user.role.slice(1));

  buildNav();
  closeAppMobileNav();
  renderNavRight();

  if (portal === "student") navigate("find");
  else if (portal === "owner") navigate("listings");
  else navigate("panel");
}

function currentRole() {
  return state.guestBrowsing ? "student" : (state.currentUser ? state.currentUser.role : "student");
}

function toggleAppMobileNav() {
  const menu = document.getElementById("appMobileMenu");
  const tabs = document.getElementById("navTabs");
  if (!menu || !tabs) return;

  const isOpen = tabs.classList.toggle("mobile-menu-open");
  menu.setAttribute("aria-expanded", String(isOpen));
  menu.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
  menu.textContent = isOpen ? "✕" : "☰";
}

function closeAppMobileNav() {
  const menu = document.getElementById("appMobileMenu");
  const tabs = document.getElementById("navTabs");
  if (!menu || !tabs) return;

  tabs.classList.remove("mobile-menu-open");
  menu.setAttribute("aria-expanded", "false");
  menu.setAttribute("aria-label", "Open navigation menu");
  menu.textContent = "☰";
}

function buildNav() {
  const role = currentRole();
  const tabs = NAV_CONFIG[role].filter(t => !(state.guestBrowsing && (t.id === "inquiries" || t.id === "profile")));
  const container = $("#navTabs");
  container.innerHTML = tabs.map(t => {
    let badge = "";
    if (role === "owner" && t.id === "inquiries" && state.currentUser) {
      const pending = inquiriesForOwner(state.currentUser.id).filter(i => i.status === "pending").length;
      if (pending) badge = `<span class="nav-badge">${pending}</span>`;
    }
    if (role === "student" && t.id === "inquiries" && state.currentUser) {
      const count = inquiriesForStudent(state.currentUser.id).length;
      if (count) badge = `<span class="nav-badge">${count}</span>`;
    }
    return `<button class="nav-tab" data-action="nav" data-view="${t.id}">${t.icon} ${t.label} ${badge}</button>`;
  }).join("");
}

function renderNavRight() {
  const container = $("#navRight");
  const themeIcon = document.body.classList.contains("light-theme") ? "🌙" : "☀️";

  if (state.guestBrowsing) {
    container.innerHTML = `
      <button class="icon-btn" data-action="toggle-theme" title="Toggle theme">${themeIcon}</button>
      <span class="guest-chip">👤 Browsing as guest</span>
      <button class="btn btn-gold btn-sm" data-action="go-landing-login">Log In</button>
    `;
    syncThemeUI();
    return;
  }

  const user = state.currentUser;
  container.innerHTML = `
    <button class="icon-btn" data-action="toggle-theme" title="Toggle theme">${themeIcon}</button>
    <div class="user-chip">
      <span class="avatar">${initials(user.name)}</span>
      <span class="user-name">${esc(user.name)}</span>
    </div>
    <button class="icon-btn" data-action="logout" title="Sign out">⏻</button>
  `;
  syncThemeUI();
}

function setActiveNavTab(view) {
  $all(".nav-tab").forEach(b => b.classList.toggle("active", b.dataset.view === view));
}

function navigate(view) {
  const role = currentRole();
  setActiveNavTab(view);

  if (view === "profile") {
    renderProfileView();
    buildNav();
    setActiveNavTab(view);
    return;
  }

  if (role === "student") {
    state.studentSubtab = view === "inquiries" ? "inquiries" : (view === "saved" ? "saved" : "find");
    renderStudentView();
  } else if (role === "owner") {
    state.ownerSubtab = view === "inquiries" ? "inquiries" : (state.ownerSubtab === "inquiries" ? "listings" : state.ownerSubtab);
    renderOwnerView();
  } else {
    renderAdminView();
  }
  buildNav();
  setActiveNavTab(view);
}

function syncThemeUI() {
  const isLight = document.body.classList.contains("light-theme");
  document.documentElement.style.colorScheme = isLight ? "light" : "dark";

  $all('[data-action="toggle-theme"]').forEach(btn => {
    const label = isLight ? "Switch to dark theme" : "Switch to light theme";
    btn.textContent = isLight ? "🌙" : "☀️";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-pressed", isLight ? "true" : "false");
  });

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", isLight ? "#f7f4ed" : "#070a12");
}

function toggleTheme() {
  document.body.classList.toggle("light-theme");
  const isLight = document.body.classList.contains("light-theme");
  try { localStorage.setItem("hostelhub_theme", isLight ? "light" : "dark"); } catch (_) {}
  syncThemeUI();
}

/* ---------------------- Shared components ---------------------- */

function amenityChips(amenityIds, extraClass = "") {
  return amenityIds.map(id => {
    const a = amenityLabel(id);
    return a ? `<span class="amenity-chip ${extraClass}">${a.icon} ${a.label}</span>` : "";
  }).join("");
}

function statusBadge(status) {
  if (status === "verified") return `<span class="badge badge-green">Verified</span>`;
  if (status === "pending") return `<span class="badge badge-gold">Pending</span>`;
  return `<span class="badge badge-gray">${esc(status)}</span>`;
}

function hostelThumbHTML(hostel, sizeClass) {
  const typeIcon = hostel.type === "Boys Hostel" ? "🏠" : hostel.type === "Girls Hostel" ? "🏡" : "🛏️";
  return hostel.image
    ? `<img src="${esc(hostel.image)}" alt="${esc(hostel.name)}" loading="lazy" />`
    : typeIcon;
}

/* ---------------------- STUDENT VIEW ---------------------- */

function renderStudentView() {
  const root = $("#viewRoot");
  if (state.studentSubtab === "inquiries") {
    root.innerHTML = studentInquiriesHTML();
    return;
  }
  if (state.studentSubtab === "saved") {
    root.innerHTML = studentSavedHTML();
    return;
  }
  root.innerHTML = studentFindHTML();
}

function studentSavedHTML() {
  const savedList = state.hostels.filter(h => (state.wishlist || []).includes(h.id));
  const cards = savedList.map(h => hostelCardHTML(h)).join("") || `
    <div class="empty-state" style="grid-column:1/-1;">
      <div class="empty-icon">❤️</div>
      <div class="empty-title">No saved hostels yet</div>
      <div>Click the heart icon on any hostel card to save it here for quick access.</div>
    </div>`;

  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">Saved Hostels</h1>
        <p class="page-subtitle">Your bookmarked hostels and PGs, all in one place.</p>
      </div>
    </div>
    <div class="step-eyebrow">${savedList.length} saved hostel${savedList.length === 1 ? "" : "s"}</div>
    <div class="card-grid" style="margin-bottom:40px;">${cards}</div>
  `;
}

function studentFindHTML() {
  const TYPE_FILTERS = [
    { id: "all", label: "All Hostels" },
    { id: "Boys Hostel", label: "Boys Hostel" },
    { id: "Girls Hostel", label: "Girls Hostel" },
    { id: "PG/Rooms", label: "PG/Rooms" }
  ];

  let results = state.hostels.filter(h => h.status === "verified" && h.live);

  if (state.typeFilter !== "all") {
    results = results.filter(h => h.type === state.typeFilter);
  }
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    results = results.filter(h =>
      h.name.toLowerCase().includes(q) ||
      h.location.toLowerCase().includes(q) ||
      h.type.toLowerCase().includes(q) ||
      String(h.college || "").toLowerCase().includes(q)
    );
  }
  results = results.slice().sort((a, b) => b.rating - a.rating || b.views - a.views);

  const cards = results.map(h => hostelCardHTML(h)).join("") || `
    <div class="empty-state" style="grid-column:1/-1;">
      <div class="empty-icon">🏘️</div>
      <div class="empty-title">No hostels match your search</div>
      <div>Try a different keyword or filter.</div>
    </div>`;

  const compareTray = state.compareSelection.length >= 2 ? `
    <div class="compare-tray">
      <span><strong>${state.compareSelection.length}</strong> hostel${state.compareSelection.length > 1 ? "s" : ""} selected</span>
      <button class="btn btn-gold btn-sm" data-action="compare-now">Compare Now</button>
    </div>` : "";

  const chips = TYPE_FILTERS.map(f => `
    <button class="type-filter-chip ${state.typeFilter === f.id ? "active" : ""}" data-action="filter-type" data-id="${esc(f.id)}">${esc(f.label)}</button>
  `).join("");

  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">Find Your Hostel</h1>
        <p class="page-subtitle">Browse verified hostels, filter by type, and compare before you commit.</p>
      </div>
    </div>

    <div class="search-panel">
      <div>
        <div class="step-eyebrow">Search</div>
        <label for="hostelSearchInput">Filter by name, area or type</label>
        <input type="text" id="hostelSearchInput" placeholder="e.g. girls hostel, market street" value="${esc(state.searchQuery)}" />
      </div>
      <div>
        <button class="btn btn-gold" data-action="run-search">Search</button>
      </div>
    </div>

    <div class="type-filter-row">${chips}</div>

    <div class="step-eyebrow">${results.length} hostel${results.length === 1 ? "" : "s"} found</div>
    <div class="card-grid" style="margin-bottom:40px;">${cards}</div>
    ${compareTray}
  `;
}

function hostelCardHTML(h) {
  const checked = state.compareSelection.includes(h.id) ? "checked" : "";
  const isSaved = (state.wishlist || []).includes(h.id);
  const ratingStr = typeof h.rating === "number" ? h.rating.toFixed(1) : (h.rating || "4.0");
  const amenityStrip = (h.amenities || []).slice(0, 3).map(id => {
    const a = amenityLabel(id);
    return a ? `<span class="hostel-amenity">${a.icon} ${esc(a.label)}</span>` : "";
  }).join("");
  return `
    <div class="hostel-card">
      <div class="hostel-thumb" style="position:relative;">
        <span class="thumb-badge type-chip">${esc(h.type)}</span>
        <button class="thumb-wishlist ${isSaved ? "is-saved" : ""}" data-action="toggle-wishlist" data-id="${h.id}" title="${isSaved ? "Saved to wishlist" : "Save to wishlist"}">${isSaved ? "❤️" : "🤍"}</button>
        ${hostelThumbHTML(h)}
      </div>
      <div class="hostel-body">
        <h3 class="hostel-name">${esc(h.name)}</h3>
        <div class="hostel-meta">📍 ${esc(h.location)} · ${h.distance}km away</div>
        ${amenityStrip ? `<div class="hostel-amenities">${amenityStrip}</div>` : ""}
        <div class="hostel-rent">${currency(h.rent)}<span> /month</span></div>
        <div class="hostel-foot">
          <span class="rating">★ ${ratingStr}</span>
          <label class="compare-check"><input type="checkbox" data-action="toggle-compare" data-id="${h.id}" ${checked} /> Compare</label>
        </div>
        <button class="btn btn-block btn-sm" data-action="view-hostel" data-id="${h.id}">View Details</button>
      </div>
    </div>`;
}

function studentInquiriesHTML() {
  const mine = inquiriesForStudent(state.currentUser.id).slice().sort((a, b) => b.date.localeCompare(a.date));
  const rows = mine.map(i => {
    const h = findHostel(i.hostelId);
    return `
      <tr>
        <td>
          <div class="cell-property">
            <div class="cell-thumb">${hostelThumbHTML(h)}</div>
            <div><div class="cell-title">${esc(h.name)}</div><div class="cell-sub">${esc(h.location)}</div></div>
          </div>
        </td>
        <td>${esc(i.message)}</td>
        <td>${formatDate(i.date)}</td>
        <td>${i.status === "pending" ? `<span class="badge badge-gold">Pending</span>` : `<span class="badge badge-green">Responded</span>`}</td>
      </tr>`;
  }).join("");

  const body = mine.length ? `
    <div class="table-wrap" tabindex="0" role="region" aria-label="Data table">
      <table>
        <thead><tr><th>Hostel</th><th>Your message</th><th>Sent</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>` : `
    <div class="empty-state">
      <div class="empty-icon">💬</div>
      <div class="empty-title">No inquiries yet</div>
      <div>Contact a hostel owner from the hostel details page to see it here.</div>
    </div>`;

  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">My Inquiries</h1>
        <p class="page-subtitle">Messages you've sent to hostel owners, and whether they've responded.</p>
      </div>
    </div>
    ${body}
  `;
}

function toggleCompare(id) {
  id = Number(id);
  const idx = state.compareSelection.indexOf(id);
  if (idx > -1) {
    state.compareSelection.splice(idx, 1);
  } else {
    if (state.compareSelection.length >= 3) {
      showToast("You can compare up to 3 hostels at a time.", "error");
      renderStudentView();
      return;
    }
    state.compareSelection.push(id);
  }
  renderStudentView();
}

function runSearch() {
  state.searchQuery = $("#hostelSearchInput").value.trim();
  renderStudentView();
}

function filterByType(typeId) {
  state.typeFilter = typeId;
  renderStudentView();
}

/* ---------------------- Profile (all roles) ---------------------- */

function renderProfileView() {
  const u = state.currentUser;
  const root = $("#viewRoot");
  if (!u) { root.innerHTML = `<div class="empty-state"><div class="empty-title">Not signed in</div></div>`; return; }

  const roleLabel = u.role[0].toUpperCase() + u.role.slice(1);

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">My Profile</h1>
        <p class="page-subtitle">Manage your account details and password.</p>
      </div>
    </div>

    <div class="profile-grid">
      <div class="profile-card">
        <h3>Account details</h3>
        <div class="profile-readonly-row"><span>Username</span><span>${esc(u.username)}</span></div>
        <div class="profile-readonly-row"><span>Role</span><span>${esc(roleLabel)}</span></div>
        <div class="profile-readonly-row"><span>Joined</span><span>${formatDate(u.joined)}</span></div>
        <div class="profile-readonly-row"><span>Status</span><span>${u.status === "active" ? "Active" : "Inactive"}</span></div>

        <div class="field-group" style="margin-top:18px;"><label for="profileName">Full Name</label><input type="text" id="profileName" value="${esc(u.name)}" /></div>
        <div class="field-group"><label for="profileEmail">Email *</label><input type="email" id="profileEmail" value="${esc(u.email || "")}" /></div>
        <div class="field-group"><label for="profilePhone">Phone *</label><input type="tel" id="profilePhone" value="${esc(u.phone || "")}" maxlength="10" inputmode="numeric" /></div>
        <p class="form-error" id="profileError" hidden></p>
        <button class="btn btn-gold" data-action="save-profile">Save Changes</button>
      </div>

      <div class="profile-card">
        <h3>Change password</h3>
        <div class="field-group"><label for="profileCurrentPassword">Current Password</label>
          <div class="password-field"><input type="password" id="profileCurrentPassword" placeholder="Current password" /><button type="button" class="eye-btn" data-action="toggle-password" data-id="profileCurrentPassword">Show</button></div>
        </div>
        <div class="field-group"><label for="profileNewPassword">New Password</label>
          <div class="password-field"><input type="password" id="profileNewPassword" placeholder="Min 8 characters" /><button type="button" class="eye-btn" data-action="toggle-password" data-id="profileNewPassword">Show</button></div>
        </div>
        <div class="field-group"><label for="profileNewConfirm">Confirm New Password</label>
          <div class="password-field"><input type="password" id="profileNewConfirm" placeholder="Re-enter new password" /><button type="button" class="eye-btn" data-action="toggle-password" data-id="profileNewConfirm">Show</button></div>
        </div>
        <p class="form-error" id="passwordError" hidden></p>
        <button class="btn" data-action="save-password">Update Password</button>
      </div>
    </div>
  `;
}

async function saveProfile() {
  const name = $("#profileName").value.trim();
  const email = $("#profileEmail").value.trim();
  const phone = $("#profilePhone").value.trim();
  const errorEl = $("#profileError");
  errorEl.hidden = true;

  if (!name || !email || !phone) {
    errorEl.textContent = "Name, email and phone are required.";
    errorEl.hidden = false;
    return;
  }
  if (!isValidEmail(email)) {
    errorEl.textContent = "Please enter a valid email address (e.g. name@example.com).";
    errorEl.hidden = false;
    return;
  }
  if (!isValidPhone(phone)) {
    errorEl.textContent = "Phone number must be exactly 10 digits, with no letters or symbols.";
    errorEl.hidden = false;
    return;
  }

  let data;
  try {
    data = await api("/auth/profile", { method: "PUT", body: { name, email, phone } });
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
    return;
  }
  await refreshState();
  state.currentUser = data.user;
  renderNavRight();
  showToast("Profile updated.", "success");
  renderProfileView();
}

async function savePassword() {
  const currentPassword = $("#profileCurrentPassword").value;
  const newPassword = $("#profileNewPassword").value;
  const confirm = $("#profileNewConfirm").value;
  const errorEl = $("#passwordError");
  errorEl.hidden = true;

  if (!currentPassword || !newPassword || !confirm) {
    errorEl.textContent = "Please fill in all three password fields.";
    errorEl.hidden = false;
    return;
  }
  if (newPassword.length < 8) {
    errorEl.textContent = "New password must be at least 8 characters.";
    errorEl.hidden = false;
    return;
  }
  if (newPassword !== confirm) {
    errorEl.textContent = "New passwords do not match.";
    errorEl.hidden = false;
    return;
  }

  try {
    await api("/auth/password", { method: "PUT", body: { currentPassword, newPassword } });
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
    return;
  }
  showToast("Password updated.", "success");
  renderProfileView();
}

/* ---------------------- Modals: hostel detail & compare ---------------------- */

let lastFocusedElement = null;

function modalFocusableElements() {
  const modal = $("#modalBody");
  if (!modal) return [];
  return Array.from(modal.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(el => el.getClientRects().length > 0);
}

function openModal(html, extraClass) {
  const overlay = $("#modalOverlay");
  const body = $("#modalBody");
  const wasClosed = overlay.hidden;
  if (wasClosed) lastFocusedElement = document.activeElement;

  body.className = "modal" + (extraClass ? " " + extraClass : "");
  body.innerHTML = html;
  overlay.hidden = false;
  document.body.classList.add("modal-open");

  const title = body.querySelector(".modal-title");
  if (title) {
    title.id = title.id || "modalTitle";
    body.setAttribute("aria-labelledby", title.id);
    body.removeAttribute("aria-label");
  } else {
    body.removeAttribute("aria-labelledby");
    body.setAttribute("aria-label", "Dialog");
  }

  body.querySelectorAll(".modal-close").forEach(button => {
    if (!button.getAttribute("aria-label")) button.setAttribute("aria-label", "Close dialog");
  });

  window.requestAnimationFrame(() => {
    const target = body.querySelector("[autofocus]") || modalFocusableElements()[0] || body;
    target.focus();
  });
}

function closeModal() {
  const overlay = $("#modalOverlay");
  if (!overlay) return;
  const wasOpen = !overlay.hidden;
  overlay.hidden = true;
  $("#modalBody").innerHTML = "";
  document.body.classList.remove("modal-open");
  state.editingHostelId = null;
  state.listingImageData = null;

  if (wasOpen && lastFocusedElement && document.contains(lastFocusedElement)) {
    lastFocusedElement.focus();
  }
  lastFocusedElement = null;
}

function openHostelDetail(id) {
  const h = findHostel(id);
  if (!h) return;
  const owner = findUser(h.ownerId) || { name: h.ownerName || "Property Owner", phone: h.ownerPhone || "" };
  const amenities = amenityChips(h.amenities);
  const ownerPhone = h.ownerPhone || (owner ? owner.phone : "");
  const cleanPhone = String(ownerPhone || "").replace(/\D/g, "");
  const ratingStr = typeof h.rating === "number" ? h.rating.toFixed(1) : (h.rating || "4.0");

  openModal(`
    <div class="modal-header">
      <h2 class="modal-title">${esc(h.name)}</h2>
      <button class="modal-close" data-action="close-modal">✕</button>
    </div>
    <div class="detail-hero">${hostelThumbHTML(h)}</div>
    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:10px;">
      <span class="type-chip">${esc(h.type)}</span>
      ${statusBadge(h.status)}
      <span class="rating detail-header-rating">★ ${ratingStr} rating</span>
      <span class="badge detail-meta-badge detail-meta-food">🍲 ${esc(h.foodType || "Veg & Non-Veg")}</span>
      <span class="badge detail-meta-badge detail-meta-curfew">⏰ Curfew: ${esc(h.curfew || "10:00 PM")}</span>
    </div>
    <div class="detail-stats">
      <div class="detail-stat"><b>${currency(h.rent)}</b><span>PER MONTH</span></div>
      <div class="detail-stat"><b>${h.distance}km</b><span>FROM COLLEGE</span></div>
      <div class="detail-stat"><b>${h.rooms}</b><span>TOTAL ROOMS</span></div>
      <div class="detail-stat"><b>${h.views}</b><span>VIEWS</span></div>
    </div>
    <p style="color:var(--text-dim); font-size:13.5px; line-height:1.6;">${esc(h.description)}</p>

    <div class="section-label">Amenities & facilities</div>
    <div class="amenity-chip-list">${amenities || '<span class="amenity-chip">No amenities listed</span>'}</div>

    <div class="section-label">Owner contact & Quick Connect</div>
    <div class="owner-card" id="ownerContactBox">
      <div style="font-weight:700; margin-bottom:4px;">${esc(owner.name)}</div>
      <div style="font-size:12.5px; color:var(--text-faint);">Connect directly with the property manager to verify room vacancy and book a visit.</div>
      <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; align-items:center;">
        <button class="btn btn-gold btn-sm" data-action="contact-owner" data-id="${h.id}">📩 Send App Inquiry</button>
        ${cleanPhone ? `
          <button type="button" class="btn btn-whatsapp btn-sm" data-action="contact-whatsapp" data-id="${h.id}" style="text-decoration:none;">
            <span>💬</span> WhatsApp
          </button>
          <button type="button" class="btn btn-sm btn-outline" data-action="contact-call" data-id="${h.id}" style="display:inline-flex; align-items:center; gap:6px; text-decoration:none;">
            <span>📞</span> Call
          </button>
        ` : ''}
      </div>
    </div>

    <div class="section-label">Location</div>
    <div
      class="map-box"
      id="hostelDetailMap"
      data-latitude="${h.latitude ?? ''}"
      data-longitude="${h.longitude ?? ''}"
    ></div>
    <p style="color:var(--text-dim); font-size:12.5px; margin-top:6px;">${esc(h.location)} · ${h.distance}km from ${esc(h.college)}</p>

    <div class="section-label" style="display:flex; justify-content:space-between; align-items:center; margin-top:24px;">
      <span>Verified Student Reviews</span>
      <span id="detailReviewCount" style="font-size:12px; color:var(--text-dim);">Loading reviews...</span>
    </div>
    <div id="hostelReviewsContainer" class="reviews-container">
      <div style="font-size:12px; color:var(--text-faint);">Loading reviews...</div>
    </div>

    ${state.currentUser && state.currentUser.role === 'student' ? `
      <div class="add-review-box">
        <div style="font-weight:600; font-size:13px; margin-bottom:8px;">Leave a Review & Rating</div>
        <div class="star-rating-picker" id="reviewStarPicker" style="display:flex; gap:6px; margin-bottom:10px; font-size:22px;">
          <span data-star="1">★</span><span data-star="2">★</span><span data-star="3">★</span><span data-star="4">★</span><span data-star="5">★</span>
        </div>
        <input type="hidden" id="selectedReviewRating" value="5" />
        <textarea id="reviewCommentInput" class="input" rows="2" placeholder="Share your experience (cleanliness, food, environment, WiFi)..." style="width:100%; resize:vertical; font-size:13px; margin-bottom:8px;"></textarea>
        <button class="btn btn-gold btn-sm" data-action="submit-review" data-id="${h.id}">Submit Review</button>
      </div>
    ` : (!state.currentUser ? `
      <div style="font-size:12.5px; color:var(--text-faint); margin-top:10px;">
        <a href="#" data-action="go-landing-login" style="color:var(--gold);">Log in as a student</a> to leave a review.
      </div>
    ` : '')}
  `, "modal-wide");
  initializeHostelDetailMap(h);
  loadHostelReviews(h.id);
}

/* ---------------------- Hostel detail map ---------------------- */
function createRouteEndpointMarker(label, tone, labelSide) {
  const element = document.createElement("div");
  element.className =
    `route-endpoint route-endpoint-${tone} route-endpoint-label-${labelSide}`;
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", label.replace(" · ", ", "));
  element.title = label;

  const pin = document.createElement("span");
  pin.className = "route-endpoint-pin";
  pin.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.className = "route-endpoint-label";
  text.textContent = label;

  element.append(pin, text);
  return element;
}

function initializeHostelDetailMap(hostel) {
  const mapElement = document.getElementById("hostelDetailMap");

  if (!mapElement) return;

  // Prevent duplicate map initialization.
  if (window.hostelHubDetailMap) {
    window.hostelHubDetailMap.remove();
    window.hostelHubDetailMap = null;
  }

  if (typeof maplibregl === "undefined") {
    mapElement.textContent = "Map could not load. Please refresh the page.";
    return;
  }

  const latitude = Number(hostel.latitude);
  const longitude = Number(hostel.longitude);

  // Do not display a misleading map if coordinates are missing or invalid.
  if (
    hostel.latitude == null ||
    hostel.longitude == null ||
    hostel.latitude === "" ||
    hostel.longitude === "" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    mapElement.textContent =
      "Location coordinates are not available for this hostel yet.";
    return;
  }

  const map = new maplibregl.Map({
    container: mapElement,
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [longitude, latitude],
    zoom: 15
  });

  map.addControl(new maplibregl.NavigationControl(), "top-right");

  const marker = new maplibregl.Marker()
    .setLngLat([longitude, latitude])
    .setPopup(
      new maplibregl.Popup({ offset: 25 })
        .setText(hostel.name || "Hostel location")
    )
    .addTo(map);

  map.on("load", () => {
    map.resize();
  });

  map.on("error", () => {
    console.error("Hostel detail map encountered a loading error.");
  });

// Directions controls, displayed below the MapLibre map.
const directionsPanel = document.createElement("div");
directionsPanel.className = "detail-directions";
directionsPanel.innerHTML = `
  <button type="button" class="btn btn-gold btn-sm"
          id="hostelDirectionsButton">
    📍 Get Directions from My Location
  </button>
  <p class="map-status" id="hostelDirectionsStatus" role="status">
    Allow location access to show your route on the map.
  </p>
`;
mapElement.insertAdjacentElement("afterend", directionsPanel);

const directionsButton =
  directionsPanel.querySelector("#hostelDirectionsButton");
const directionsStatus =
  directionsPanel.querySelector("#hostelDirectionsStatus");

let routeStartMarker = null;
let routeDestinationMarker = null;

directionsButton.addEventListener("click", () => {
  if (!navigator.geolocation) {
    directionsStatus.textContent =
      "Your browser does not support location access.";
    return;
  }

  directionsButton.disabled = true;
  directionsStatus.textContent = "Finding your location…";

  navigator.geolocation.getCurrentPosition(async (position) => {
    const originLat = position.coords.latitude;
    const originLon = position.coords.longitude;

    directionsStatus.textContent = "Calculating route…";

    try {
      const url =
        "https://router.project-osrm.org/route/v1/driving/" +
        `${originLon},${originLat};${longitude},${latitude}` +
        "?overview=full&geometries=geojson&steps=true";

      const response = await fetch(url);
      if (!response.ok) throw new Error("Routing service unavailable.");

      const data = await response.json();
      if (data.code !== "Ok" || !data.routes?.length) {
        throw new Error("No driving route was found.");
      }

      const route = data.routes[0];
      const sourceId = "hostel-detail-route";
      const layerId = "hostel-detail-route-line";

      // Remove the previous route if directions are requested again.
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);

      map.addSource(sourceId, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: route.geometry
        }
      });

      map.addLayer({
        id: layerId,
        type: "line",
        source: sourceId,
        layout: {
          "line-join": "round",
          "line-cap": "round"
        },
        paint: {
          "line-color": "#2563eb",
          "line-width": 6,
          "line-opacity": 0.9
        }
      });

      // Keep only the latest pair of route markers. The hostel marker is
      // replaced by the labelled destination marker while a route is shown.
      if (routeStartMarker) {
        routeStartMarker.remove();
        routeStartMarker = null;
      }
      if (routeDestinationMarker) {
        routeDestinationMarker.remove();
        routeDestinationMarker = null;
      }
      marker.remove();

      const startIsWest = originLon <= longitude;

      routeStartMarker = new maplibregl.Marker({
        element: createRouteEndpointMarker(
          "A · START",
          "start",
          startIsWest ? "left" : "right"
        ),
        anchor: "bottom"
      })
        .setLngLat([originLon, originLat])
        .setPopup(
          new maplibregl.Popup({ offset: 30 })
            .setText("A · Start · Your location")
        )
        .addTo(map);

      routeDestinationMarker = new maplibregl.Marker({
        element: createRouteEndpointMarker(
          "B · DESTINATION",
          "destination",
          startIsWest ? "right" : "left"
        ),
        anchor: "bottom"
      })
        .setLngLat([longitude, latitude])
        .setPopup(
          new maplibregl.Popup({ offset: 30 })
            .setText(hostel.name || "B · Destination")
        )
        .addTo(map);

      // Include the route line and both endpoints in the viewport.
      const bounds = new maplibregl.LngLatBounds(
        [originLon, originLat],
        [originLon, originLat]
      );
      bounds.extend([longitude, latitude]);
      route.geometry.coordinates.forEach(point => bounds.extend(point));

      const isCompactMap = window.innerWidth <= 600;
      const verticalPadding = isCompactMap ? 64 : 56;
      const padding = {
        top: verticalPadding,
        bottom: verticalPadding,
        left: 64,
        right: 64
      };

      if (!isCompactMap) {
        // Side-mounted labels need extra room at the route edges.
        const startLabelWidth =
          routeStartMarker
            .getElement()
            .querySelector(".route-endpoint-label")
            ?.getBoundingClientRect().width || 80;
        const destinationLabelWidth =
          routeDestinationMarker
            .getElement()
            .querySelector(".route-endpoint-label")
            ?.getBoundingClientRect().width || 120;
        const startOverhang = Math.ceil(startLabelWidth) + 16;
        const destinationOverhang = Math.ceil(destinationLabelWidth) + 16;

        padding.left = (startIsWest ? startOverhang : destinationOverhang) + 8;
        padding.right = (startIsWest ? destinationOverhang : startOverhang) + 8;
      }

      map.fitBounds(bounds, {
        padding,
        maxZoom: 15,
        duration: 700
      });

      const km = (route.distance / 1000).toFixed(1);
      const minutes = Math.round(route.duration / 60);

      directionsStatus.textContent =
        `Route shown on map · ${km} km · about ${minutes} min by car. ` +
        "Routing: OSRM / OpenStreetMap.";

    } catch (error) {
      directionsStatus.textContent =
        error.message || "Could not calculate directions.";
    } finally {
      directionsButton.disabled = false;
    }
  }, (error) => {
    directionsStatus.textContent =
      error.code === 1
        ? "Location access denied. Allow it in your browser settings and retry."
        : "Could not find your location. Check your device location settings.";
    directionsButton.disabled = false;
  }, {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 60000
  });
});

window.hostelHubDetailMap = map;
}

function getOwnerPhoneForHostel(hostelId) {
  const h = findHostel(hostelId);
  if (!h) return "";
  const owner = findUser(h.ownerId) || { phone: "" };
  const phone = h.ownerPhone || owner.phone || "";
  return String(phone || "").replace(/\D/g, "");
}

function getWhatsAppUrlForHostel(hostelId) {
  const h = findHostel(hostelId);
  if (!h) return "";
  const cleanPhone = getOwnerPhoneForHostel(hostelId);
  if (!cleanPhone) return "";
  const message = `Hi, I saw your listing for ${h.name} on HostelHub. Is a room currently available?`;
  return `https://wa.me/91${cleanPhone}?text=${encodeURIComponent(message)}`;
}

function requireLoginForContact(hostelId, actionType = "inquiry") {
  state.pendingContactHostelId = Number(hostelId);
  state.pendingContactAction = actionType;
  closeModal();
  showToast("Please log in to contact the hostel owner.", "default");
  showAuthScreen("student", "login");
}

function handleContactInquiry(hostelId) {
  if (!state.currentUser) {
    requireLoginForContact(hostelId, "inquiry");
    return;
  }
  contactOwner(hostelId);
}

function handleContactWhatsApp(hostelId) {
  if (!state.currentUser) {
    requireLoginForContact(hostelId, "whatsapp");
    return;
  }
  const url = getWhatsAppUrlForHostel(hostelId);
  if (url) {
    window.open(url, "_blank", "noopener,noreferrer");
  } else {
    showToast("Hostel owner phone number is not available.", "error");
  }
}

function handleContactCall(hostelId) {
  if (!state.currentUser) {
    requireLoginForContact(hostelId, "call");
    return;
  }
  const cleanPhone = getOwnerPhoneForHostel(hostelId);
  if (cleanPhone) {
    window.location.href = `tel:${cleanPhone}`;
  } else {
    showToast("Hostel owner phone number is not available.", "error");
  }
}

async function contactOwner(hostelId) {
  if (!state.currentUser) {
    requireLoginForContact(hostelId, "inquiry");
    return;
  }
  if (state.currentUser.role !== "student") {
    showToast("Only students can send inquiries to hostel owners.", "error");
    return;
  }
  const h = findHostel(hostelId);
  if (!h) return;

  let data;
  try {
    data = await api(`/hostels/${h.id}/contact`, { method: "POST", body: {} });
  } catch (err) {
    showToast(err.message, "error");
    return;
  }

  const box = $("#ownerContactBox");
  if (box && data.owner) {
    const cleanPhone = String(data.owner.phone || "").replace(/\D/g, "");
    box.innerHTML = `
      <div style="font-weight:700; margin-bottom:4px;">${esc(data.owner.name)}</div>
      <div style="font-size:13px; color:var(--text-dim); line-height:1.8;">
        📞 ${esc(data.owner.phone)}<br>
        ✉️ ${esc(data.owner.email)}
      </div>
      <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
        ${cleanPhone ? `
          <button type="button" class="btn btn-whatsapp btn-sm" data-action="contact-whatsapp" data-id="${h.id}" style="text-decoration:none;">
            <span>💬</span> WhatsApp Owner
          </button>
          <button type="button" class="btn btn-sm btn-outline" data-action="contact-call" data-id="${h.id}" style="display:inline-flex; align-items:center; gap:6px; text-decoration:none;">
            <span>📞</span> Call
          </button>
        ` : ''}
      </div>`;
  }

  if (!data.created) {
    showToast("You've already sent an inquiry for this hostel.", "default");
    return;
  }

  await refreshState();
  showToast(`Inquiry sent to ${data.owner.name}.`, "success");
  buildNav();
}

function openAuthGateModal(hostelId) {
  requireLoginForContact(hostelId, "inquiry");
}

function resumeLogin() {
  closeModal();
  showAuthScreen("student", "login");
}
function resumeSignup() {
  closeModal();
  showAuthScreen("student", "signup");
}

function resumeAfterAuth() {
  if (!state.pendingContactHostelId) return;
  const id = state.pendingContactHostelId;
  const action = state.pendingContactAction || "inquiry";
  state.pendingContactHostelId = null;
  state.pendingContactAction = null;

  state.studentSubtab = "find";
  navigate("find");
  openHostelDetail(id);

  if (action === "inquiry") {
    contactOwner(id);
  } else if (action === "whatsapp") {
    handleContactWhatsApp(id);
  } else if (action === "call") {
    handleContactCall(id);
  }
}

function openCompareModal() {
  const ids = state.compareSelection;
  const hostels = ids.map(id => findHostel(id)).filter(Boolean);
  if (hostels.length < 2) { showToast("Select at least 2 hostels to compare.", "error"); return; }

  const headCols = hostels.map(h => `<td class="col-head">${esc(h.name)}</td>`).join("");
  const row = (label, fn) => `<tr><th class="row-label">${label}</th>${hostels.map(h => `<td>${fn(h)}</td>`).join("")}</tr>`;

  const amenityRows = AMENITY_DEFS.map(a => {
    return `<tr><th class="row-label">${a.icon} ${a.label}</th>${hostels.map(h =>
      `<td>${h.amenities.includes(a.id) ? '<span class="yes">✓ Included</span>' : '<span class="no">✕ Not offered</span>'}</td>`
    ).join("")}</tr>`;
  }).join("");

  openModal(`
    <div class="modal-header">
      <h2 class="modal-title">Compare Hostels</h2>
      <button class="modal-close" data-action="close-modal">✕</button>
    </div>
    <div class="compare-table-wrap">
      <table class="compare-table">
        <tr><th class="row-label">Hostel</th>${headCols}</tr>
        ${row("Type", h => `<span class="type-chip">${esc(h.type)}</span>`)}
        ${row("Location", h => esc(h.location))}
        ${row("Distance", h => h.distance + "km")}
        ${row("Monthly rent", h => `<strong>${currency(h.rent)}</strong>`)}
        ${row("Total rooms", h => h.rooms)}
        ${row("Rating", h => "★ " + h.rating)}
        ${amenityRows}
        ${row("", h => `<button class="btn btn-sm btn-gold" data-action="view-hostel-from-compare" data-id="${h.id}">View Details</button>`)}
      </table>
    </div>
  `, "modal-wide");
}

/* ---------------------- OWNER VIEW ---------------------- */

function renderOwnerView() {
  const root = $("#viewRoot");
  const ownerId = state.currentUser.id;
  const mine = hostelsByOwner(ownerId);
  const live = mine.filter(h => h.status === "verified" && h.live).length;
  const pending = mine.filter(h => h.status === "pending").length;
  const newInquiries = inquiriesForOwner(ownerId).filter(i => i.status === "pending").length;

  const subtabsHTML = `
    <div class="subtabs">
      <button class="subtab ${state.ownerSubtab === "listings" ? "active" : ""}" data-action="owner-subtab" data-id="listings">My Listings</button>
      <button class="subtab ${state.ownerSubtab === "inquiries" ? "active" : ""}" data-action="owner-subtab" data-id="inquiries">Inquiries ${newInquiries ? `<span class="nav-badge">${newInquiries}</span>` : ""}</button>
      <button class="subtab ${state.ownerSubtab === "analytics" ? "active" : ""}" data-action="owner-subtab" data-id="analytics">Analytics</button>
    </div>`;

  let content;
  if (state.ownerSubtab === "inquiries") content = ownerInquiriesHTML(ownerId);
  else if (state.ownerSubtab === "analytics") content = ownerAnalyticsHTML(mine);
  else content = ownerListingsHTML(mine);

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Owner Dashboard</h1>
        <p class="page-subtitle">Manage your properties and student inquiries</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-gold" data-action="add-listing">➕ Add New Listing</button>
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat-card gold"><div class="stat-value">${mine.length}</div><div class="stat-label">Total Listings</div></div>
      <div class="stat-card green"><div class="stat-value">${live}</div><div class="stat-label">Live Properties</div></div>
      <div class="stat-card gold"><div class="stat-value">${pending}</div><div class="stat-label">Pending Approval</div></div>
      <div class="stat-card cyan"><div class="stat-value">${newInquiries}</div><div class="stat-label">New Inquiries</div></div>
    </div>
    ${subtabsHTML}
    ${content}
  `;
}

function ownerListingsHTML(mine) {
  if (!mine.length) {
    return `<div class="empty-state"><div class="empty-icon">🏘️</div><div class="empty-title">No listings yet</div><div>Click "Add New Listing" to list your first property.</div></div>`;
  }
  return mine.map(h => `
    <div class="listing-row">
      <div class="listing-thumb">${hostelThumbHTML(h)}</div>
      <div class="listing-info">
        <div class="listing-title-row">
          <span class="listing-title">${esc(h.name)}</span>
          ${h.status === "pending" ? statusBadge("pending") : (h.live ? '<span class="badge badge-green">Live</span>' : '<span class="badge badge-gray">Inactive</span>')}
        </div>
        <div class="listing-loc">📍 ${esc(h.location)}</div>
        <div class="listing-stats">
          <span>💰 ${currency(h.rent)}/mo</span>
          <span>🛏️ ${h.rooms} rooms</span>
          <span>👁️ ${h.views} views</span>
        </div>
      </div>
      <div class="listing-actions">
        ${h.status === "verified" ? `
          <label class="switch" title="Toggle availability">
            <input type="checkbox" data-action="toggle-availability" data-id="${h.id}" ${h.live ? "checked" : ""} />
            <span class="slider"></span>
          </label>` : ""}
        <button class="btn btn-sm" data-action="edit-listing" data-id="${h.id}">Edit</button>
        <button class="icon-square" data-action="delete-listing" data-id="${h.id}" title="Delete listing">🗑️</button>
      </div>
    </div>
  `).join("");
}

function ownerInquiriesHTML(ownerId) {
  const list = inquiriesForOwner(ownerId).slice().sort((a, b) => b.date.localeCompare(a.date));
  if (!list.length) {
    return `<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">No inquiries yet</div><div>Student messages about your listings will show up here.</div></div>`;
  }
  const rows = list.map(i => {
    const student = findUser(i.studentId) || { name: "Deleted student", email: "" };
    const h = findHostel(i.hostelId) || { name: "Listing removed" };
    return `
      <tr>
        <td><div class="cell-title">${esc(student.name)}</div><div class="cell-sub">${esc(student.email)}</div></td>
        <td>${esc(h.name)}</td>
        <td>${esc(i.message)}</td>
        <td>${formatDate(i.date)}</td>
        <td>${i.status === "pending" ? statusBadge("pending") : '<span class="badge badge-green">Responded</span>'}</td>
        <td>${i.status === "pending" ? `<button class="btn btn-sm btn-outline-green" data-action="mark-responded" data-id="${i.id}">Mark Responded</button>` : "—"}</td>
      </tr>`;
  }).join("");
  return `
    <div class="table-wrap" tabindex="0" role="region" aria-label="Data table">
      <table>
        <thead><tr><th>Student</th><th>Hostel</th><th>Message</th><th>Received</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function ownerAnalyticsHTML(mine) {
  if (!mine.length) {
    return `<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">No data yet</div><div>Analytics will appear once you have listings.</div></div>`;
  }
  const maxViews = Math.max(...mine.map(h => h.views), 1);
  const rows = mine.slice().sort((a, b) => b.views - a.views).map(h => `
    <div class="progress-row">
      <div class="progress-row-top"><span>${esc(h.name)}</span><span>${h.views} views · ${state.inquiries.filter(i => i.hostelId === h.id).length} inquiries</span></div>
      <div class="progress-track"><div class="progress-fill" data-final-width="${Math.round((h.views / maxViews) * 100)}%"></div></div>
    </div>
  `).join("");
  return `<div class="report-card"><h3>Views by listing</h3>${rows}</div>`;
}

function ownerSubtabSwitch(id) {
  state.ownerSubtab = id;
  renderOwnerView();
  animateBars();
  buildNav();
}

async function toggleAvailability(id) {
  const h = findHostel(id);
  if (!h || h.status !== "verified") return;
  try {
    await api(`/hostels/${id}/toggle-availability`, { method: "POST" });
  } catch (err) {
    showToast(err.message, "error");
    return;
  }
  await refreshState();
  const updated = findHostel(id);
  showToast(updated.live ? `${updated.name} is now live.` : `${updated.name} is now hidden from students.`, "success");
  renderOwnerView();
}

async function deleteListing(id) {
  const h = findHostel(id);
  if (!h) return;
  if (!confirm(`Delete "${h.name}"? This can't be undone.`)) return;
  try {
    await api(`/hostels/${id}`, { method: "DELETE" });
  } catch (err) {
    showToast(err.message, "error");
    return;
  }
  await refreshState();
  showToast("Listing deleted.", "success");
  renderOwnerView();
}

async function markInquiryResponded(id) {
  try {
    await api(`/inquiries/${id}/respond`, { method: "PUT" });
  } catch (err) {
    showToast(err.message, "error");
    return;
  }
  await refreshState();
  renderOwnerView();
  buildNav();
}

/* ---------------------- Add / edit listing modal ---------------------- */
function initializeListingMap(editing) {
  const mapElement = $("#listingMap");
  if (!mapElement || typeof maplibregl === "undefined") return;

  const latitude = editing && editing.latitude != null
    ? Number(editing.latitude)
    : 20.5937;

  const longitude = editing && editing.longitude != null
    ? Number(editing.longitude)
    : 78.9629;

  const map = new maplibregl.Map({
    container: "listingMap",
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [longitude, latitude],
    zoom: editing && editing.latitude != null ? 15 : 5
  });

  map.addControl(new maplibregl.NavigationControl(), "top-right");

  const marker = new maplibregl.Marker({
    draggable: true
  })
    .setLngLat([longitude, latitude])
    .addTo(map);

  const updateCoordinates = () => {
    const position = marker.getLngLat();

    $("#listingLatitude").value = position.lat;
    $("#listingLongitude").value = position.lng;

    $("#listingMapStatus").textContent =
      `Selected location: ${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`;
  };

  marker.on("dragend", updateCoordinates);

  map.on("load", () => {
    map.resize();

    if (editing && editing.latitude != null && editing.longitude != null) {
      updateCoordinates();
    }
  });

  window.hostelHubListingMap = map;
  window.hostelHubListingMarker = marker;
}

function openListingModal(id) {
  const editing = id ? findHostel(id) : null;
  state.editingHostelId = editing ? editing.id : null;
  state.listingImageData = editing ? editing.image : null;

  const typeOptions = ["Boys Hostel", "Girls Hostel", "PG/Rooms"].map(t =>
    `<option value="${t}" ${editing && editing.type === t ? "selected" : ""}>${t}</option>`).join("");
  const collegeOptions = COLLEGES.map(c =>
    `<option value="${esc(c)}" ${editing && editing.college === c ? "selected" : ""}>${esc(c)}</option>`).join("");
  const amenityBoxes = AMENITY_DEFS.map(a => `
    <label class="checkbox-row">
      <input type="checkbox" id="amenity-${a.id}" ${editing && editing.amenities.includes(a.id) ? "checked" : ""} />
      ${a.icon} ${a.label}
    </label>`).join("");

  const previewHTML = state.listingImageData
    ? `<img src="${esc(state.listingImageData)}" alt="Preview" /><div>Click to change image</div>`
    : `<span class="dz-icon">☁️⬆️</span><div>Click to upload image<br>or paste an image URL below</div>`;

  openModal(`
    <div class="modal-header">
      <h2 class="modal-title">${editing ? "Edit Listing" : "List Your Property"}</h2>
      <button class="modal-close" data-action="close-modal">✕</button>
    </div>
    <div class="form-grid-2">
      <div class="field-group">
        <label for="listingName">Property Name *</label>
        <input type="text" id="listingName" placeholder="e.g. Royal Boys PG" value="${editing ? esc(editing.name) : ""}" />
      </div>
      <div class="field-group">
        <label for="listingType">Property Type *</label>
        <select id="listingType">${typeOptions}</select>
      </div>
      <div class="field-group">
        <label for="listingCollege">Nearest College *</label>
        <select id="listingCollege">${collegeOptions}</select>
      </div>
      <div class="field-group">
        <label for="listingDistance">Distance from college (km) *</label>
        <input type="number" id="listingDistance" min="0" step="0.1" value="${editing ? editing.distance : "0.5"}" />
      </div>
      <div class="field-group">
  <label for="listingLocation">Location / Area *</label>
  <input
    type="text"
    id="listingLocation"
    placeholder="e.g. North Campus, DU"
    value="${editing ? esc(editing.location) : ""}"
  />
</div>

<div class="field-group listing-map-group">
  <label for="listingMapSearch">Property Location on Map</label>

  <div class="map-search-row">
    <input
      type="text"
      id="listingMapSearch"
      placeholder="Search your property location..."
      value="${editing ? esc(editing.location) : ""}"/>
    <button
      type="button"
      class="btn"
      data-action="search-listing-location">
      Search Location
    </button>
  </div>

  <div id="listingMap" class="listing-map"></div>

  <div id="listingMapStatus" class="map-status">
    Search for your property and adjust the marker if needed.
  </div>

  <input type="hidden" id="listingLatitude" value="${editing && editing.latitude != null ? editing.latitude : ""}" />
  <input type="hidden" id="listingLongitude" value="${editing && editing.longitude != null ? editing.longitude : ""}" />
</div>
      <div class="field-group">
        <label for="listingRent">Monthly Rent (₹) *</label>
        <input type="number" id="listingRent" min="0" placeholder="8000" value="${editing ? editing.rent : ""}" />
      </div>
      <div class="field-group">
        <label for="listingRooms">Total Rooms</label>
        <input type="number" id="listingRooms" min="1" value="${editing ? editing.rooms : 10}" />
      </div>
    </div>
    <div class="field-group">
      <label for="listingDescription">Description</label>
      <textarea id="listingDescription" placeholder="Describe your property, nearby landmarks, rules, etc.">${editing ? esc(editing.description) : ""}</textarea>
    </div>
    <div class="field-group">
      <label>Amenities</label>
      <div class="amenity-grid">${amenityBoxes}</div>
    </div>
    <div class="field-group">
      <label for="listingImageUrl">Property Image</label>
      <div class="dropzone" id="listingDropzone" data-action="upload-image-trigger" role="button" tabindex="0"
        aria-label="Upload a property image" aria-describedby="listingImageHint">${previewHTML}</div>
      <input type="text" id="listingImageUrl" placeholder="Or paste image URL here…" style="margin-top:8px;" value="${editing && editing.image && editing.image.startsWith('http') ? editing.image : ''}" />
      <span id="listingImageHint" class="field-hint">Upload a photo or paste a direct image URL.</span>
    </div>
    <div class="modal-actions">
      <button class="btn" data-action="close-modal">Cancel</button>
      <button class="btn btn-gold" data-action="submit-listing">${editing ? "Save Changes" : "Submit Listing"}</button>
    </div>
  `);
   
   initializeListingMap(editing);
}

function handleImageUpload(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    state.listingImageData = e.target.result;
    const dz = $("#listingDropzone");
    if (dz) dz.innerHTML = `<img src="${esc(state.listingImageData)}" alt="Preview" /><div>Click to change image</div>`;
  };
  reader.readAsDataURL(file);
}

async function submitListingForm() {
  const name = $("#listingName").value.trim();
  const type = $("#listingType").value;
  const college = $("#listingCollege").value;
  const distance = parseFloat($("#listingDistance").value) || 0.5;
  const location = $("#listingLocation").value.trim();
  const latitude = $("#listingLatitude").value;
  const longitude = $("#listingLongitude").value;
  const rent = parseInt($("#listingRent").value, 10);
  const rooms = parseInt($("#listingRooms").value, 10) || 1;
  const description = $("#listingDescription").value.trim();
  const urlField = $("#listingImageUrl").value.trim();
  const amenities = AMENITY_DEFS.filter(a => $("#amenity-" + a.id).checked).map(a => a.id);

  if (!name || !location || !rent) {
    showToast("Please fill in property name, location and rent.", "error");
    return;
  }

  const image = state.listingImageData || urlField || null;
  const payload = {
  name,
  type,
  college,
  distance,
  location,
  rent,
  rooms,
  description,
  amenities,
  image,
  latitude,
  longitude
};

  try {
    if (state.editingHostelId) {
      await api(`/hostels/${state.editingHostelId}`, { method: "PUT", body: payload });
      showToast("Listing updated.", "success");
    } else {
      await api("/hostels", { method: "POST", body: payload });
      showToast("Listing submitted — an admin will review it shortly.", "success");
    }
  } catch (err) {
    showToast(err.message, "error");
    return;
  }

  await refreshState();
  closeModal();
  renderOwnerView();
}

/* ---------------------- ADMIN VIEW ---------------------- */

function renderAdminView() {
  const root = $("#viewRoot");
  const pending = state.hostels.filter(h => h.status === "pending");
  const verified = state.hostels.filter(h => h.status === "verified");
  const totalInquiries = state.inquiries.length;

  const subtabsHTML = `
    <div class="subtabs">
      <button class="subtab ${state.adminSubtab === "approval" ? "active" : ""}" data-action="admin-subtab" data-id="approval">Approval Queue ${pending.length ? `<span class="nav-badge">${pending.length}</span>` : ""}</button>
      <button class="subtab ${state.adminSubtab === "properties" ? "active" : ""}" data-action="admin-subtab" data-id="properties">All Properties</button>
      <button class="subtab ${state.adminSubtab === "users" ? "active" : ""}" data-action="admin-subtab" data-id="users">Users</button>
      <button class="subtab ${state.adminSubtab === "reports" ? "active" : ""}" data-action="admin-subtab" data-id="reports">Reports</button>
    </div>`;

  let content;
  if (state.adminSubtab === "properties") content = adminPropertiesHTML();
  else if (state.adminSubtab === "users") content = adminUsersHTML();
  else if (state.adminSubtab === "reports") content = adminReportsHTML();
  else content = adminApprovalHTML(pending);

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Administration Panel</h1>
        <p class="page-subtitle">Platform oversight and management</p>
      </div>
      <div class="page-header-actions">
        <button class="btn" data-action="export-data">⬇️ Export Data</button>
        <button class="btn btn-outline-red" data-action="reset-data">⟲ Reset</button>
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat-card gold"><div class="stat-value">${pending.length}</div><div class="stat-label">Pending Verifications</div></div>
      <div class="stat-card green"><div class="stat-value">${verified.length}</div><div class="stat-label">Verified Properties</div></div>
      <div class="stat-card cyan"><div class="stat-value">${state.users.length}</div><div class="stat-label">Total Users</div></div>
      <div class="stat-card blue"><div class="stat-value">${totalInquiries}</div><div class="stat-label">Total Inquiries</div></div>
    </div>
    ${subtabsHTML}
    ${content}
  `;
}

function adminSubtabSwitch(id) {
  state.adminSubtab = id;
  renderAdminView();
  if (id === "reports") animateBars();
}

function adminApprovalHTML(pending) {
  if (!pending.length) {
    return `<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">All caught up</div><div>There are no listings waiting for approval.</div></div>`;
  }
  const rows = pending.map(h => {
    const owner = findUser(h.ownerId) || { name: "Unknown owner", phone: "" };
    return `
      <tr>
        <td>
          <div class="cell-property">
            <div class="cell-thumb">${hostelThumbHTML(h)}</div>
            <div><div class="cell-title">${esc(h.name)}</div><div class="cell-sub">${esc(h.location)}</div></div>
          </div>
        </td>
        <td><div class="cell-title">${esc(owner.name)}</div><div class="cell-sub">${esc(owner.phone)}</div></td>
        <td><span class="type-chip">${esc(h.type)}</span><div class="cell-sub" style="margin-top:4px;">${currency(h.rent)}/mo</div></td>
        <td>${formatDate(new Date().toISOString().slice(0,10))}</td>
        <td>
          <div class="table-actions">
            <button class="btn btn-sm btn-solid-green" data-action="approve-hostel" data-id="${h.id}">✓ Approve</button>
            <button class="btn btn-sm btn-outline-red" data-action="reject-hostel" data-id="${h.id}">✕ Reject</button>
          </div>
        </td>
      </tr>`;
  }).join("");
  return `
    <div class="table-wrap" tabindex="0" role="region" aria-label="Data table">
      <table>
        <thead><tr><th>Property</th><th>Owner Details</th><th>Type &amp; Price</th><th>Submitted</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function adminPropertiesHTML() {
  if (!state.hostels.length) {
    return `<div class="empty-state"><div class="empty-icon">🏘️</div><div class="empty-title">No properties on the platform</div></div>`;
  }
  const rows = state.hostels.slice().sort((a, b) => b.views - a.views).map(h => {
    const owner = findUser(h.ownerId) || { name: "Unknown owner" };
    const inqCount = state.inquiries.filter(i => i.hostelId === h.id).length;
    return `
      <tr>
        <td>
          <div class="cell-property">
            <div class="cell-thumb">${hostelThumbHTML(h)}</div>
            <div><div class="cell-title">${esc(h.name)}</div><div class="cell-sub">${esc(h.location)}</div></div>
          </div>
        </td>
        <td>${esc(owner.name)}</td>
        <td>${statusBadge(h.status)}</td>
        <td>${h.views}</td>
        <td>${inqCount}</td>
        <td><button class="icon-square" data-action="delete-hostel" data-id="${h.id}" title="Remove listing">🗑️</button></td>
      </tr>`;
  }).join("");
  return `
    <div class="table-wrap" tabindex="0" role="region" aria-label="Data table">
      <table>
        <thead><tr><th>Property</th><th>Owner</th><th>Status</th><th>Views</th><th>Inquiries</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function adminUsersHTML() {
  const rows = state.users.slice().sort((a, b) => a.joined.localeCompare(b.joined)).map(u => {
    const roleBadge = u.role === "owner" ? `<span class="badge badge-gray">Owner</span>` : u.role === "admin" ? `<span class="badge badge-gold">Admin</span>` : `<span class="badge badge-gray">Student</span>`;
    const countLabel = u.role === "owner" ? `${hostelsByOwner(u.id).length} listings`
      : u.role === "student" ? `${inquiriesForStudent(u.id).length} inquiries` : "Admin";
    return `
      <tr>
        <td>
          <div class="cell-property">
            <div class="avatar" style="width:34px;height:34px;font-size:11px;">${initials(u.name)}</div>
            <div><div class="cell-title">${esc(u.name)}</div><div class="cell-sub">${esc(u.email)}</div></div>
          </div>
        </td>
        <td>${roleBadge}</td>
        <td>${formatDate(u.joined)}</td>
        <td>${countLabel}</td>
        <td>${u.status === "active" ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-gray">Inactive</span>'}</td>
        <td>${u.role === "admin" ? "—" : `<button class="btn btn-sm" data-action="toggle-user-status" data-id="${u.id}">${u.status === "active" ? "Deactivate" : "Activate"}</button>`}</td>
      </tr>`;
  }).join("");
  return `
    <div class="table-wrap" tabindex="0" role="region" aria-label="Data table">
      <table>
        <thead><tr><th>User</th><th>Role</th><th>Joined</th><th>Activity</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function adminReportsHTML() {
  const growth = [3, 4, 3, 5, 4, 7];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const maxGrowth = Math.max(...growth);
  const bars = growth.map((v, i) => `
    <div class="bar-chart-col">
      <div class="bar-chart-bar ${v === maxGrowth ? "peak" : ""}" data-final-height="${Math.round((v / maxGrowth) * 100)}%"></div>
      <div class="bar-chart-label">${months[i]}</div>
    </div>`).join("");

  const byType = { "Boys Hostel": 0, "Girls Hostel": 0, "PG/Rooms": 0 };
  state.hostels.forEach(h => { byType[h.type] = (byType[h.type] || 0) + 1; });
  const totalHostels = state.hostels.length || 1;
  const categoryRows = Object.entries(byType).map(([label, count]) => {
    const pct = Math.round((count / totalHostels) * 100);
    return `
      <div class="progress-row">
        <div class="progress-row-top"><span>${esc(label)}</span><span>${pct}%</span></div>
        <div class="progress-track"><div class="progress-fill" data-final-width="${pct}%"></div></div>
      </div>`;
  }).join("");

  const pendingCount = state.inquiries.filter(i => i.status === "pending").length;
  const respondedCount = state.inquiries.filter(i => i.status === "responded").length;
  const closedCount = state.inquiries.filter(i => i.status === "closed").length;

  const top3 = state.hostels.slice().sort((a, b) => b.views - a.views).slice(0, 3);
  const topRows = top3.map((h, i) => {
    const inqCount = state.inquiries.filter(x => x.hostelId === h.id).length;
    return `
      <div class="top-property-row">
        <div class="rank-badge">${i + 1}</div>
        <div><div class="top-property-name">${esc(h.name)}</div><div class="top-property-sub">${h.views} views · ${inqCount} inquiries</div></div>
      </div>`;
  }).join("");

  return `
    <div class="report-grid">
      <div class="report-card">
        <h3>Platform Growth <span style="color:var(--text-faint); font-weight:500; font-size:11.5px;">New listings per month</span></h3>
        <div class="bar-chart">${bars}</div>
      </div>
      <div class="report-card">
        <h3>Property Categories</h3>
        ${categoryRows}
      </div>
      <div class="report-card">
        <h3>Inquiry Status Distribution</h3>
        <div class="inquiry-status-row">
          <div><div class="inquiry-status-num pending">${pendingCount}</div><div class="inquiry-status-label">Pending</div></div>
          <div><div class="inquiry-status-num responded">${respondedCount}</div><div class="inquiry-status-label">Responded</div></div>
          <div><div class="inquiry-status-num closed">${closedCount}</div><div class="inquiry-status-label">Closed</div></div>
        </div>
      </div>
      <div class="report-card">
        <h3>Top Performing Properties</h3>
        ${topRows || '<div class="empty-state">No views yet</div>'}
      </div>
    </div>
  `;
}

function animateBars() {
  requestAnimationFrame(() => {
    $all(".bar-chart-bar[data-final-height]").forEach(el => { el.style.height = el.dataset.finalHeight; });
    $all(".progress-fill[data-final-width]").forEach(el => { el.style.width = el.dataset.finalWidth; });
  });
}

async function approveHostel(id) {
  const h = findHostel(id);
  if (!h) return;
  try {
    await api(`/hostels/${id}/approve`, { method: "POST" });
  } catch (err) {
    showToast(err.message, "error");
    return;
  }
  await refreshState();
  showToast(`${h.name} approved and is now live.`, "success");
  renderAdminView();
}
async function rejectHostel(id) {
  const h = findHostel(id);
  if (!h) return;
  if (!confirm(`Reject and remove "${h.name}"?`)) return;
  try {
    await api(`/hostels/${id}/reject`, { method: "POST" });
  } catch (err) {
    showToast(err.message, "error");
    return;
  }
  await refreshState();
  showToast("Listing rejected and removed.", "success");
  renderAdminView();
}
async function deleteHostel(id) {
  const h = findHostel(id);
  if (!h) return;
  if (!confirm(`Remove "${h.name}" from the platform? This is typically used to take down fake or fraudulent listings.`)) return;
  try {
    await api(`/hostels/${id}`, { method: "DELETE" });
  } catch (err) {
    showToast(err.message, "error");
    return;
  }
  await refreshState();
  showToast("Listing removed from the platform.", "success");
  renderAdminView();
}
async function toggleUserStatus(id) {
  const u = findUser(id);
  if (!u || u.role === "admin") return;
  try {
    await api(`/users/${id}/toggle-status`, { method: "PUT" });
  } catch (err) {
    showToast(err.message, "error");
    return;
  }
  await refreshState();
  const updated = findUser(id);
  showToast(`${updated.name} is now ${updated.status}.`, "success");
  renderAdminView();
}
async function exportData() {
  let payload;
  try {
    payload = await api("/export");
  } catch (err) {
    showToast(err.message, "error");
    return;
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "roomfinder-export.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Platform data exported.", "success");
}

function askAdminPassword() {
  return new Promise(resolve => {
    let settled = false;
    let overlayListener = null;
    const overlay = $("#modalOverlay");

    const finish = value => {
      if (settled) return;
      settled = true;
      if (overlayListener) overlay.removeEventListener("click", overlayListener);
      document.removeEventListener("keydown", onKeydown, true);
      closeModal();
      resolve(value);
    };

    const onKeydown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish(null);
      }
    };

    openModal(`
      <div class="modal-header">
        <h2 class="modal-title">Confirm administrator password</h2>
        <button class="modal-close" type="button" data-action="close-modal" aria-label="Cancel">✕</button>
      </div>
      <form id="adminResetAuthForm" class="modal-form">
        <p class="modal-copy">Re-enter your administrator password to permanently clear platform data.</p>
        <div class="field-group">
          <label for="adminResetPassword">Administrator password</label>
          <input type="password" id="adminResetPassword" autocomplete="current-password" required />
        </div>
        <div id="adminResetError" class="form-error" role="alert" hidden></div>
        <div class="modal-actions">
          <button class="btn" type="button" data-action="close-modal">Cancel</button>
          <button class="btn btn-outline-red" type="submit">Clear platform data</button>
        </div>
      </form>
    `);

    const form = $("#adminResetAuthForm");
    const input = $("#adminResetPassword");
    const errorEl = $("#adminResetError");
    const cancel = form?.querySelector('[data-action="close-modal"]');

    form?.addEventListener("submit", event => {
      event.preventDefault();
      const password = input ? input.value : "";
      if (!password) {
        if (errorEl) {
          errorEl.textContent = "Enter your administrator password.";
          errorEl.hidden = false;
        }
        input?.focus();
        return;
      }
      finish(password);
    });
    cancel?.addEventListener("click", event => {
      event.preventDefault();
      finish(null);
    });
    overlayListener = event => {
      if (event.target === overlay) finish(null);
    };
    overlay.addEventListener("click", overlayListener);
    document.addEventListener("keydown", onKeydown, true);

    window.setTimeout(() => input?.focus(), 0);
  });
}

async function resetData() {
  const confirmed = confirm(
    "CLEAR ALL PLATFORM DATA?\n\n" +
    "This permanently deletes all hostel listings, inquiries, " +
    "and all non-admin user accounts.\n\n" +
    "Your configured administrator account will be preserved.\n\n" +
    "This action cannot be undone. Continue?"
  );

  if (!confirmed) return;

  const password = await askAdminPassword();
  if (password === null) return;

  let data;

  try {
    data = await api("/reset", { method: "POST", body: { password } });
  } catch (err) {
    showToast(err.message, "error");
    return;
  }

  await refreshState();
  showToast("Platform data cleared successfully.", "success");

  if (data.loggedOut) {
    state.currentUser = null;
    showLandingScreen();
  } else {
    renderAdminView();
  }
}

/* ---------------------- Delegated actions ---------------------- */
async function searchListingLocation() {
  const searchInput = $("#listingMapSearch");
  const locationInput = $("#listingLocation");
  const status = $("#listingMapStatus");

  if (!searchInput) return;

  const address = searchInput.value.trim();

  if (!address) {
    showToast("Please enter a location to search.", "error");
    return;
  }

  if (status) {
    status.textContent = "Searching location...";
  }

  try {
    const data = await api("/geocode", {
      method: "POST",
      body: {
        address
      }
    });

    const latitude = Number(data.latitude);
    const longitude = Number(data.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error("Invalid coordinates received.");
    }

    $("#listingLatitude").value = latitude;
    $("#listingLongitude").value = longitude;

    if (locationInput && data.display_name) {
      locationInput.value = data.display_name;
    }

    if (window.hostelHubListingMap && window.hostelHubListingMarker) {
      window.hostelHubListingMarker.setLngLat([longitude, latitude]);

      window.hostelHubListingMap.flyTo({
        center: [longitude, latitude],
        zoom: 15,
        essential: true
      });
    }

    if (status) {
      status.textContent =
        `Location selected: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    }

    showToast("Location found successfully.", "success");

  } catch (err) {
    if (status) {
      status.textContent =
        "Location could not be found. Try a more specific address.";
    }

    showToast(err.message, "error");
  }
}

async function toggleWishlist(hostelId) {
  hostelId = Number(hostelId);
  if (!state.currentUser) {
    showToast("Please log in to save hostels to your wishlist.", "default");
    showAuthScreen("student", "login");
    return;
  }
  try {
    const res = await api(`/wishlist/${hostelId}/toggle`, { method: "POST" });
    if (res.saved) {
      if (!state.wishlist.includes(hostelId)) state.wishlist.push(hostelId);
      showToast("Saved to your wishlist!", "success");
    } else {
      state.wishlist = state.wishlist.filter(id => id !== hostelId);
      showToast("Removed from your wishlist.", "default");
    }
    if (state.studentSubtab === "saved") {
      renderStudentView();
    } else {
      $all(`[data-action="toggle-wishlist"][data-id="${hostelId}"]`).forEach(btn => {
        btn.innerHTML = res.saved ? "❤️" : "🤍";
        btn.classList.toggle("is-saved", res.saved);
      });
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function loadHostelReviews(hostelId) {
  const container = $("#hostelReviewsContainer");
  const countLabel = $("#detailReviewCount");
  if (!container) return;
  try {
    const res = await api(`/hostels/${hostelId}/reviews`);
    const reviews = res.reviews || [];
    if (countLabel) countLabel.textContent = `${reviews.length} review${reviews.length === 1 ? '' : 's'}`;
    if (!reviews.length) {
      container.innerHTML = `<div style="font-size:13px; color:var(--text-faint); padding:10px 0;">No reviews yet. Be the first student to review this hostel!</div>`;
      return;
    }
    container.innerHTML = reviews.map(r => `
      <div class="review-card review-card-detail">
        <div class="review-card-head">
          <span class="review-card-name">${esc(r.studentName)}</span>
          <span class="review-card-stars" aria-label="${r.rating} out of 5 stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
        </div>
        <div class="review-card-body">${esc(r.comment)}</div>
        <div class="review-card-date">${esc(r.date)}</div>
      </div>
    `).join("");
  } catch (err) {
    if (container) container.innerHTML = `<div style="font-size:12px; color:var(--text-faint);">Could not load reviews.</div>`;
  }
}

async function submitReview(hostelId) {
  if (!state.currentUser) {
    showToast("Please log in as a student to leave a review.", "error");
    return;
  }
  const ratingInput = $("#selectedReviewRating");
  const commentInput = $("#reviewCommentInput");
  const rating = Number(ratingInput ? ratingInput.value : 5);
  const comment = (commentInput ? commentInput.value : "").trim();
  if (!comment) {
    showToast("Please write a short review comment.", "error");
    return;
  }

  try {
    const res = await api(`/hostels/${hostelId}/reviews`, {
      method: "POST",
      body: { rating, comment }
    });
    showToast("Review submitted successfully! Thank you.", "success");
    if (commentInput) commentInput.value = "";
    const h = findHostel(hostelId);
    if (h && res.newRating) {
      h.rating = res.newRating;
      const ratingDisplay = $(".detail-header-rating");
      if (ratingDisplay) ratingDisplay.textContent = `★ ${h.rating.toFixed(1)} rating`;
    }
    await loadHostelReviews(hostelId);
    await refreshState();
  } catch (err) {
    showToast(err.message, "error");
  }
}

const ACTIONS = {
  "toggle-password": (id, btn) => togglePassword(btn),
  "login": () => handleLogin(),
  "signup": () => handleSignup(),
  "logout": () => logout(),
  "toggle-theme": () => toggleTheme(),
  "go-landing-login": () => goLandingLogin(),
  "go-landing-signup": () => goLandingSignup(),
  "go-owner-portal": () => goOwnerPortal(),
  "return-to-app": () => enterApp(),
  "browse-guest": () => browseGuest(),
  "back-to-landing": (id, btn, e) => {
    if (e && e.preventDefault) e.preventDefault();
    showLandingScreen();
  },
  "toggle-mobile-nav": () => toggleMobileNav(),
  "view-hostel-preview": (id) => viewHostelFromLanding(id),
  "switch-auth-mode": (id) => switchAuthMode(id),
  "switch-portal": (id) => switchPortal(id),
  "resume-login": () => resumeLogin(),
  "resume-signup": () => resumeSignup(),
  "nav": (id, btn) => {   navigate(btn.dataset.view);   closeAppMobileNav(); },
  "owner-subtab": (id) => ownerSubtabSwitch(id),
  "admin-subtab": (id) => adminSubtabSwitch(id),
  "run-search": () => runSearch(),
  "filter-type": (id) => filterByType(id),
  "toggle-compare": (id) => toggleCompare(id),
  "toggle-wishlist": (id) => toggleWishlist(id),
  "submit-review": (id) => submitReview(id),
  "view-hostel": (id) => openHostelDetail(id),
  "view-hostel-from-compare": (id) => openHostelDetail(id),
  "compare-now": () => openCompareModal(),
  "contact-owner": (id) => handleContactInquiry(id),
  "contact-whatsapp": (id) => handleContactWhatsApp(id),
  "contact-call": (id) => handleContactCall(id),
  "close-modal": () => closeModal(),
  "add-listing": () => openListingModal(),
  "edit-listing": (id) => openListingModal(id),
  "delete-listing": (id) => deleteListing(id),
  "toggle-availability": (id) => toggleAvailability(id),
  "submit-listing": () => submitListingForm(),
  "mark-responded": (id) => markInquiryResponded(id),
  "approve-hostel": (id) => approveHostel(id),
  "reject-hostel": (id) => rejectHostel(id),
  "delete-hostel": (id) => deleteHostel(id),
  "toggle-user-status": (id) => toggleUserStatus(id),
  "export-data": () => exportData(),
  "reset-data": () => resetData(),
  "save-profile": () => saveProfile(),
  "save-password": () => savePassword(),
  "upload-image-trigger": () => document.getElementById("listingImageFile").click(),
  "search-listing-location": () => searchListingLocation()
};

document.addEventListener("click", (e) => {
     if (e.target.closest("#appMobileMenu")) {
    toggleAppMobileNav();
    return;
  }
  const star = e.target.closest("#reviewStarPicker [data-star]");
  if (star) {
    const val = Number(star.dataset.star);
    const hidden = $("#selectedReviewRating");
    if (hidden) hidden.value = val;
    $all("#reviewStarPicker [data-star]").forEach(s => {
      s.style.color = Number(s.dataset.star) <= val ? "#f59e0b" : "var(--text-faint)";
    });
  }

  const footerAction = e.target.closest("[data-footer-action]");
  if (footerAction) {
    const act = footerAction.dataset.footerAction;
    if (act === "backtop" || act === "home") {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = ACTIONS[el.dataset.action];
  if (action) action(el.dataset.id, el, e);
});

document.addEventListener("change", (e) => {
  if (e.target.id === "listingImageFile") {
    handleImageUpload(e.target.files[0]);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    if (document.activeElement && document.activeElement.id === "loginPassword") handleLogin();
    if (document.activeElement && document.activeElement.id === "signupConfirm") handleSignup();
    if (document.activeElement && document.activeElement.id === "hostelSearchInput") runSearch();
  }

  const overlay = $("#modalOverlay");
  if (overlay && !overlay.hidden && e.key === "Tab") {
    const focusable = modalFocusableElements();
    const modal = $("#modalBody");
    if (!focusable.length) {
      e.preventDefault();
      modal.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !modal.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !modal.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  if (e.key === "Escape" && overlay && !overlay.hidden) closeModal();
});

$("#modalOverlay").addEventListener("click", (e) => {
  if (e.target.id === "modalOverlay") closeModal();
});

/* ---------------------- Footer Init ---------------------- */

function initFooter() {
  const footerYear = document.getElementById("footerYear");

  if (footerYear) {
    footerYear.textContent = new Date().getFullYear();
  }

  const footer = document.getElementById("siteFooter");

  if (!footer || footer.dataset.initialized === "true") {
    return;
  }

  footer.dataset.initialized = "true";

  footer.addEventListener("click", (event) => {
    const actionLink = event.target.closest("[data-footer-action]");

    if (!actionLink || !footer.contains(actionLink)) {
      return;
    }

    const action = actionLink.dataset.footerAction;

    if (action === "backtop" || action === "home") {
      event.preventDefault();

      window.scrollTo({
        top: 0,
        behavior: window.matchMedia(
          "(prefers-reduced-motion: reduce)"
        ).matches
          ? "auto"
          : "smooth"
      });
    }
  });
}

/* ---------------------- Cinematic intro ---------------------- */

function initCinematicIntro() {
  const boot = document.getElementById("hhBoot");
  if (!boot) return;

  // Mirrors the CSS opener timeline: stage exit starts at 3s, the curtain
  // clears at 4.65s, and the overlay is removed just after it.
  const INTRO_REVEAL_AT = 3000;
  const INTRO_FINISH_AT = 4700;
  const INTRO_SKIP_MS = 580;

  const skip = document.getElementById("hhBootSkip");
  const root = document.documentElement;
  const reduceMotion = window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const finishImmediately = () => {
    root.classList.add("hh-intro-skipped");
    boot.hidden = true;
    boot.setAttribute("aria-hidden", "true");
    document.body.classList.remove("hh-intro-exiting");
  };

  if (reduceMotion || root.classList.contains("hh-intro-skipped")) {
    finishImmediately();
    return;
  }

  // Remember that the opener has played so a refresh in this tab goes
  // straight to the site. Append ?intro=1 to force a replay.
  try { sessionStorage.setItem("hostelhub_intro_seen", "1"); } catch (_) {}

  let finished = false;
  let skipping = false;
  let bodyRevealTimer = 0;
  let revealTimer = 0;
  let finishTimer = 0;

  const revealSite = () => {
    document.body.classList.add("hh-intro-exiting");
    window.clearTimeout(bodyRevealTimer);
    bodyRevealTimer = window.setTimeout(() => {
      document.body.classList.remove("hh-intro-exiting");
    }, 1550);
  };

  const finishIntro = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(finishTimer);
    if (skip && document.activeElement === skip) skip.blur();
    boot.hidden = true;
    boot.setAttribute("aria-hidden", "true");
    document.removeEventListener("keydown", onIntroKeydown);
  };

  const skipIntro = () => {
    if (finished || skipping) return;
    skipping = true;
    window.clearTimeout(revealTimer);
    window.clearTimeout(finishTimer);
    boot.classList.add("is-skipping");
    revealSite();
    finishTimer = window.setTimeout(finishIntro, INTRO_SKIP_MS);
  };

  const onIntroKeydown = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    skipIntro();
  };

  // Align the JS hand-off with the CSS timeline. On a very slow startup the
  // opener may already be part-way through (or finished) by the time this
  // runs; in that case don't queue a second, late reveal.
  const introElapsed = () => {
    if (!boot.getAnimations) return 0;
    const animations = boot.getAnimations();
    const rootAnim = animations.find((anim) => anim.animationName === "hhIntroRootHide");
    if (rootAnim && rootAnim.currentTime != null) {
      return Math.max(0, Number(rootAnim.currentTime));
    }
    const bg = boot.querySelector(".hh-boot-bg");
    const bgAnim = bg && bg.getAnimations ? bg.getAnimations()[0] : null;
    if (bgAnim && bgAnim.currentTime != null) {
      return Math.max(0, Number(bgAnim.currentTime));
    }
    return 0;
  };

  const elapsed = introElapsed();
  if (elapsed >= INTRO_FINISH_AT) {
    revealSite();
    boot.hidden = true;
    boot.setAttribute("aria-hidden", "true");
    return;
  }
  if (elapsed >= INTRO_REVEAL_AT) revealSite();
  else revealTimer = window.setTimeout(revealSite, INTRO_REVEAL_AT - elapsed);
  finishTimer = window.setTimeout(finishIntro, INTRO_FINISH_AT - elapsed);

  if (skip) skip.addEventListener("click", skipIntro);
  document.addEventListener("keydown", onIntroKeydown);
}

/* ---------------------- Init ---------------------- */

async function init() {
  try {
    const footerYr = document.getElementById("footerYear");
    if (footerYr) footerYr.textContent = new Date().getFullYear();
    syncThemeUI();
  } catch (_) {}
  try {
    const meta = await api("/meta");
    COLLEGES = meta.colleges;
    AMENITY_DEFS = meta.amenities;
    await refreshState();

    // Restore an existing session (e.g. after a page refresh).
    const me = await api("/auth/me");
    if (me.user) {
      state.currentUser = me.user;
      state.guestBrowsing = false;
      enterApp();
      return;
    }
  } catch (err) {
    // api() already showed a toast for network/backend failures.
  }
  // If the visitor already opened the auth screen (or entered the app) while
  // the startup requests were in flight, keep their screen and refresh it
  // with the data that has just arrived.
  if (state.screen === "auth") return;
  if (state.screen === "app") { enterApp(); return; }
  showLandingScreen();
}

document.addEventListener("DOMContentLoaded", () => {
  initCinematicIntro();
  init();
  initFooter();
  initLandingScrollReveal();
  initHeroBackground();

  // Close the mobile nav drawer after tapping a section anchor (#find, #how, ...)
  const navLinks = document.getElementById("landingNavLinks");
  if (navLinks) {
    navLinks.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeMobileNav);
    });
  }
});
/* =========================================================
   Landing hero — interactive background
   Moving map parallax, cursor glow and particle trail.
   - Tracks the pointer only inside the hero (native cursor is kept)
   - Pauses when the hero is off-screen or the landing page is hidden
   - Skips the trail entirely for prefers-reduced-motion
   ========================================================= */
function initHeroBackground() {
  const hero = document.querySelector(".l-hero");
  const bg = document.getElementById("hhHeroBg");
  if (!hero || !bg) return;

  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return; // static background only (CSS already stops animations)

  const isMobile = window.matchMedia("(max-width: 700px)").matches;
  const mapStrength = isMobile ? 15 : 35;
  const glowStrength = isMobile ? 100 : 250;
  const trailCount = isMobile ? 12 : 20;

  let targetX = hero.clientWidth / 2, targetY = hero.clientHeight / 2;
  let curX = targetX, curY = targetY;
  let running = false, rafId = 0, idleTimer = 0;

  // Build the trail
  const trail = [];
  for (let i = 0; i < trailCount; i++) {
    const el = document.createElement("div");
    el.className = "hh-trail";
    bg.appendChild(el);
    trail.push({ el, x: targetX, y: targetY });
  }

  function setTarget(clientX, clientY) {
    const r = hero.getBoundingClientRect();
    targetX = clientX - r.left;
    targetY = clientY - r.top;
    bg.classList.add("hh-active");
    clearTimeout(idleTimer);
    // fade the trail out shortly after the pointer stops / lifts
    idleTimer = setTimeout(() => bg.classList.remove("hh-active"), 1800);
    start();
  }

  hero.addEventListener("mousemove", (e) => setTarget(e.clientX, e.clientY));
  hero.addEventListener("mouseleave", () => { bg.classList.remove("hh-active"); });
  hero.addEventListener("touchstart", (e) => { const t = e.touches[0]; if (t) setTarget(t.clientX, t.clientY); }, { passive: true });
  hero.addEventListener("touchmove", (e) => { const t = e.touches[0]; if (t) setTarget(t.clientX, t.clientY); }, { passive: true });

  function frame() {
    curX += (targetX - curX) * 0.15;
    curY += (targetY - curY) * 0.15;

    const w = hero.clientWidth || 1, h = hero.clientHeight || 1;
    const nx = curX / w - 0.5, ny = curY / h - 0.5;
    const s = bg.style;
    s.setProperty("--hh-map-x", (nx * mapStrength).toFixed(2) + "px");
    s.setProperty("--hh-map-y", (ny * mapStrength).toFixed(2) + "px");
    s.setProperty("--hh-glow-x", (nx * glowStrength).toFixed(2) + "px");
    s.setProperty("--hh-glow-y", (ny * glowStrength).toFixed(2) + "px");

    let px = curX, py = curY;
    for (let i = 0; i < trail.length; i++) {
      const p = trail[i];
      const speed = i === 0 ? 0.30 : 0.20;
      p.x += (px - p.x) * speed;
      p.y += (py - p.y) * speed;
      const scale = 1 - (i / trailCount) * 0.7;
      p.el.style.left = p.x.toFixed(1) + "px";
      p.el.style.top = p.y.toFixed(1) + "px";
      p.el.style.transform = "translate(-50%, -50%) scale(" + scale.toFixed(2) + ")";
      p.el.style.opacity = (1 - (i / trailCount) * 0.75).toFixed(2);
      px = p.x; py = p.y;
    }

    // Stop looping once everything has settled and the trail is hidden
    const settled = Math.abs(targetX - curX) < 0.2 && Math.abs(targetY - curY) < 0.2;
    if (settled && !bg.classList.contains("hh-active")) { running = false; return; }
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    rafId = requestAnimationFrame(frame);
  }
  function stop() { running = false; cancelAnimationFrame(rafId); }

  // Only animate while the hero is actually on screen
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (!en.isIntersecting) stop(); });
    }, { threshold: 0 }).observe(hero);
  }
  window.addEventListener("resize", () => {
    targetX = hero.clientWidth / 2; targetY = hero.clientHeight / 2;
  });
}
