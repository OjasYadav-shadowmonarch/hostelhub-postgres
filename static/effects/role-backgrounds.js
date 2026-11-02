
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

  // The screen may still be hidden during initialization.
  if (rect.width === 0 || rect.height === 0) {
    stop();
    return;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

  width = rect.width;
  height = rect.height;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const role = root.dataset.bgRole;
  const density = mobile.matches ? 19000 : 12000;
  const limit = role === "admin" ? 62 : role === "owner" ? 50 : 70;
  const count = Math.min(
    limit,
    Math.max(18, Math.floor(width * height / density))
  );

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
    .getPropertyValue("--role-accent")
    .trim() || "52, 211, 224";

  const role = root.dataset.bgRole || "student";

  ctx.clearRect(0, 0, width, height);

  // Move particles
  particles.forEach((p) => {
    if (!staticFrame && !reduceMotion.matches) {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0 || p.x > width) p.vx *= -1;
      if (p.y < 0 || p.y > height) p.vy *= -1;
    }
  });

  // STUDENT: Connected particle network
  if (role === "student") {
    particles.forEach((p, i) => {
      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j];
        const distance = Math.hypot(p.x - q.x, p.y - q.y);

        if (distance < 125) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.strokeStyle =
            `rgba(${accent}, ${(1 - distance / 125) * 0.3})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    });

    particles.forEach((p, i) => {
      const pulse = reduceMotion.matches
        ? 1
        : 0.8 + 0.2 * Math.sin(time * 0.0015 + i);

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${accent}, 0.08)`;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * pulse, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${accent}, 0.9)`;
      ctx.fill();
    });
  }

  // OWNER: Architectural blueprint and perspective grid
  else if (role === "owner") {
    ctx.save();
    ctx.strokeStyle = `rgba(${accent}, 0.22)`;
    ctx.lineWidth = 1;

    // Building outlines
    const blockWidth = 100;
    const blockHeight = 135;
    const offset = (time * 0.008) % blockWidth;

    for (let x = -blockWidth; x < width + blockWidth; x += blockWidth) {
      for (let y = 35; y < height; y += blockHeight) {
        const bx = x + offset;
        const by = y;

        ctx.strokeRect(bx, by, 62, 90);

        // Window lines
        ctx.beginPath();
        ctx.moveTo(bx + 12, by + 20);
        ctx.lineTo(bx + 50, by + 20);
        ctx.moveTo(bx + 12, by + 40);
        ctx.lineTo(bx + 50, by + 40);
        ctx.moveTo(bx + 12, by + 60);
        ctx.lineTo(bx + 50, by + 60);
        ctx.stroke();
      }
    }

    // Perspective floor lines
    const horizonX = width / 2;
    const horizonY = height * 0.48;

    for (let x = -width; x <= width * 2; x += 75) {
      ctx.beginPath();
      ctx.moveTo(horizonX, horizonY);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    for (let i = 1; i <= 8; i++) {
      const progress = i / 8;
      const y = horizonY + (height - horizonY) * progress * progress;

      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ADMIN: Radar and scanning interface
  else if (role === "admin") {
    ctx.save();

    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(width, height) * 0.42;

    ctx.strokeStyle = `rgba(${accent}, 0.22)`;
    ctx.lineWidth = 1;

    // Radar rings
    for (let i = 1; i <= 5; i++) {
      ctx.beginPath();
      ctx.arc(
        centerX,
        centerY,
        maxRadius * (i / 5),
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }

    // Radar crosshairs
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - maxRadius);
    ctx.lineTo(centerX, centerY + maxRadius);
    ctx.moveTo(centerX - maxRadius, centerY);
    ctx.lineTo(centerX + maxRadius, centerY);
    ctx.stroke();

    // Rotating scanner; remains still for reduced-motion users
    const angle = reduceMotion.matches
      ? 0
      : time * 0.00035;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(angle);

    const sweep = ctx.createLinearGradient(0, 0, maxRadius, 0);
    sweep.addColorStop(0, `rgba(${accent}, 0.25)`);
    sweep.addColorStop(1, `rgba(${accent}, 0)`);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, maxRadius, -0.18, 0.18);
    ctx.closePath();
    ctx.fillStyle = sweep;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(maxRadius, 0);
    ctx.strokeStyle = `rgba(${accent}, 0.75)`;
    ctx.stroke();

    ctx.restore();

    // Radar targets
    particles.forEach((p, i) => {
      if (i % 3 === 0) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${accent}, 0.85)`;
        ctx.fill();
      }
    });

    ctx.restore();
  }

  // Fallback for an unknown role
  else {
    particles.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${accent}, 0.8)`;
      ctx.fill();
    });
  }
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

const resizeObserver = new ResizeObserver(() => {
  const rect = root.getBoundingClientRect();

  if (rect.width > 0 && rect.height > 0) {
    resize();
    start();
  } else {
    stop();
  }
});

resizeObserver.observe(root);

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

