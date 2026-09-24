/**
 * Main Application Script for WarmGraph SaaS Landing & App (app.js)
 */

document.addEventListener('DOMContentLoaded', () => {
  initShowcaseTabs();
  initHeroGraphInteraction();
  initMobileMenu();
  initStickyHeaderBlur();
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

      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const activePanel = document.getElementById(targetId);
      if (activePanel) {
        activePanel.classList.add('active');
      }
    });
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
    'node-you': { desc: 'You (Alex Mercer - Managing Director)', score: 'Source Node' },
    'node-bridge1': { desc: 'Bridge 1: Sarah Jenkins (Partner at Sequoia)', score: 'Weight: 0.92 • Strong' },
    'node-bridge2': { desc: 'Bridge 2: David Vance (Head of M&A)', score: 'Weight: 0.88 • High Trust' },
    'node-target': { desc: 'Target: Elena Rostova (VP Investment Tech)', score: 'Score: 94/100 • 2-Hop Path' }
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
 * Mobile Navigation Toggle
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

/**
 * Sticky Header Blur on Scroll
 */
function initStickyHeaderBlur() {
  const header = document.querySelector('.header');
  if (!header) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 20) {
      header.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.5)';
    } else {
      header.style.boxShadow = 'none';
    }
  });
}
