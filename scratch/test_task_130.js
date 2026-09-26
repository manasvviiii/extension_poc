const fs = require('fs');
const path = require('path');

console.log("=================================================");
console.log("RUNNING TASK 13.0 INTERACTIVE GRAPH VISUALIZATION TESTS");
console.log("=================================================");

const rootDir = path.resolve(__dirname, '..');
const graphHtmlPath = path.join(rootDir, 'website', 'graph.html');
const graphCssPath = path.join(rootDir, 'website', 'css', 'graph.css');
const graphJsPath = path.join(rootDir, 'website', 'js', 'graph.js');

let errors = [];

// [TEST 1] File Existence
console.log("\n[TEST 1] Checking file existence...");
[graphHtmlPath, graphCssPath, graphJsPath].forEach(filePath => {
  const relName = path.relative(rootDir, filePath);
  if (fs.existsSync(filePath)) {
    console.log(`✓ ${relName} exists`);
  } else {
    errors.push(`Missing ${relName}`);
  }
});

// [TEST 2] Validate Cytoscape CDN & Page Structure
console.log("\n[TEST 2] Checking Cytoscape CDN & graph.html elements...");
const htmlContent = fs.readFileSync(graphHtmlPath, 'utf8');

if (htmlContent.includes('cytoscape.min.js')) {
  console.log("✓ Cytoscape.js library script tag present");
} else {
  errors.push("Missing Cytoscape.js library script tag in graph.html");
}

const requiredIds = [
  'cy-canvas',
  'cy-nodes-count',
  'cy-edges-count',
  'graph-search-input',
  'search-results-list',
  'graph-tooltip',
  'warm-path-banner',
  'graph-drawer',
  'graph-drawer-backdrop',
  'gdrawer-avatar',
  'gdrawer-name',
  'gdrawer-headline',
  'gdrawer-company',
  'gdrawer-evidence-list',
  'gdrawer-highlight-path-btn'
];

requiredIds.forEach(id => {
  if (htmlContent.includes(`id="${id}"`)) {
    console.log(`✓ Required element #${id} present in HTML`);
  } else {
    errors.push(`Missing element #${id} in graph.html`);
  }
});

// [TEST 3] Validate CSS Theme Tokens
console.log("\n[TEST 3] Checking graph.css styling rules...");
const cssContent = fs.readFileSync(graphCssPath, 'utf8');

if (cssContent.includes('#cy-canvas') && cssContent.includes('#0B1220') && cssContent.includes('graph-drawer')) {
  console.log("✓ Cytoscape canvas, #0B1220 theme, and drawer styles verified");
} else {
  errors.push("Cytoscape canvas or drawer styling missing in graph.css");
}

// [TEST 4] Validate JavaScript Cytoscape Visualizer Engine
console.log("\n[TEST 4] Testing graph.js Cytoscape engine...");
const jsContent = fs.readFileSync(graphJsPath, 'utf8');

if (jsContent.includes('cytoscape(') && jsContent.includes('aStar') && jsContent.includes('openGraphDrawer')) {
  console.log("✓ Cytoscape setup, aStar pathfinding, and openGraphDrawer verified");
} else {
  errors.push("Cytoscape setup, aStar, or openGraphDrawer missing in graph.js");
}

if (jsContent.includes('loadGraphDataFromStorage') || jsContent.includes('warmgraph_active_graph')) {
  console.log("✓ Dynamic Cytoscape graph data loader verified");
} else {
  errors.push("Dynamic Cytoscape graph data loader missing or incomplete");
}

// Summary
console.log("\n=================================================");
if (errors.length === 0) {
  console.log("ALL TASK 13.0 ACCEPTANCE TESTS PASSED SUCCESSFULLY! ✓");
} else {
  console.error("TEST FAILURES:");
  errors.forEach(e => console.error(`- ${e}`));
  process.exit(1);
}
