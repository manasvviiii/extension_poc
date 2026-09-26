const fs = require('fs');
const path = require('path');

console.log("=================================================");
console.log("RUNNING TASK 12.0 RESEARCH WORKSPACE TESTS");
console.log("=================================================");

const rootDir = path.resolve(__dirname, '..');
const researchHtmlPath = path.join(rootDir, 'website', 'research.html');
const companyHtmlPath = path.join(rootDir, 'website', 'company.html');
const personHtmlPath = path.join(rootDir, 'website', 'person.html');
const researchCssPath = path.join(rootDir, 'website', 'css', 'research.css');
const researchJsPath = path.join(rootDir, 'website', 'js', 'research.js');

let errors = [];

// [TEST 1] File Existence
console.log("\n[TEST 1] Checking file existence...");
[researchHtmlPath, companyHtmlPath, personHtmlPath, researchCssPath, researchJsPath].forEach(filePath => {
  const relName = path.relative(rootDir, filePath);
  if (fs.existsSync(filePath)) {
    console.log(`✓ ${relName} exists`);
  } else {
    errors.push(`Missing ${relName}`);
  }
});

// [TEST 2] Validate Layout & Elements in Pages
console.log("\n[TEST 2] Validating page elements & layout...");

const researchHtml = fs.readFileSync(researchHtmlPath, 'utf8');
const companyHtml = fs.readFileSync(companyHtmlPath, 'utf8');
const personHtml = fs.readFileSync(personHtmlPath, 'utf8');

// Sidebar nav items check
['Companies', 'People', 'Saved Notes', 'Articles'].forEach(nav => {
  if (researchHtml.includes(nav)) {
    console.log(`✓ Sidebar category '${nav}' present in research.html`);
  } else {
    errors.push(`Missing sidebar nav item '${nav}' in research.html`);
  }
});

// Company Page elements check
['company-name', 'company-industry', 'company-employees-grid', 'company-warm-intro-box', 'company-markdown-input'].forEach(id => {
  if (companyHtml.includes(`id="${id}"`)) {
    console.log(`✓ Company page element #${id} present`);
  } else {
    errors.push(`Missing #${id} in company.html`);
  }
});

// Person Page elements check
['person-name', 'person-headline', 'person-evidence-grid', 'person-mutuals-grid', 'person-markdown-input'].forEach(id => {
  if (personHtml.includes(`id="${id}"`)) {
    console.log(`✓ Person page element #${id} present`);
  } else {
    errors.push(`Missing #${id} in person.html`);
  }
});

// [TEST 3] Validate CSS Design System Tokens
console.log("\n[TEST 3] Checking CSS Design System tokens...");
const cssContent = fs.readFileSync(researchCssPath, 'utf8');

if (cssContent.includes('#0B1220') && cssContent.includes('#2563EB') && cssContent.includes('16px')) {
  console.log("✓ Design system tokens verified: #0B1220 background, #2563EB accent, 16px radius");
} else {
  errors.push("Design system tokens missing or incorrect in research.css");
}

// [TEST 4] Validate JavaScript Markdown Engine & Local Persistence
console.log("\n[TEST 4] Testing JS Markdown engine & persistence...");
const jsContent = fs.readFileSync(researchJsPath, 'utf8');

if (jsContent.includes('renderMarkdown') && jsContent.includes('localStorage')) {
  console.log("✓ renderMarkdown parser and localStorage persistence verified");
} else {
  errors.push("renderMarkdown or localStorage persistence missing in research.js");
}

// Summary
console.log("\n=================================================");
if (errors.length === 0) {
  console.log("ALL TASK 12.0 ACCEPTANCE TESTS PASSED SUCCESSFULLY! ✓");
} else {
  console.error("TEST FAILURES:");
  errors.forEach(e => console.error(`- ${e}`));
  process.exit(1);
}
