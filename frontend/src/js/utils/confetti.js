export function launchConfetti({ duration = 2500, particleCount = 80, cooldownMs = 6000 } = {}) {
    try {
        if (!window.__lastConfettiAt) window.__lastConfettiAt = 0;
        const now = Date.now();
        if (now - window.__lastConfettiAt < cooldownMs) return;
        window.__lastConfettiAt = now;

        const canvas = document.createElement('canvas');
        canvas.style.position = 'fixed';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = 9999;
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('2d');

        const colors = ['#fde68a', '#f97316', '#34d399', '#60a5fa', '#f472b6', '#a78bfa'];
        const particles = [];
        for (let i = 0; i < particleCount; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: -10 - Math.random() * 200,
                vx: (Math.random() - 0.5) * 6,
                vy: Math.random() * 4 + 2,
                size: Math.random() * 10 + 6,
                rot: Math.random() * Math.PI * 2,
                vr: (Math.random() - 0.5) * 0.2,
                color: colors[Math.floor(Math.random() * colors.length)],
            });
        }

        const start = performance.now();
        function frame(t) {
            const elapsed = t - start;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy + (elapsed / 3000);
                p.vy += 0.03;
                p.rot += p.vr;

                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size * 0.6);
                ctx.restore();
            });

            if (elapsed < duration) {
                requestAnimationFrame(frame);
            } else {
                let alpha = 1;
                const fadeStart = performance.now();
                (function fade() {
                    const e = performance.now() - fadeStart;
                    alpha = Math.max(1 - e / 300, 0);
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.globalAlpha = alpha;
                    particles.forEach(p => {
                        ctx.save();
                        ctx.translate(p.x, p.y);
                        ctx.rotate(p.rot);
                        ctx.fillStyle = p.color;
                        ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size * 0.6);
                        ctx.restore();
                    });
                    ctx.globalAlpha = 1;
                    if (alpha > 0) requestAnimationFrame(fade);
                    else {
                        document.body.removeChild(canvas);
                    }
                })();
            }
        }

        requestAnimationFrame(frame);
    } catch (e) {
        console.warn('Confetti fallback error', e);
    }
}
