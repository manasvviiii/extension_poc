/**
 * Knowledge Hub Documentation Loader & Search Engine (knowledge.js)
 */

const KNOWLEDGE_ARTICLES = [
  {
    id: "architecture",
    category: "Architecture",
    title: "WarmGraph High-Level Architecture",
    file: "docs/architecture.md",
    readTime: "6 min read",
    snippet: "Client-first relationship intelligence platform architecture, background acquisition sessions, and privacy isolation."
  },
  {
    id: "acquisition",
    category: "Acquisition",
    title: "LinkedIn Acquisition Pipeline",
    file: "docs/acquisition.md",
    readTime: "8 min read",
    snippet: "20-25s human pacing engine protocol, non-interruptive visual overlay states, and local storage deduplication."
  },
  {
    id: "graph_engine",
    category: "Graph Engine",
    title: "Graph Generation & Traversal Pipeline",
    file: "docs/graph_engine.md",
    readTime: "7 min read",
    snippet: "Weighted Dijkstra shortest warm path algorithm, matrix performance benchmarks, and sub-second calculation times."
  },
  {
    id: "relationship",
    category: "Relationship Evidence",
    title: "Relationship Evidence Model",
    file: "docs/relationship.md",
    readTime: "5 min read",
    snippet: "Multi-factor relationship strength calculation based on mutual connection density, interaction recency, and firm overlap."
  },
  {
    id: "banking",
    category: "Investment Banking",
    title: "Investment Banking & Dealmaking Workflow",
    file: "docs/banking.md",
    readTime: "5 min read",
    snippet: "Private equity buy-side sourcing, sell-side M&A advisory, and response rate comparison vs cold outreach."
  },
  {
    id: "roadmap",
    category: "Roadmap",
    title: "Product Roadmap & Engineering Milestones",
    file: "docs/roadmap.md",
    readTime: "4 min read",
    snippet: "Comprehensive product journey outlining implemented features, current development, and planned engineering goals."
  }
];

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('doc-article-title')) return;
  initKnowledgeHub();
});

async function initKnowledgeHub() {
  setupSidebarNavigation();
  setupInstantSearch();
  
  // Load default article from URL hash or default to 'architecture'
  const hash = window.location.hash.replace('#', '');
  const initialDoc = KNOWLEDGE_ARTICLES.find(a => a.id === hash) || KNOWLEDGE_ARTICLES[0];
  await loadArticle(initialDoc);
}

function setupSidebarNavigation() {
  const categoryList = document.getElementById('category-list');
  if (!categoryList) return;

  categoryList.innerHTML = KNOWLEDGE_ARTICLES.map(article => `
    <li class="category-item ${article.id === 'architecture' ? 'active' : ''}" data-doc-id="${article.id}">
      <span>${article.title}</span>
    </li>
  `).join('');

  categoryList.querySelectorAll('.category-item').forEach(item => {
    item.addEventListener('click', async () => {
      const docId = item.getAttribute('data-doc-id');
      const article = KNOWLEDGE_ARTICLES.find(a => a.id === docId);
      if (article) {
        categoryList.querySelectorAll('.category-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        window.location.hash = docId;
        await loadArticle(article);
      }
    });
  });
}

function setupInstantSearch() {
  const searchInput = document.getElementById('knowledge-search');
  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    const items = document.querySelectorAll('.category-item');

    items.forEach(item => {
      const docId = item.getAttribute('data-doc-id');
      const article = KNOWLEDGE_ARTICLES.find(a => a.id === docId);
      if (!article) return;

      const matches = article.title.toLowerCase().includes(query) ||
                      article.category.toLowerCase().includes(query) ||
                      article.snippet.toLowerCase().includes(query);

      item.style.display = matches ? 'flex' : 'none';
    });
  });
}

async function loadArticle(article) {
  const titleEl = document.getElementById('doc-article-title');
  const metaEl = document.getElementById('doc-article-meta');
  const bodyEl = document.getElementById('doc-article-body');

  if (!titleEl || !bodyEl) return;

  titleEl.textContent = article.title;
  metaEl.innerHTML = `<span class="hub-tag">${article.category.toUpperCase()}</span> • <span>${article.readTime}</span>`;
  bodyEl.innerHTML = '<p style="color: var(--text-muted);">Loading documentation...</p>';

  try {
    const res = await fetch(article.file);
    if (!res.ok) throw new Error('File fetch failed');
    const markdown = await res.text();
    bodyEl.innerHTML = parseCustomMarkdown(markdown);
  } catch (err) {
    // Fallback if local server not active
    bodyEl.innerHTML = `
      <div class="doc-callout doc-callout-note">
        <strong>Overview:</strong> ${article.snippet}
      </div>
      <p>Detailed documentation for <strong>${article.title}</strong> is available in <code>${article.file}</code>.</p>
    `;
  }
}

/**
 * Custom Markdown Parser for Knowledge Articles
 */
function parseCustomMarkdown(md) {
  let html = md;

  // Code Blocks
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="doc-code-block"><code>$2</code></pre>');

  // Callouts
  html = html.replace(/^>\s*\[!NOTE\]\s*(.*)$/gim, '<div class="doc-callout doc-callout-note"><strong>NOTE:</strong> $1</div>');
  html = html.replace(/^>\s*\[!IMPORTANT\]\s*(.*)$/gim, '<div class="doc-callout doc-callout-important"><strong>IMPORTANT:</strong> $1</div>');
  html = html.replace(/^>\s*\[!WARNING\]\s*(.*)$/gim, '<div class="doc-callout doc-callout-warning"><strong>WARNING:</strong> $1</div>');

  // Headings
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Bold & Italic
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Unordered Lists
  html = html.replace(/^\s*-\s+(.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>');

  // Tables simple parse
  html = html.replace(/\|(.+)\|/g, (match) => {
    const cols = match.split('|').filter(c => c.trim() !== '').map(c => `<td>${c.trim()}</td>`).join('');
    return `<tr>${cols}</tr>`;
  });
  html = html.replace(/(<tr>.*<\/tr>)/g, '<table class="doc-table">$1</table>');

  // Paragraphs
  html = html.replace(/^\s*([^<#>\-\|].*)$/gim, '<p>$1</p>');

  return html;
}
