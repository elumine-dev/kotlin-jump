#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const outputPath = process.argv[2] ?? 'release-body.md';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = process.env.GITHUB_REF_NAME?.replace(/^v/, '') ?? pkg.version;
const tag = `v${version}`;
const repositoryUrl = normalizeRepositoryUrl(pkg.repository?.url);
const marketplaceUrl = `https://marketplace.visualstudio.com/items?itemName=${pkg.publisher}.${pkg.name}`;
const issuesUrl = pkg.bugs?.url ?? `${repositoryUrl}/issues`;
const changelogUrl = `${repositoryUrl}/blob/main/CHANGELOG.md`;
const releasesUrl = `${repositoryUrl}/releases`;
const vsixName = `${pkg.name}-${version}.vsix`;
const changelogBody = extractChangelogBody(readFileSync('CHANGELOG.md', 'utf8'), version);
const previousTag = findPreviousSemverTag(tag);

const sections = [
  '## Install',
  '',
  `Marketplace: ${marketplaceUrl}`,
  '',
  `VSIX: Download \`${vsixName}\` from the Assets section, then install it with:`,
  '',
  '```bash',
  `code --install-extension ${vsixName}`,
  '```',
  '',
  '## Changes',
  '',
  changelogBody,
  '',
  '## Links',
  '',
  `- Marketplace: ${marketplaceUrl}`,
  `- Releases: ${releasesUrl}`,
  `- Changelog: ${changelogUrl}`,
  `- Issues: ${issuesUrl}`,
];

if (previousTag) {
  sections.push(`- Full Changelog: ${repositoryUrl}/compare/${previousTag}...${tag}`);
}

writeFileSync(outputPath, `${sections.join('\n').trim()}\n`);

function normalizeRepositoryUrl(url) {
  if (!url) {
    const repo = process.env.GITHUB_REPOSITORY;
    if (!repo) {
      throw new Error('Missing repository URL and GITHUB_REPOSITORY context.');
    }
    return `https://github.com/${repo}`;
  }

  return url
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^git@github\.com:/, 'https://github.com/');
}

function extractChangelogBody(changelog, targetVersion) {
  const normalized = changelog.replace(/\r\n/g, '\n');
  const headerPattern = new RegExp(`^## ${escapeRegex(targetVersion)}\\s*$`, 'm');
  const headerMatch = headerPattern.exec(normalized);

  if (!headerMatch) {
    throw new Error(`Could not find CHANGELOG section for ${targetVersion}.`);
  }

  const bodyStart = headerMatch.index + headerMatch[0].length;
  const afterHeader = normalized.slice(bodyStart).replace(/^\n+/, '');
  const nextHeaderMatch = /^##\s+/m.exec(afterHeader);
  const body = (nextHeaderMatch ? afterHeader.slice(0, nextHeaderMatch.index) : afterHeader).trim();

  if (!body) {
    throw new Error(`CHANGELOG section for ${targetVersion} is empty.`);
  }

  return body;
}

function findPreviousSemverTag(currentTag) {
  const rawTags = execFileSync('git', ['tag', '--sort=version:refname'], { encoding: 'utf8' });
  const tags = rawTags
    .split('\n')
    .map(tag => tag.trim())
    .filter(tag => /^v\d+\.\d+\.\d+$/.test(tag));
  const currentIndex = tags.indexOf(currentTag);

  if (currentIndex <= 0) {
    return null;
  }

  return tags[currentIndex - 1];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
