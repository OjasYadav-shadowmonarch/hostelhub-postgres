
(() => {
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  const mobile = window.matchMedia("(max-width: 700px)");

  function setupBackground(root) {
    const canvas = root.querySelector(".role-bg-canvas");
    const glow = root.querySelector(".role-bg-glow");
    const ctx = canvas?.getContext("2d");

    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    let particles = [];
    let raf = 0;
    let lastDraw = 0;

    function resize() {
      const rect = root.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

      width = rect.width;
      height = rect.height;

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const role = root.dataset.bgRole;
      const density = mobile.matches ? 19000 : 12000;
      const limit = role === "admin" ? 62 : role === "owner" ? 50 : 70;
      const count = Math.min(limit, Math.max(18, Math.floor(width * height / density)));

      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: Math.random() * 1.6 + 0.7
      }));

      draw(performance.now(), true);
    }

    function draw(time, staticFrame = false) {
      const accent = getComputedStyle(root)
        .getPropertyValue("--role-accent").trim() || "52, 211, 224";

      ctx.clearRect(0, 0, width, height);

      particles.forEach((p, i) => {
        if (!staticFrame && !reduceMotion.matches) {
          p.x += p.vx;
          p.y += p.vy;

          if (p.x < 0 || p.x > width) p.vx *= -1;
          if (p.y < 0 || p.y > height) p.vy *= -1;
        }

        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const distance = Math.hypot(dx, dy);

          if (distance < 125) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = `rgba(${accent}, ${(1 - distance / 125) * 0.24})`;
            ctx.lineWidth = 0.7;
            ctx.stroke();
          }
        }

        const pulse = reduceMotion.matches
          ? 1
          : 0.8 + 0.2 * Math.sin(time * 0.0015 + i);

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${accent}, .07)`;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * pulse, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${accent}, .9)`;
        ctx.fill();
      });
    }

    function animate(time) {
      raf = 0;

      if (document.hidden || root.closest("[hidden]")) return;

      if (time - lastDraw > 30) {
        draw(time);
        lastDraw = time;
      }

      raf = requestAnimationFrame(animate);
    }

    function start() {
      if (raf || document.hidden || root.closest("[hidden]")) return;

      if (reduceMotion.matches) {
        draw(0, true);
        return;
      }

      raf = requestAnimationFrame(animate);
    }

    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    root.addEventListener("pointermove", event => {
      if (mobile.matches || reduceMotion.matches || !glow) return;

      const rect = root.getBoundingClientRect();
      glow.style.setProperty("--glow-x", `${event.clientX - rect.left}px`);
      glow.style.setProperty("--glow-y", `${event.clientY - rect.top}px`);
    }, { passive: true });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else start();
    });

    window.addEventListener("resize", resize, { passive: true });

    reduceMotion.addEventListener?.("change", () => {
      stop();
      draw(0, true);
      start();
    });

    resize();
    start();

    return { start, stop };
  }

  window.HostelHubRoleBackgrounds = {
    setup() {
      document.querySelectorAll(".role-bg").forEach(setupBackground);
    }
  };

  window.HostelHubRoleBackgrounds.setup();
})();

