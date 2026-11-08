/* Runs before the rest of <body> is parsed so the saved theme and intro
   decision are applied before the first paint. Keeping this external also
   lets the app use a strict Content-Security-Policy without inline scripts. */
(function () {
  var root = document.documentElement;
  root.classList.add("hh-js");

  try {
    var forced = new URLSearchParams(window.location.search).get("intro") === "1";
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var seen = false;
    try { seen = sessionStorage.getItem("hostelhub_intro_seen") === "1"; } catch (_) {}
    if (reduce || (!forced && seen)) root.classList.add("hh-intro-skipped");
  } catch (_) {}

  var theme = "dark";
  try {
    if (localStorage.getItem("hostelhub_theme") === "light") theme = "light";
  } catch (_) {}

  if (theme === "light") document.body.classList.add("light-theme");
  root.style.colorScheme = theme;

  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f7f4ed" : "#070a12");
})();
