#!/usr/bin/env node

/**
 * Extracts release notes for a specific version from CHANGELOG.md.
 *
 * Usage:
 *   node scripts/extract-release-notes.js 1.0.0
 *   node scripts/extract-release-notes.js v1.0.0
 *
 * Output:
 *   The markdown content between the matching version header and the next
 *   version header (or end of file). Exits with code 1 if not found.
 */

const fs = require('fs');
const path = require('path');

const version = (process.argv[2] || '').replace(/^v/, '');

if (!version) {
  console.error('Usage: extract-release-notes.js <version>');
  console.error('Example: extract-release-notes.js 1.0.0');
  process.exit(1);
}

const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');

if (!fs.existsSync(changelogPath)) {
  console.error('CHANGELOG.md not found');
  process.exit(1);
}

const changelog = fs.readFileSync(changelogPath, 'utf-8');
const lines = changelog.split('\n');

let capturing = false;
let notes = [];

for (const line of lines) {
  const isVersionHeader = /^## \[/.test(line);

  if (isVersionHeader) {
    if (capturing) {
      break;
    }

    if (line.includes(`[${version}]`)) {
      capturing = true;
      continue;
    }
  }

  if (capturing) {
    notes.push(line);
  }
}

const result = notes.join('\n').trim();

if (!result) {
  console.error(`No release notes found for version ${version}`);
  process.exit(1);
}

console.log(result);
