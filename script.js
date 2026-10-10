/* =========================================================
   HostelHub — front end
   Talks to the Python (Flask) backend in app.py over a small
   JSON REST API under /api/... . `state` is a local cache of
   whatever the backend last told us; every mutation goes to
   the server first, and the response is used to refresh the
   cache before re-rendering.
   ========================================================= */

/* ---------------------- API helper ---------------------- */

async function api(path, options = {}) {
  const opts = {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin"
  };
  if (options.body !== undefined) opts.body = JSON.stringify(options.body);

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
    users: [], hostels: [], inquiries: [],
    currentUser: null,
    // "landing" = public home page, "auth" = login/signup card, "app" = logged-in / guest app
    screen: "landing",
    // which portal's login/signup is in view: "student" | "owner" | "admin"
    activePortal: "student",
    authMode: "login", // "login" | "signup" — only meaningful while screen === "auth"
    guestBrowsing: false,
    pendingContactHostelId: null,
    ownerSubtab: "listings",
    adminSubtab: "approval",
    studentSubtab: "find",
    typeFilter: "all",
    searchQuery: "",
    compareSelection: [],
    editingHostelId: null,
    listingImageData: null
  };
}

let state = emptyState();

/* Re-pull users/hostels/inquiries from the backend into the local cache. */
async function refreshState() {
  const fresh = await api("/state");
  state.users = fresh.users;
  state.hostels = fresh.hostels;
  state.inquiries = fresh.inquiries;
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

function showLandingScreen() {
  state.screen = "landing";
  $("#landingScreen").hidden = false;
  $("#authScreen").hidden = true;
  $("#mainApp").hidden = true;
  renderLandingStats();
  renderLandingPreview();
  closeMobileNav();
}

function renderLandingStats() {
  const verifiedCount = state.hostels.filter(h => h.status === "verified").length;
  const collegeCount = COLLEGES.length;
  const ownerCount = state.users.filter(u => u.role === "owner").length;
  $("#landingStats").innerHTML = `
    <div class="landing-stat-chip"><b data-count="${verifiedCount}">0</b><span>VERIFIED HOSTELS</span></div>
    <div class="landing-stat-chip"><b data-count="${collegeCount}">0</b><span>COLLEGES COVERED</span></div>
    <div class="landing-stat-chip"><b data-count="${ownerCount}">0</b><span>LISTED OWNERS</span></div>
  `;
  animateLandingCounters();
}

// Animates each stat chip's number from 0 up to its real (backend-derived)
// value. Purely a presentation layer on top of renderLandingStats() — the
// counted values themselves still come straight from state.hostels / COLLEGES
// / state.users above, nothing here is hard-coded.
function animateLandingCounters() {
  const nodes = document.querySelectorAll("#landingStats b[data-count]");
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  nodes.forEach((el) => {
    const target = Number(el.dataset.count) || 0;
    if (reduceMotion || !target) { el.textContent = target; return; }
    const duration = 700;
    const start = performance.now();
    function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      el.textContent = Math.round(target * (1 - Math.pow(1 - progress, 3)));
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
    const amenityChips = (h.amenities || []).slice(0, 4).map(id => {
      const a = amenityLabel(id);
      return a ? `<span>${a.icon} ${esc(a.label)}</span>` : "";
    }).join("");
    return `
      <div class="l-preview-card">
        <div class="l-preview-media">
          🏠
          <span class="l-preview-badge">✓ Verified</span>
        </div>
        <div class="l-preview-body">
          <div class="l-preview-top">
            <h3>${esc(h.name)}</h3>
            <span class="l-preview-rating">★ ${h.rating.toFixed(1)}</span>
          </div>
          <p class="l-preview-loc">${h.distance} km from college · ${esc(h.type)}</p>
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
  state.screen = "auth";
  state.activePortal = portal;
  state.authMode = mode;
  $("#landingScreen").hidden = true;
  $("#mainApp").hidden = true;
  $("#authScreen").hidden = false;
  renderAuthCard();
}

function renderAuthCard() {
  const portal = state.activePortal;
  const copy = PORTAL_COPY[portal];
  const isSignup = state.authMode === "signup";
  const backLink = `<div class="auth-back-link"><a href="#" data-action="back-to-landing">← Back to HostelHub</a></div>`;


  let cardHTML;
  if (isSignup) {
    cardHTML = `
      <div class="auth-card">
        <div class="auth-icon">➕</div>
        <h1 class="auth-title">${esc(copy.signupTitle)}</h1>
        <p class="auth-subtitle">${esc(copy.signupSubtitle)}</p>

        <div class="field-group"><label for="signupName">Full Name *</label><input type="text" id="signupName" placeholder="e.g. Rahul Sharma" /></div>
        <div class="field-group"><label for="signupUsername">Username *</label><input type="text" id="signupUsername" placeholder="Choose a username" /></div>
        <div class="field-group"><label for="signupEmail">Email *</label><input type="email" id="signupEmail" placeholder="your@email.com" /></div>
        <div class="field-group"><label for="signupPhone">Phone *</label><input type="tel" id="signupPhone" placeholder="10-digit mobile number" maxlength="10" inputmode="numeric" /></div>
        <div class="field-group"><label for="signupPassword">Password *</label>
          <div class="password-field"><input type="password" id="signupPassword" placeholder="Min 6 characters" /><button type="button" class="eye-btn" data-action="toggle-password" data-id="signupPassword">Show</button></div>
        </div>
        <div class="field-group"><label for="signupConfirm">Confirm Password *</label>
          <div class="password-field"><input type="password" id="signupConfirm" placeholder="Re-enter password" /><button type="button" class="eye-btn" data-action="toggle-password" data-id="signupConfirm">Show</button></div>
        </div>

        <p class="form-error" id="authError" hidden></p>
        <button class="btn btn-gold btn-block" data-action="signup">👤 Create Account</button>
        <p class="switch-line">Already have an account? <a href="#" data-action="switch-auth-mode" data-id="login">Sign in</a></p>
      </div>`;
  } else {
    cardHTML = `
      <div class="auth-card">
        <div class="auth-icon">${copy.icon}</div>
        <h1 class="auth-title">${esc(copy.loginTitle)}</h1>
        <p class="auth-subtitle">${esc(copy.loginSubtitle)}</p>

        <div class="field-group"><label for="loginUsername">Username</label><input type="text" id="loginUsername" placeholder="Enter your username" autocomplete="username" /></div>
        <div class="field-group"><label for="loginPassword">Password</label>
          <div class="password-field"><input type="password" id="loginPassword" placeholder="Enter your password" autocomplete="current-password" /><button type="button" class="eye-btn" data-action="toggle-password" data-id="loginPassword">Show</button></div>
        </div>

        <p class="form-error" id="authError" hidden></p>
        <button class="btn btn-gold btn-block" data-action="login">Sign In →</button>
        ${copy.signupAllowed ? `<p class="switch-line">Don't have an account? <a href="#" data-action="switch-auth-mode" data-id="signup">Create one</a></p>` : `<div class="auth-portal-note">Admin accounts are provisioned by HostelHub — contact support for access.</div>`}
      </div>`;
  }

  $("#authCardContainer").innerHTML = backLink + cardHTML;
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
      errorEl.innerHTML = err.message + ` <a href="#" data-action="switch-portal" data-id="${guessRole}">Switch portal →</a>`;
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
  if (password.length < 6) {
    errorEl.textContent = "Password must be at least 6 characters.";
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
  showAuthScreen(role, "login");
}

async function logout() {
  try { await api("/auth/logout", { method: "POST" }); } catch (e) { /* ignore */ }
  state.currentUser = null;
  state.guestBrowsing = false;
  state.pendingContactHostelId = null;
  showLandingScreen();
}

/* ---------------------- App shell / routing ---------------------- */

const NAV_CONFIG = {
  student: [
    { id: "find", label: "Find Hostels", icon: "🔎" },
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

  const user = state.currentUser;
  const portal = state.guestBrowsing ? "student" : user.role;

  $("#navLogo").textContent = PORTAL_COPY[portal].wordmark;
  $("#navRoleTag").textContent = state.guestBrowsing ? "Guest" : (user.role[0].toUpperCase() + user.role.slice(1));

  buildNav();
  renderNavRight();

  if (portal === "student") navigate("find");
  else if (portal === "owner") navigate("listings");
  else navigate("panel");
}

function currentRole() {
  return state.guestBrowsing ? "student" : (state.currentUser ? state.currentUser.role : "student");
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
    state.studentSubtab = view === "inquiries" ? "inquiries" : "find";
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

function toggleTheme() {
  document.body.classList.toggle("light-theme");
  const btn = $('[data-action="toggle-theme"]');
  if (btn) btn.textContent = document.body.classList.contains("light-theme") ? "🌙" : "☀️";
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
    ? `<img src="${hostel.image}" alt="${esc(hostel.name)}" />`
    : typeIcon;
}

/* ---------------------- STUDENT VIEW ---------------------- */

function renderStudentView() {
  const root = $("#viewRoot");
  if (state.studentSubtab === "inquiries") {
    root.innerHTML = studentInquiriesHTML();
    return;
  }
  root.innerHTML = studentFindHTML();
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
    results = results.filter(h => h.name.toLowerCase().includes(q) || h.location.toLowerCase().includes(q) || h.type.toLowerCase().includes(q));
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
  return `
    <div class="hostel-card">
      <div class="hostel-thumb">
        <span class="thumb-badge type-chip">${esc(h.type)}</span>
        ${hostelThumbHTML(h)}
      </div>
      <div class="hostel-body">
        <h3 class="hostel-name">${esc(h.name)}</h3>
        <div class="hostel-meta">📍 ${esc(h.location)} · ${h.distance}km away</div>
        <div class="hostel-rent">${currency(h.rent)}<span> /month</span></div>
        <div class="hostel-foot">
          <span class="rating">★ ${h.rating}</span>
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
    <div class="table-wrap">
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
          <div class="password-field"><input type="password" id="profileNewPassword" placeholder="Min 6 characters" /><button type="button" class="eye-btn" data-action="toggle-password" data-id="profileNewPassword">Show</button></div>
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
  if (newPassword.length < 6) {
    errorEl.textContent = "New password must be at least 6 characters.";
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

function openModal(html, extraClass) {
  const overlay = $("#modalOverlay");
  const body = $("#modalBody");
  body.className = "modal" + (extraClass ? " " + extraClass : "");
  body.innerHTML = html;
  overlay.hidden = false;
}
function closeModal() {
  $("#modalOverlay").hidden = true;
  $("#modalBody").innerHTML = "";
  state.editingHostelId = null;
  state.listingImageData = null;
}

function openHostelDetail(id) {
  const h = findHostel(id);
  if (!h) return;
  const owner = findUser(h.ownerId);
  const amenities = amenityChips(h.amenities);

  openModal(`
    <div class="modal-header">
      <h2 class="modal-title">${esc(h.name)}</h2>
      <button class="modal-close" data-action="close-modal">✕</button>
    </div>
    <div class="detail-hero">${hostelThumbHTML(h)}</div>
    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
      <span class="type-chip">${esc(h.type)}</span>
      ${statusBadge(h.status)}
      <span class="rating">★ ${h.rating} rating</span>
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

    <div class="section-label">Owner contact</div>
    <div class="owner-card" id="ownerContactBox">
      <div style="font-weight:700; margin-bottom:4px;">${esc(owner.name)}</div>
      <div style="font-size:12.5px; color:var(--text-faint);">Tap below to reveal contact details and send an inquiry.</div>
      <button class="btn btn-gold btn-sm" style="margin-top:10px;" data-action="contact-owner" data-id="${h.id}">📩 Contact Owner</button>
    </div>

    <div class="section-label">Location</div>
    <div class="map-box"><span class="map-pin">📍</span></div>
    <p style="color:var(--text-dim); font-size:12.5px; margin-top:6px;">${esc(h.location)} · ${h.distance}km from ${esc(h.college)}</p>
  `, "modal-wide");
}

async function contactOwner(hostelId) {
  if (!state.currentUser) {
    openAuthGateModal(hostelId);
    return;
  }
  const h = findHostel(hostelId);

  let data;
  try {
    data = await api(`/hostels/${h.id}/contact`, { method: "POST", body: {} });
  } catch (err) {
    showToast(err.message, "error");
    return;
  }

  const box = $("#ownerContactBox");
  if (box) {
    box.innerHTML = `
      <div style="font-weight:700; margin-bottom:4px;">${esc(data.owner.name)}</div>
      <div style="font-size:13px; color:var(--text-dim); line-height:1.8;">
        📞 ${esc(data.owner.phone)}<br>
        ✉️ ${esc(data.owner.email)}
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
  const h = findHostel(hostelId);
  state.pendingContactHostelId = hostelId;
  openModal(`
    <div class="modal-header">
      <h2 class="modal-title">Contact ${esc(h.name)}'s owner</h2>
      <button class="modal-close" data-action="close-modal">✕</button>
    </div>
    <p style="color:var(--text-dim); font-size:13.5px; line-height:1.6;">
      You'll need a free student account before messaging an owner — this keeps enquiries genuine.
      Your enquiry will be sent automatically right after you sign in or create one.
    </p>
    <div class="auth-gate-options">
      <button class="auth-gate-option" data-action="resume-login">
        <span class="ago-icon">🔑</span><b>I have an account</b><span>Log in and send</span>
      </button>
      <button class="auth-gate-option" data-action="resume-signup">
        <span class="ago-icon">➕</span><b>I'm new here</b><span>Create a free account</span>
      </button>
    </div>
  `);
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
  state.pendingContactHostelId = null;
  contactOwner(id);
  state.studentSubtab = "find";
  navigate("find");
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
    const student = findUser(i.studentId);
    const h = findHostel(i.hostelId);
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
    <div class="table-wrap">
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
    ? `<img src="${state.listingImageData}" alt="Preview" /><div>Click to change image</div>`
    : `<span class="dz-icon">☁️⬆️</span><div>Click to upload image<br>or paste an image URL below</div>`;

  openModal(`
    <div class="modal-header">
      <h2 class="modal-title">${editing ? "Edit Listing" : "List Your Property"}</h2>
      <button class="modal-close" data-action="close-modal">✕</button>
    </div>
    <div class="form-grid-2">
      <div class="field-group">
        <label>Property Name *</label>
        <input type="text" id="listingName" placeholder="e.g. Royal Boys PG" value="${editing ? esc(editing.name) : ""}" />
      </div>
      <div class="field-group">
        <label>Property Type *</label>
        <select id="listingType">${typeOptions}</select>
      </div>
      <div class="field-group">
        <label>Nearest College *</label>
        <select id="listingCollege">${collegeOptions}</select>
      </div>
      <div class="field-group">
        <label>Distance from college (km) *</label>
        <input type="number" id="listingDistance" min="0" step="0.1" value="${editing ? editing.distance : "0.5"}" />
      </div>
      <div class="field-group">
  <label>Location / Area *</label>
  <input
    type="text"
    id="listingLocation"
    placeholder="e.g. North Campus, DU"
    value="${editing ? esc(editing.location) : ""}"
  />
</div>

<div class="field-group listing-map-group">
  <label>Property Location on Map</label>

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
        <label>Monthly Rent (₹) *</label>
        <input type="number" id="listingRent" min="0" placeholder="8000" value="${editing ? editing.rent : ""}" />
      </div>
      <div class="field-group">
        <label>Total Rooms</label>
        <input type="number" id="listingRooms" min="1" value="${editing ? editing.rooms : 10}" />
      </div>
    </div>
    <div class="field-group">
      <label>Description</label>
      <textarea id="listingDescription" placeholder="Describe your property, nearby landmarks, rules, etc.">${editing ? esc(editing.description) : ""}</textarea>
    </div>
    <div class="field-group">
      <label>Amenities</label>
      <div class="amenity-grid">${amenityBoxes}</div>
    </div>
    <div class="field-group">
      <label>Property Image</label>
      <div class="dropzone" id="listingDropzone" data-action="upload-image-trigger">${previewHTML}</div>
      <input type="text" id="listingImageUrl" placeholder="Or paste image URL here…" style="margin-top:8px;" value="${editing && editing.image && editing.image.startsWith('http') ? editing.image : ''}" />
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
    if (dz) dz.innerHTML = `<img src="${state.listingImageData}" alt="Preview" /><div>Click to change image</div>`;
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
    const owner = findUser(h.ownerId);
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
    <div class="table-wrap">
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
    const owner = findUser(h.ownerId);
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
    <div class="table-wrap">
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
    <div class="table-wrap">
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
        <div class="progress-row-top"><span>${label}</span><span>${pct}%</span></div>
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

async function resetData() {
  const confirmed = confirm(
    "CLEAR ALL PLATFORM DATA?\n\n" +
    "This permanently deletes all hostel listings, inquiries, " +
    "and all non-admin user accounts.\n\n" +
    "Your configured administrator account will be preserved.\n\n" +
    "This action cannot be undone. Continue?"
  );

  if (!confirmed) return;

  let data;

  try {
    data = await api("/reset", { method: "POST" });
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
const ACTIONS = {
  "toggle-password": (id, btn) => togglePassword(btn),
  "login": () => handleLogin(),
  "signup": () => handleSignup(),
  "logout": () => logout(),
  "toggle-theme": () => toggleTheme(),
  "go-landing-login": () => goLandingLogin(),
  "go-landing-signup": () => goLandingSignup(),
  "go-owner-portal": () => goOwnerPortal(),
  "browse-guest": () => browseGuest(),
  "back-to-landing": () => showLandingScreen(),
  "toggle-mobile-nav": () => toggleMobileNav(),
  "view-hostel-preview": (id) => viewHostelFromLanding(id),
  "switch-auth-mode": (id) => switchAuthMode(id),
  "switch-portal": (id) => switchPortal(id),
  "resume-login": () => resumeLogin(),
  "resume-signup": () => resumeSignup(),
  "nav": (id, btn) => navigate(btn.dataset.view),
  "owner-subtab": (id) => ownerSubtabSwitch(id),
  "admin-subtab": (id) => adminSubtabSwitch(id),
  "run-search": () => runSearch(),
  "filter-type": (id) => filterByType(id),
  "toggle-compare": (id) => toggleCompare(id),
  "view-hostel": (id) => openHostelDetail(id),
  "view-hostel-from-compare": (id) => openHostelDetail(id),
  "compare-now": () => openCompareModal(),
  "contact-owner": (id) => contactOwner(id),
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
  if (e.key === "Escape" && !$("#modalOverlay").hidden) closeModal();
});

$("#modalOverlay").addEventListener("click", (e) => {
  if (e.target.id === "modalOverlay") closeModal();
});

/* ---------------------- Init ---------------------- */

async function init() {
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
  showLandingScreen();
}

document.addEventListener("DOMContentLoaded", () => {
  init();
  initLandingScrollReveal();

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

document.addEventListener("DOMContentLoaded", initHeroBackground);
