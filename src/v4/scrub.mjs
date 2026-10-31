// De-identification for the deployment knowledge library. Replaces personal data and secrets with
// typed placeholders such as [EMAIL] so library entries never carry a customer's people, keys or hosts.
// Deterministic and offline: regex candidates, then checksum or shape validation (Luhn for cards,
// mod-97 for IBANs, net.isIPv6) so prices, dates and version numbers survive.
//
// Detectors run in a fixed order; text already turned into a placeholder is never scanned again.

import net from 'node:net';

const PLACEHOLDER = /(\[[A-Z][A-Z0-9_]*\])/;
const KIND_NAME = /^[A-Z][A-Z0-9_]{0,30}$/;

// Applies fn to every regex match outside existing placeholders. fn returns the replacement
// (or the original match to keep it) and reports the kind it found through count().
function replaceOutside(text, re, fn) {
  return text.split(PLACEHOLDER).map((part, i) => (i % 2 ? part : part.replace(re, fn))).join('');
}

const digitsOf = s => s.replace(/\D/g, '');

export function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return digits.length > 0 && sum % 10 === 0;
}

export function ibanValid(raw) {
  const s = raw.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const BEARER_RE = /\b(Bearer|Basic|Token)\s+(?!\$\{)([A-Za-z0-9\-._~+/]{8,}=*)/g;
const PREFIXED_KEY_RE = /\b(?:(?:sk|rk|pk|dk)[-_][A-Za-z0-9_-]{12,}|(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,})/g;
const HEX_RE = /\b[a-fA-F0-9]{32,}\b/g;
const B64_RE = /(?<![A-Za-z0-9+_-])[A-Za-z0-9+_-]{32,}={0,2}(?![A-Za-z0-9+_-])/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{1,4}){3,8}\b/g;
const CARD_RE = /(?<![\w.-])\d(?:[ -]?\d){12,18}(?![\w-]|\.\d)/g;
const SSN_RE = /(?<![\w-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\w-])/g;
const IPV6_RE = /(?<![\w:.])(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(?![\w:])/g;
const IPV4_RE = /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\w]|\.\d)/g;
const PHONE_RE = /(?<![\w+])(?:\+|\()?\d[\d ().-]{5,}\d(?![\w]|\.\d)/g;
const VERSION_CONTEXT = /\b(?:v|ver|version|build|release|firmware)\.?\s*$/i;

// A 32+ character run counts as a secret only if it mixes upper case, lower case and digits,
// so long words, slugs and file names are left alone.
const looksRandom = s => /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s);

// The value after Bearer/Basic/Token is a credential only when it is not a plain word ("Basic information",
// "Token authentication"): real tokens carry digits, base64/JWT punctuation or inner capitals.
const looksLikeToken = v => /[\d+/=_.~]/.test(v) || /[A-Z]/.test(v.slice(1));

function phoneLike(m) {
  const digits = digitsOf(m);
  if (m.startsWith('+')) return digits.length >= 8 && digits.length <= 15;
  if (digits.length < 9 || digits.length > 15) return false;
  if (!/[ ().-]/.test(m)) return false; // a bare digit run is an id or timestamp, not a phone
  // A date, alone or followed by the hour of a time ("2026-10-31 12:00"), is not a phone number.
  if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}(?: \d{1,2})?$/.test(m) || /^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/.test(m)) return false;
  // Dotted numbers are usually versions or decimals; only the 3.3.4 phone style ("415.555.2671") counts.
  if (/^[\d.]+$/.test(m)) return /^\d{2,4}\.\d{3,4}\.\d{4}$/.test(m);
  return true;
}

// patterns: { KIND: "regex source" } from delomu.json "library.patterns". Returns compiled [kind, RegExp].
export function compilePatterns(patterns = {}) {
  if (patterns === null || typeof patterns !== 'object' || Array.isArray(patterns)) {
    throw new Error('library.patterns must be an object like { "ORDER": "ORD-\\\\d+" }');
  }
  return Object.entries(patterns).map(([name, source]) => {
    const kind = String(name).toUpperCase();
    if (!KIND_NAME.test(kind)) throw new Error(`library.patterns: "${name}" is not a valid name (letters, digits, _; starts with a letter)`);
    if (typeof source !== 'string' || !source) throw new Error(`library.patterns.${name} must be a non-empty regex string`);
    let re;
    try { re = new RegExp(source, 'gi'); } catch (e) { throw new Error(`library.patterns.${name} is not a valid regex: ${e.message}`); }
    if (new RegExp(source, 'i').test('')) throw new Error(`library.patterns.${name} matches empty text`);
    return [kind, re];
  });
}

function compileNames(names = []) {
  if (!Array.isArray(names)) throw new Error('names must be an array of strings');
  const clean = [...new Set(names.map(n => String(n ?? '').trim()).filter(n => n.length >= 2))]
    .sort((a, b) => b.length - a.length);
  if (!clean.length) return null;
  const alt = clean.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, 'giu');
}

// scrub(text, { names, patterns }) -> { text, found: { kind: count } }.
// names: people, companies or product names to remove; patterns: see compilePatterns
// (pre-compiled [kind, RegExp] pairs are also accepted so callers can validate once).
export function scrub(text, { names = [], patterns = {} } = {}) {
  if (text === undefined || text === null) return { text: '', found: {} };
  let out = String(text);
  const found = {};
  const hit = kind => { found[kind] = (found[kind] ?? 0) + 1; };
  const swap = (kind, placeholder = `[${kind.toUpperCase()}]`) => () => { hit(kind); return placeholder; };
  const custom = Array.isArray(patterns) ? patterns : compilePatterns(patterns);

  out = replaceOutside(out, URL_RE, url => {
    const trail = url.match(/[.,;:!?)\]]+$/)?.[0] ?? '';
    let u = url.slice(0, url.length - trail.length);
    u = u.replace(/^(https?:\/\/)[^/?#\s]*@/i, (_, scheme) => { hit('url_credentials'); return `${scheme}[CREDENTIALS]@`; });
    u = u.replace(/[?#].*$/, rest => { hit('url_query'); return rest[0] === '?' ? '?[QUERY]' : '#[QUERY]'; });
    return u + trail;
  });
  out = replaceOutside(out, EMAIL_RE, swap('email'));
  out = replaceOutside(out, BEARER_RE, (m, scheme, value) => {
    if (!looksLikeToken(value)) return m;
    hit('secret');
    return `${scheme} [SECRET]`;
  });
  out = replaceOutside(out, PREFIXED_KEY_RE, swap('secret'));
  out = replaceOutside(out, HEX_RE, swap('secret'));
  out = replaceOutside(out, B64_RE, m => (looksRandom(m) ? swap('secret')() : m));
  for (const [kind, re] of custom) out = replaceOutside(out, re, swap(kind.toLowerCase(), `[${kind}]`));

  out = replaceOutside(out, IBAN_RE, m => {
    // The pattern can run into the next word, so try shorter prefixes before giving up.
    const groups = m.split(' ');
    for (let n = groups.length; n >= 1; n--) {
      if (ibanValid(groups.slice(0, n).join(''))) {
        hit('iban');
        const rest = groups.slice(n).join(' ');
        return rest ? `[IBAN] ${rest}` : '[IBAN]';
      }
    }
    return m;
  });
  out = replaceOutside(out, CARD_RE, m => {
    const d = digitsOf(m);
    return d.length >= 13 && d.length <= 19 && luhn(d) ? swap('card')() : m;
  });
  out = replaceOutside(out, SSN_RE, swap('ssn'));
  out = replaceOutside(out, IPV6_RE, m => (m.includes('::') || m.split(':').length === 8) && net.isIPv6(m) ? swap('ip')() : m);
  out = replaceOutside(out, IPV4_RE, (m, offset, whole) => (VERSION_CONTEXT.test(whole.slice(Math.max(0, offset - 12), offset)) ? m : swap('ip')()));
  out = replaceOutside(out, PHONE_RE, m => {
    // The candidate may swallow a trailing space or a lone "(" that belongs to the sentence.
    const core = m.replace(/[ (.-]+$/, '');
    return phoneLike(core) ? swap('phone')() + m.slice(core.length) : m;
  });

  const namesRe = compileNames(names);
  if (namesRe) out = replaceOutside(out, namesRe, swap('name'));
  return { text: out, found };
}

// Merges found-counts from several scrub calls.
export function addFound(total, found) {
  for (const [k, v] of Object.entries(found)) total[k] = (total[k] ?? 0) + v;
  return total;
}
