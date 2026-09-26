/**
 * Main Application Script for WarmGraph SaaS Landing & App (app.js)
 */

document.addEventListener('DOMContentLoaded', () => {
  initShowcaseTabs();
  initHeroGraphInteraction();
  initMobileMenu();
  initStickyHeaderBlur();
  initInstallModal();
  initInteractiveDemo();
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

/**
 * Premium Installation Modal (Task 4A)
 */
function initInstallModal() {
  let modal = document.getElementById('warmgraph-install-modal');

  // Dynamically inject modal if not present
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'warmgraph-install-modal';
    modal.className = 'install-modal-backdrop';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="install-modal-card">
        <div class="install-modal-header">
          <div class="install-modal-brand">
            <div class="logo-badge" style="width: 32px; height: 32px;">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2.2">
                <circle cx="6" cy="6" r="3" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="12" cy="18" r="3" />
                <path d="M8.5 7.5L15.5 7.5 M7.5 8.5L10.5 15.5 M16.5 8.5L13.5 15.5" />
              </svg>
            </div>
            <h3>Install WarmGraph Extension</h3>
          </div>
          <button class="install-modal-close" aria-label="Close modal">&times;</button>
        </div>

        <div class="install-modal-body">
          <p class="install-modal-text">
            WarmGraph is a Chrome Extension that quietly maps your LinkedIn network. Install it once, pin it to Chrome, and begin building your relationship graph.
          </p>

          <div class="install-steps-container">
            <div class="install-step">
              <span class="step-num">1</span>
              <div class="step-details">
                <strong>Open Chrome Extensions</strong>
                <p>Open <code>chrome://extensions</code> in your Chrome browser window.</p>
              </div>
            </div>

            <div class="install-step">
              <span class="step-num">2</span>
              <div class="step-details">
                <strong>Enable Developer Mode</strong>
                <p>Toggle the <b>Developer mode</b> switch in the top-right corner of the Extensions page.</p>
              </div>
            </div>

            <div class="install-step">
              <span class="step-num">3</span>
              <div class="step-details">
                <strong>Load Unpacked Extension</strong>
                <p>Click <b>Load unpacked</b> and select the <code>/extension</code> folder from this workspace.</p>
              </div>
            </div>
          </div>
        </div>

        <div class="install-modal-footer">
          <button class="btn-primary btn-install-guide">Open Installation Guide</button>
          <button class="btn-secondary btn-install-close">Maybe later</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const openModal = (e) => {
    if (e) e.preventDefault();
    modal.style.display = 'flex';
  };

  const closeModal = () => {
    modal.style.display = 'none';
  };

  // Bind to CTA buttons across pages
  const ctaButtons = document.querySelectorAll('.nav-cta-btn, .open-install-modal, [data-action="install"]');
  ctaButtons.forEach(btn => {
    btn.addEventListener('click', openModal);
  });

  // Bind close events
  const closeBtn = modal.querySelector('.install-modal-close');
  const maybeLaterBtn = modal.querySelector('.btn-install-close');
  const guideBtn = modal.querySelector('.btn-install-guide');

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (maybeLaterBtn) maybeLaterBtn.addEventListener('click', closeModal);
  if (guideBtn) {
    guideBtn.addEventListener('click', () => {
      alert("Installation Guide:\n\n1. Open chrome://extensions in Chrome\n2. Turn on 'Developer mode'\n3. Click 'Load unpacked' and select the '/extension' directory.");
    });
  }

  // Backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Escape key press
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') {
      closeModal();
    }
  });
}

/**
 * Interactive Product Demo Controller (Task 6)
 */
function initInteractiveDemo() {
  const networkListEl = document.getElementById('demo-network-list');
  const searchInputEl = document.getElementById('demo-search-input');
  const searchStatusEl = document.getElementById('demo-search-status');
  const presetContainerEl = document.getElementById('preset-buttons-container');
  const svgCanvasEl = document.getElementById('demo-graph-svg');
  const nodesOverlayEl = document.getElementById('demo-nodes-overlay');
  const pathStringEl = document.getElementById('demo-path-string');
  const scoreNumberEl = document.getElementById('demo-score-number');
  const evidenceListEl = document.getElementById('demo-evidence-list');

  if (!networkListEl || !svgCanvasEl || !nodesOverlayEl) return;

  const DEMO_DATASET = {
    network: [
      { id: 'you', name: 'You (Alex Mercer)', company: 'WarmGraph Capital', role: 'Managing Director', initials: 'YOU', isSource: true, avatarBg: '#38bdf8' },
      { id: 'sarah', name: 'Sarah Jenkins', company: 'Sequoia Capital', role: 'Partner', initials: 'SJ', avatarBg: '#8b5cf6' },
      { id: 'david', name: 'David Vance', company: 'Goldman Sachs', role: 'Head of M&A', initials: 'DV', avatarBg: '#ec4899' },
      { id: 'elena', name: 'Elena Rostova', company: 'Apex Partners', role: 'VP Investment Tech', initials: 'ER', avatarBg: '#10b981' },
      { id: 'michael', name: 'Michael Chen', company: 'Benchmark', role: 'General Partner', initials: 'MC', avatarBg: '#f59e0b' },
      { id: 'taylor', name: 'Taylor Reed', company: 'Morgan Stanley', role: 'Managing Director', initials: 'TR', avatarBg: '#06b6d4' },
      { id: 'emma', name: 'Emma Brooks', company: 'Stripe', role: 'Chief Strategy Officer', initials: 'EB', avatarBg: '#a855f7' },
      { id: 'alex_t', name: 'Alex Turner', company: 'TechVentures', role: 'Co-Founder & CEO', initials: 'AT', avatarBg: '#3b82f6' }
    ],
    targets: {
      elena: {
        id: 'elena',
        name: 'Elena Rostova',
        role: 'VP Investment Tech at Apex Partners',
        path: ['you', 'sarah', 'elena'],
        pathLabel: 'You → Sarah Jenkins → Elena Rostova',
        warmScore: 94,
        evidence: [
          'Worked together at Morgan Stanley',
          '2 shared board introductions',
          'Strong mutual interaction history'
        ]
      },
      david: {
        id: 'david',
        name: 'David Vance',
        role: 'Head of M&A at Goldman Sachs',
        path: ['you', 'michael', 'david'],
        pathLabel: 'You → Michael Chen → David Vance',
        warmScore: 88,
        evidence: [
          'Co-investors in Series A round',
          '4 recent email exchanges',
          'Shared alumni network (Stanford MBA)'
        ]
      },
      michael: {
        id: 'michael',
        name: 'Michael Chen',
        role: 'General Partner at Benchmark',
        path: ['you', 'taylor', 'michael'],
        pathLabel: 'You → Taylor Reed → Michael Chen',
        warmScore: 91,
        evidence: [
          'Former colleagues at Goldman Sachs',
          'Co-authored research whitepaper',
          'Active quarterly syncs'
        ]
      }
    },
    coords: {
      you: { x: 80, y: 160 },
      sarah: { x: 230, y: 75 },
      michael: { x: 230, y: 245 },
      taylor: { x: 380, y: 245 },
      david: { x: 440, y: 75 },
      elena: { x: 520, y: 160 },
      emma: { x: 130, y: 270 },
      alex_t: { x: 350, y: 50 }
    },
    edges: [
      { from: 'you', to: 'sarah' },
      { from: 'you', to: 'michael' },
      { from: 'you', to: 'emma' },
      { from: 'sarah', to: 'elena' },
      { from: 'sarah', to: 'alex_t' },
      { from: 'sarah', to: 'david' },
      { from: 'michael', to: 'david' },
      { from: 'michael', to: 'taylor' },
      { from: 'taylor', to: 'michael' },
      { from: 'taylor', to: 'elena' },
      { from: 'david', to: 'elena' }
    ]
  };

  let activeTargetKey = 'elena';
  let animationTimer1 = null;
  let animationTimer2 = null;
  let animationTimer3 = null;

  function renderNetworkList() {
    networkListEl.innerHTML = '';
    DEMO_DATASET.network.forEach(person => {
      const card = document.createElement('div');
      card.className = `network-card-item ${person.id === 'you' ? 'active' : ''}`;
      card.dataset.personId = person.id;
      card.innerHTML = `
        <div class="network-avatar" style="background: ${person.avatarBg};">${person.initials}</div>
        <div class="network-details">
          <span class="network-name">${person.name}</span>
          <span class="network-role">${person.role} • ${person.company}</span>
        </div>
      `;

      card.addEventListener('click', () => {
        if (DEMO_DATASET.targets[person.id]) {
          selectTarget(person.id);
        } else {
          document.querySelectorAll('.network-card-item').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
        }
      });
      networkListEl.appendChild(card);
    });
  }

  function renderGraphBase() {
    const defs = svgCanvasEl.querySelector('defs');
    svgCanvasEl.innerHTML = '';
    if (defs) svgCanvasEl.appendChild(defs);

    DEMO_DATASET.edges.forEach(edge => {
      const p1 = DEMO_DATASET.coords[edge.from];
      const p2 = DEMO_DATASET.coords[edge.to];
      if (p1 && p2) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', p1.x);
        line.setAttribute('y1', p1.y);
        line.setAttribute('x2', p2.x);
        line.setAttribute('y2', p2.y);
        line.setAttribute('stroke', 'rgba(255, 255, 255, 0.12)');
        line.setAttribute('stroke-width', '1.5');
        line.setAttribute('id', `edge-${edge.from}-${edge.to}`);
        svgCanvasEl.appendChild(line);
      }
    });

    nodesOverlayEl.innerHTML = '';
    DEMO_DATASET.network.forEach(person => {
      const pos = DEMO_DATASET.coords[person.id];
      if (!pos) return;

      const bubble = document.createElement('div');
      bubble.className = `graph-node-bubble ${person.isSource ? 'is-source' : ''}`;
      bubble.id = `node-bubble-${person.id}`;
      bubble.style.left = `${(pos.x / 600) * 100}%`;
      bubble.style.top = `${(pos.y / 320) * 100}%`;

      bubble.innerHTML = `
        <div class="bubble-avatar" style="background: ${person.avatarBg};">${person.initials}</div>
        <span class="bubble-label">${person.name.split(' ')[0]}</span>
      `;

      bubble.addEventListener('click', () => {
        if (DEMO_DATASET.targets[person.id]) {
          selectTarget(person.id);
        }
      });

      nodesOverlayEl.appendChild(bubble);
    });
  }

  function selectTarget(targetKey) {
    if (!DEMO_DATASET.targets[targetKey]) return;
    activeTargetKey = targetKey;
    const targetData = DEMO_DATASET.targets[targetKey];

    if (animationTimer1) clearTimeout(animationTimer1);
    if (animationTimer2) clearTimeout(animationTimer2);
    if (animationTimer3) clearTimeout(animationTimer3);

    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.target === targetKey);
    });
    if (searchInputEl) searchInputEl.value = `${targetData.name} (${targetData.role.split(' at ')[0]})`;
    if (searchStatusEl) searchStatusEl.textContent = 'Tracing Graph...';

    document.querySelectorAll('.network-card-item').forEach(card => {
      const pId = card.dataset.personId;
      card.classList.toggle('active', pId === 'you' || pId === targetKey);
      card.classList.toggle('in-path', targetData.path.includes(pId));
    });

    const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    document.querySelectorAll('.graph-node-bubble').forEach(b => {
      b.className = 'graph-node-bubble is-faded';
    });
    document.querySelectorAll('.active-path-line').forEach(el => el.remove());

    if (isReducedMotion) {
      targetData.path.forEach((pId, idx) => {
        const b = document.getElementById(`node-bubble-${pId}`);
        if (b) {
          b.className = 'graph-node-bubble';
          if (idx === 0) b.classList.add('is-source');
          else if (idx === targetData.path.length - 1) b.classList.add('is-target');
          else b.classList.add('is-illuminated');
        }
      });
      drawPathEdges(targetData.path);
      updateResultCard(targetData, false);
      if (searchStatusEl) searchStatusEl.textContent = 'Path Discovered';
      return;
    }

    const youNode = document.getElementById('node-bubble-you');
    if (youNode) youNode.className = 'graph-node-bubble is-source';

    animationTimer1 = setTimeout(() => {
      const bridgeId = targetData.path[1];
      const bridgeNode = document.getElementById(`node-bubble-${bridgeId}`);
      if (bridgeNode) bridgeNode.className = 'graph-node-bubble is-illuminated';

      drawSinglePathEdge('you', bridgeId);
    }, 600);

    animationTimer2 = setTimeout(() => {
      const bridgeId = targetData.path[1];
      const targetNode = document.getElementById(`node-bubble-${targetKey}`);
      if (targetNode) targetNode.className = 'graph-node-bubble is-target';

      drawSinglePathEdge(bridgeId, targetKey);
      if (searchStatusEl) searchStatusEl.textContent = 'Path Discovered';
    }, 1400);

    animationTimer3 = setTimeout(() => {
      updateResultCard(targetData, true);
    }, 2100);
  }

  function drawSinglePathEdge(fromId, toId) {
    const p1 = DEMO_DATASET.coords[fromId];
    const p2 = DEMO_DATASET.coords[toId];
    if (!p1 || !p2) return;

    const pathLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    pathLine.setAttribute('x1', p1.x);
    pathLine.setAttribute('y1', p1.y);
    pathLine.setAttribute('x2', p2.x);
    pathLine.setAttribute('y2', p2.y);
    pathLine.setAttribute('stroke', 'url(#active-path-grad)');
    pathLine.setAttribute('stroke-width', '4');
    pathLine.setAttribute('filter', 'url(#neon-glow)');
    pathLine.setAttribute('class', 'active-path-line');

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    pathLine.style.strokeDasharray = len;
    pathLine.style.strokeDashoffset = len;
    pathLine.style.transition = 'stroke-dashoffset 0.6s cubic-bezier(0.16, 1, 0.3, 1)';

    svgCanvasEl.appendChild(pathLine);

    requestAnimationFrame(() => {
      pathLine.style.strokeDashoffset = '0';
    });
  }

  function drawPathEdges(pathArray) {
    for (let i = 0; i < pathArray.length - 1; i++) {
      drawSinglePathEdge(pathArray[i], pathArray[i + 1]);
    }
  }

  function updateResultCard(targetData, animateScore) {
    if (pathStringEl) pathStringEl.textContent = targetData.pathLabel;

    if (evidenceListEl) {
      evidenceListEl.innerHTML = '';
      targetData.evidence.forEach(item => {
        const li = document.createElement('li');
        li.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg><span>${item}</span>`;
        evidenceListEl.appendChild(li);
      });
    }

    if (scoreNumberEl) {
      if (animateScore) {
        let current = 0;
        const targetNum = targetData.warmScore;
        const duration = 800;
        const interval = 25;
        const step = Math.ceil(targetNum / (duration / interval));

        const timer = setInterval(() => {
          current += step;
          if (current >= targetNum) {
            current = targetNum;
            clearInterval(timer);
          }
          scoreNumberEl.textContent = current;
        }, interval);
      } else {
        scoreNumberEl.textContent = targetData.warmScore;
      }
    }
  }

  if (presetContainerEl) {
    presetContainerEl.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetKey = btn.dataset.target;
        if (targetKey) selectTarget(targetKey);
      });
    });
  }

  renderNetworkList();
  renderGraphBase();
  selectTarget('elena');
}
