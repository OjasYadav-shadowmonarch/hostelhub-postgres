/* =========================================================================
   HostelHub — interaction polish layer
   Additive only. Every workflow still runs through the existing
   script.js handlers and /api endpoints.
   ========================================================================= */

(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const reducedMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
  const finePointer = window.matchMedia
    ? window.matchMedia("(hover: hover) and (pointer: fine)").matches
    : false;

  /* ---------------------------------------------------------------
     Boot splash — dismiss whether the backend answers or not
     --------------------------------------------------------------- */
  const boot = $("#hhBoot");
  let bootDismissed = false;

  function dismissBoot() {
    if (!boot || bootDismissed) return;
    bootDismissed = true;
    boot.classList.add("is-done");
    window.setTimeout(() => boot.remove(), 750);
  }

  // The cinematic opener owns its own timeline (see initCinematicIntro in
  // script.js and the hhIntro* rules in upgrade.css). Keep this legacy
  // fallback for any older splash markup that doesn't have the intro stage.
  if (!boot || !boot.querySelector(".hh-boot-stage")) {
    window.addEventListener("load", () => window.setTimeout(dismissBoot, 250));
    window.setTimeout(dismissBoot, 1900);
  }

  /* ---------------------------------------------------------------
     Scroll progress, sticky header state and back-to-top
     --------------------------------------------------------------- */
  const progress = $("#hhScrollProgress");
  const toTop = $("#hhToTop");
  const landingNav = $("#landingNav");
  const appNav = $(".main-app .navbar");
  let scrollFrame = 0;

  function updateScrollUI() {
    scrollFrame = 0;
    const y = window.scrollY || window.pageYOffset || 0;
    const height = Math.max(
      1,
      document.documentElement.scrollHeight - window.innerHeight
    );
    const pct = Math.min(100, Math.max(0, (y / height) * 100));

    if (progress) progress.style.width = pct + "%";

    const stuck = y > 8;
    if (landingNav) landingNav.classList.toggle("is-stuck", stuck);
    if (appNav) appNav.classList.toggle("is-stuck", stuck);
    if (toTop) toTop.classList.toggle("is-visible", y > 560);
  }

  function requestScrollUpdate() {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScrollUI);
  }

  window.addEventListener("scroll", requestScrollUpdate, { passive: true });
  window.addEventListener("resize", requestScrollUpdate, { passive: true });
  updateScrollUI();

  if (toTop) {
    toTop.addEventListener("click", () => {
      window.scrollTo({
        top: 0,
        behavior: reducedMotion ? "auto" : "smooth"
      });
    });
  }

  /* ---------------------------------------------------------------
     Landing hero search -> existing guest browse flow
     --------------------------------------------------------------- */
  const heroForm = $("#heroQuickSearch");
  const heroInput = $("#heroSearchInput");

  function runHeroSearch(value) {
    const q = String(value || "").trim();
    try {
      if (typeof state !== "undefined") {
        state.searchQuery = q;
        state.typeFilter = "all";
      }
      if (typeof browseGuest === "function") {
        browseGuest();
        return;
      }
    } catch (_) {
      /* fall through to a safe refresh */
    }
    window.location.reload();
  }

  if (heroForm && heroInput) {
    heroForm.addEventListener("submit", (event) => {
      event.preventDefault();
      runHeroSearch(heroInput.value);
    });

    document.querySelectorAll("[data-hero-query]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const query = chip.getAttribute("data-hero-query") || "";
        heroInput.value = query;
        if (typeof heroForm.requestSubmit === "function") {
          heroForm.requestSubmit();
        } else {
          runHeroSearch(query);
        }
      });
    });
  }

  /* ---------------------------------------------------------------
     Hero tilt (desktop only, respects reduced motion)
     --------------------------------------------------------------- */
  const stage = $("#heroStage");

  if (stage && finePointer && !reducedMotion) {
    stage.style.transition = "transform 0.2s ease-out";

    stage.addEventListener("pointermove", (event) => {
      const rect = stage.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      stage.style.transform =
        "rotateX(" + (-y * 4).toFixed(2) + "deg) rotateY(" +
        (x * 5).toFixed(2) + "deg)";
    });

    stage.addEventListener("pointerleave", () => {
      stage.style.transition = "transform 0.55s cubic-bezier(.22,.61,.36,1)";
      stage.style.transform = "";
    });
  }

  /* ---------------------------------------------------------------
     Mobile navigation: close on outside click, Escape or resize
     --------------------------------------------------------------- */
  function closeLandingMenu() {
    const screen = $("#landingScreen");
    if (!screen || !screen.classList.contains("nav-open")) return;
    if (typeof closeMobileNav === "function") {
      closeMobileNav();
    } else {
      screen.classList.remove("nav-open");
      const toggle = $("#mobileNavToggle");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    }
    const actions = $("#landingNavActions");
    if (actions) actions.style.top = "";
  }

  /* Keep the sign-in / theme actions docked directly beneath the link panel.
     The older stylesheet anchored both panels independently, which left a
     visible gap at some widths. Measuring the rendered link panel keeps the
     drawer as one continuous surface. */
  function positionLandingMenu() {
    const screen = $("#landingScreen");
    const nav = $("#landingNav");
    const links = $("#landingNavLinks");
    const actions = $("#landingNavActions");
    if (!screen || !nav || !links || !actions) return;

    if (!screen.classList.contains("nav-open")) {
      actions.style.top = "";
      return;
    }

    const navRect = nav.getBoundingClientRect();
    const linksRect = links.getBoundingClientRect();
    if (linksRect.height < 1) return;

    const top = linksRect.bottom - navRect.top + 8;
    actions.style.top = Math.round(top) + "px";
  }

  let landingMenuTimer = 0;
  const landingLinks = $("#landingNavLinks");

  function scheduleLandingMenuPosition() {
    window.clearTimeout(landingMenuTimer);
    // The drawer entrance animation (250ms) changes the measured panel while
    // it runs. Measure on the next frame and again once it has settled.
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(positionLandingMenu);
    }
    landingMenuTimer = window.setTimeout(positionLandingMenu, 280);
  }

  const landingScreen = $("#landingScreen");

  if (landingScreen && "MutationObserver" in window) {
    const menuObserver = new MutationObserver(scheduleLandingMenuPosition);
    menuObserver.observe(landingScreen, {
      attributes: true,
      attributeFilter: ["class"]
    });
  }

  // Fonts, wrapping and viewport changes can alter the link panel after the
  // opening animation. Keep the actions docked to its real bottom edge.
  if (landingLinks && "ResizeObserver" in window) {
    new ResizeObserver(positionLandingMenu).observe(landingLinks);
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("#landingNav")) return;
    if ($("#landingScreen")?.classList.contains("nav-open")) closeLandingMenu();
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;

    if (
      target instanceof Element &&
      (event.key === "Enter" || event.key === " " || event.key === "Spacebar") &&
      target.closest('.dropzone[data-action="upload-image-trigger"]')
    ) {
      event.preventDefault();
      target.click();
      return;
    }

    if (event.key !== "Escape") return;
    closeLandingMenu();
    if (typeof closeAppMobileNav === "function") closeAppMobileNav();

    const overlay = $("#modalOverlay");
    if (overlay && !overlay.hidden) {
      if (typeof closeModal === "function") closeModal();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 1024) {
      closeLandingMenu();
    } else {
      positionLandingMenu();
    }
  });

  /* ---------------------------------------------------------------
     Active section in the landing nav
     --------------------------------------------------------------- */
  const navLinks = Array.from(
    document.querySelectorAll("#landingNavLinks a[href^='#']")
  );

  if (navLinks.length && "IntersectionObserver" in window) {
    const byId = new Map();
    navLinks.forEach((link) => {
      const id = link.getAttribute("href");
      const section = id ? document.querySelector(id) : null;
      if (section) byId.set(section, link);
    });

    const sectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          navLinks.forEach((link) => link.classList.remove("is-active"));
          const active = byId.get(entry.target);
          if (active) active.classList.add("is-active");
        });
      },
      { rootMargin: "-38% 0px -54% 0px", threshold: 0 }
    );

    byId.forEach((_link, section) => sectionObserver.observe(section));
  }

  /* ---------------------------------------------------------------
     Theme: keep the browser chrome colour in sync
     --------------------------------------------------------------- */
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  function syncThemeColour() {
    if (!themeMeta) return;
    const light = document.body.classList.contains("light-theme");
    themeMeta.setAttribute("content", light ? "#f7f4ed" : "#070a12");
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('[data-action="toggle-theme"]')) return;
    window.setTimeout(syncThemeColour, 0);
  });

  syncThemeColour();

  /* ---------------------------------------------------------------
     Small accessibility niceties
     --------------------------------------------------------------- */
  const footerYear = $("#footerYear");
  if (footerYear && !footerYear.textContent.trim()) {
    footerYear.textContent = String(new Date().getFullYear());
  }

  // Do not let an empty "#" placeholder jump the page around.
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest('a[href="#"]');
    if (link) event.preventDefault();
  });
})();
