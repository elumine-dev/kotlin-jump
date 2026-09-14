#!/usr/bin/env node
// Length and count limits of media/whats-new.json, in ONE place.
//
// validate-whats-new.mjs enforces them; .publish builds from them the JSON
// schema it hands to `claude -p` and the prompt rule that states them. The
// schema used to carry no maxLength: a 640 character bullet was drafted, the
// validator rejected it after the changelog and package files were rewritten,
// and the release had to be unwound by hand.
//
//   node .github/scripts/whats-new-limits.mjs --schema   prints the notes schema
//   node .github/scripts/whats-new-limits.mjs --rules    prints the prompt rule

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Cross-checked with WhatsNewPanel.buildHtml (cards slice to 3).
export const LIMITS = Object.freeze({
  highlights: 3,
  sectionBullets: 5,
  sections: 4,
  title: 120,
  tagline: 200,
  summary: 800,
  description: 1200,
  bullet: 600,
});

export function notesSchema() {
  const text = max => ({ type: 'string', maxLength: max });
  return {
    type: 'object',
    properties: {
      summary: text(LIMITS.summary),
      tagline: text(LIMITS.tagline),
      highlights: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: text(LIMITS.title),
            description: text(LIMITS.description),
            kind: { type: 'string', enum: ['feature', 'improvement', 'fix', 'note'] },
            media: { type: 'string' },
            mediaAlt: { type: 'string' },
          },
          required: ['title', 'kind'],
          additionalProperties: false,
        },
        minItems: 1,
        maxItems: LIMITS.highlights,
      },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            heading: { type: 'string' },
            bullets: { type: 'array', items: text(LIMITS.bullet), minItems: 1, maxItems: LIMITS.sectionBullets },
          },
          required: ['heading', 'bullets'],
          additionalProperties: false,
        },
        minItems: 1,
        maxItems: LIMITS.sections,
      },
    },
    required: ['summary', 'tagline', 'highlights', 'sections'],
    additionalProperties: false,
  };
}

export function promptRule() {
  return `- LENGTH, STRICT: the release is rejected when a field is too long. At most ${LIMITS.summary} characters for summary, `
    + `${LIMITS.tagline} for tagline, ${LIMITS.title} for a highlight title, ${LIMITS.description} for a highlight description, `
    + `${LIMITS.bullet} for a bullet. Split a long bullet in two rather than cutting its example.`;
}

// Same real path comparison as release-context.mjs: /tmp sits behind a link on macOS.
const invoked = (() => {
  try { return process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; }
  catch { return false; }
})();
if (invoked) {
  if (process.argv.includes('--schema')) process.stdout.write(JSON.stringify(notesSchema()));
  else if (process.argv.includes('--rules')) process.stdout.write(promptRule());
  else { process.stderr.write('usage: whats-new-limits.mjs --schema | --rules\n'); process.exit(2); }
}
