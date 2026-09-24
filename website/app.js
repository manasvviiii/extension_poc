/**
 * WarmGraph SaaS Website Interactive Engine
 */

document.addEventListener('DOMContentLoaded', () => {
  initShowcaseTabs();
  initScrollAnimations();
  initHeroGraphInteraction();
  initMobileMenu();
});

/**
 * Showcase Tabs Controller
 */
function initShowcaseTabs() {
  const tabs = document.querySelectorAll('.showcase-tab');
  const panels = document.querySelectorAll('.showcase-content-panel');

  if (!tabs.length || !panels.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-tab');

      // Deactivate all
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      // Activate clicked
      tab.classList.add('active');
      const activePanel = document.getElementById(targetId);
      if (activePanel) {
        activePanel.classList.add('active');
      }
    });
  });
}

/**
 * Scroll Trigger Animations using IntersectionObserver
 */
function initScrollAnimations() {
  const animatedElements = document.querySelectorAll('.step-card, .hub-card, .trust-item, .roadmap-item, .cta-glass-box');

  const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.15
  };

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        obs.unobserve(entry.target);
      }
    });
  }, observerOptions);

  animatedElements.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
    observer.observe(el);
  });
}

/**
 * Interactive Hero Graph Nodes
 */
function initHeroGraphInteraction() {
  const nodes = document.querySelectorAll('.node-item');
  const descEl = document.querySelector('.path-desc');
  const scoreEl = document.querySelector('.path-score');

  if (!nodes.length || !descEl || !scoreEl) return;

  const nodeDetails = {
    'node-you': {
      desc: 'You (Alex Mercer - Managing Director)',
      score: 'Source Node'
    },
    'node-bridge1': {
      desc: 'Bridge 1: Sarah Jenkins (Partner at Sequoia)',
      score: 'Weight: 0.92 • Strong Connection'
    },
    'node-bridge2': {
      desc: 'Bridge 2: David Vance (Head of M&A)',
      score: 'Weight: 0.88 • High Trust'
    },
    'node-target': {
      desc: 'Target: Elena Rostova (VP Investment Tech)',
      score: 'Score: 94/100 • 2-Hop Path Found'
    }
  };

  nodes.forEach(node => {
    node.addEventListener('mouseenter', () => {
      const classList = Array.from(node.classList);
      const key = classList.find(c => nodeDetails[c]);
      if (key && nodeDetails[key]) {
        descEl.textContent = nodeDetails[key].desc;
        scoreEl.textContent = nodeDetails[key].score;
      }
    });

    node.addEventListener('mouseleave', () => {
      descEl.textContent = 'You → Sarah Jenkins → Elena Rostova';
      scoreEl.textContent = '94/100 Warm Score';
    });
  });
}

/**
 * Mobile Navigation Menu Toggle
 */
function initMobileMenu() {
  const toggleBtn = document.querySelector('.mobile-toggle');
  const navLinks = document.querySelector('.nav-links');

  if (!toggleBtn || !navLinks) return;

  toggleBtn.addEventListener('click', () => {
    const isExpanded = navLinks.style.display === 'flex';
    if (isExpanded) {
      navLinks.style.display = 'none';
    } else {
      navLinks.style.display = 'flex';
      navLinks.style.flexDirection = 'column';
      navLinks.style.position = 'absolute';
      navLinks.style.top = '76px';
      navLinks.style.left = '0';
      navLinks.style.right = '0';
      navLinks.style.background = 'rgba(7, 11, 26, 0.95)';
      navLinks.style.padding = '24px';
      navLinks.style.borderBottom = '1px solid rgba(255, 255, 255, 0.1)';
    }
  });
}
