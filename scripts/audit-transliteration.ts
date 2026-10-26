/**
 * Transliteration audit.
 *
 * Lists every word the segmenter routes to the Tamil voice that has **no**
 * dictionary row, showing what the rule engine currently produces. Those are
 * the words most likely to sound wrong, and each one is fixed by adding a
 * single line to `packages/core/data/tanglish-ta.json`.
 *
 *   npm run tts:audit              # summary + the list
 *   npm run tts:audit -- --count   # summary only
 */

import { TANGLISH_DATA, normalizeWord } from '../packages/core/src/lexicon';
import {
  DEFAULT_TRANSLITERATION,
  transliterateWord,
} from '../packages/core/src/transliterate';

const countOnly = process.argv.includes('--count');

const seen = new Set<string>();
const ruleOnly: string[] = [];

for (const word of TANGLISH_DATA.words) {
  const key = normalizeWord(word);
  if (key.length === 0 || seen.has(key)) continue;
  seen.add(key);
  if (!DEFAULT_TRANSLITERATION.has(key)) ruleOnly.push(key);
}

const total = seen.size;
const pinned = total - ruleOnly.length;
const pct = total === 0 ? 0 : Math.round((pinned / total) * 100);

console.log(`lexicon words      : ${total}`);
console.log(`pinned (dictionary): ${pinned} (${pct}%)`);
console.log(`rule engine only   : ${ruleOnly.length}`);
console.log('');

if (countOnly) process.exit(0);

if (ruleOnly.length === 0) {
  console.log('Every routed word is pinned. Nothing to fix.');
  process.exit(0);
}

console.log('rule-only words (add a dictionary row for any that sound wrong):');
console.log('');
for (const key of ruleOnly.sort()) {
  console.log(`  ${key.padEnd(18)} ${transliterateWord(key)}`);
}
