/**
 * WarmGraph SaaS Website Animations Engine (animations.js)
 */

document.addEventListener('DOMContentLoaded', () => {
  initScrollTrigger();
  initCounterAnimation();
});

/**
 * Scroll Trigger Observer for Smooth Fade In
 */
function initScrollTrigger() {
  const elements = document.querySelectorAll('.step-card, .hub-card, .trust-item, .roadmap-card, .cta-glass-box, .doc-article-container');

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  elements.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
    observer.observe(el);
  });
}

/**
 * Trust Strip Metric Counters Animation
 */
function initCounterAnimation() {
  const counters = document.querySelectorAll('.trust-number');
  if (!counters.length) return;

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const targetText = el.textContent.trim();
        const numericMatch = targetText.match(/\d+/);
        if (numericMatch) {
          const targetNum = parseInt(numericMatch[0], 10);
          let currentNum = 0;
          const duration = 1500;
          const stepTime = 30;
          const increment = Math.ceil(targetNum / (duration / stepTime));

          const timer = setInterval(() => {
            currentNum += increment;
            if (currentNum >= targetNum) {
              currentNum = targetNum;
              clearInterval(timer);
            }
            el.textContent = targetText.replace(/\d+/, currentNum);
          }, stepTime);
        }
        obs.unobserve(el);
      }
    });
  }, { threshold: 0.5 });

  counters.forEach(c => observer.observe(c));
}
