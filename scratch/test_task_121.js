/**
 * Task 12.1 — Acceptance Verification Script
 * Production Privacy Fix: Remove Hardcoded Personal Data
 */

const fs = require('fs');
const path = require('path');

console.log("=========================================");
console.log("RUNNING TASK 12.1 ACCEPTANCE TEST SUITE");
console.log("=========================================\n");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

const websiteDir = path.join(__dirname, '..', 'website');

function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAllFiles(filePath, fileList);
    } else {
      fileList.push(filePath);
    }
  });
  return fileList;
}

const allWebsiteFiles = getAllFiles(websiteDir);

// 1. Audit for Hardcoded Demo Personal Names
console.log("1. Auditing Website Files for Demo Personal Names...");
const forbiddenNames = [
  "Reshma", "Hegde", "Bipin", "Ananda", "Rahul", "Siddharth", "Kavya", "Nair", "Verma", "Sharma", "Murthy"
];

let totalForbiddenMatches = 0;
allWebsiteFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  forbiddenNames.forEach(name => {
    const regex = new RegExp(`\\b${name}\\b`, 'gi');
    const matches = content.match(regex);
    if (matches) {
      console.error(`   Forbidden match '${name}' in ${path.relative(websiteDir, file)}`);
      totalForbiddenMatches += matches.length;
    }
  });
});

assert(totalForbiddenMatches === 0, `Website directory must have 0 forbidden demo personal names (Found: ${totalForbiddenMatches})`);

// 2. Audit Dynamic JS Loaders for Network Storage Key Usage
console.log("\n2. Auditing Dynamic Storage Loaders in JS Files...");

const jsFiles = ['network.js', 'research.js', 'graph.js'];
jsFiles.forEach(jsFileName => {
  const filePath = path.join(websiteDir, 'js', jsFileName);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    const hasActiveGraphKey = content.includes('warmgraph_active_graph');
    const hasEmptyState = content.includes('No Network Imported');
    const hasOpenExtBtn = content.includes('Open Extension');

    assert(hasActiveGraphKey, `js/${jsFileName} loads from 'warmgraph_active_graph'`);
    assert(hasEmptyState, `js/${jsFileName} defines clean 'No Network Imported' empty state`);
    assert(hasOpenExtBtn, `js/${jsFileName} contains 'Open Extension' call to action`);
  } else {
    assert(false, `js/${jsFileName} exists`);
  }
});

console.log("\n-----------------------------------------");
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log("-----------------------------------------");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("SUCCESS: Task 12.1 Acceptance Criteria Met!\n");
  process.exit(0);
}
