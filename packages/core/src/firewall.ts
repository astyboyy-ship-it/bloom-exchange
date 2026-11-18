import type { FirewallVerdict, Severity, Threat, ThreatVector } from "./types";

/**
 * Shield's context-poisoning and prompt-injection firewall for everything an external agent sends: message text,
 * item descriptions and its Agent Card. Unlike the desk's screening (which only records), this one rewrites: every
 * matched span is replaced with a neutral marker before any engine sees it, hidden channels (invisible Unicode,
 * Unicode tag smuggling, HTML comments, base64 blobs) are decoded, scanned and removed, and a payload with a
 * critical finding is quarantined outright, so only its structured numbers reach the negotiation.
 */

type Rule = { vector: ThreatVector; severity: Severity; rule: string; re: RegExp };

const RULES: Rule[] = [
  { vector: "instruction_override", severity: "high", rule: "Instruction override", re: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(all|any|previous|prior|above|earlier|your|the|system)\b[^.\n]{0,25}\b(instructions?|rules|prompts?|guidelines|polic(?:y|ies)|guardrails?|mandates?|limits?|constraints?)\b/gi },
  { vector: "instruction_override", severity: "high", rule: "Policy bypass", re: /\b(bypass|disable|turn off|skip|override)\b[^.\n]{0,20}\b(clamp(?:ing)?|firewall|shield|sovereign|policy|safety|verification|mandate)\b/gi },
  { vector: "instruction_override", severity: "high", rule: "Forced settlement", re: /\b(settle|accept|approve|sign|agree)\b[^.\n]{0,40}\b(immediately|right now|without (?:review|negotiation|checks?)|no matter what|unconditionally)\b/gi },
  { vector: "role_hijack", severity: "medium", rule: "Persona reassignment", re: /\b(you are now|from now on,? you (?:are|will)|pretend (?:to be|you are)|new instructions\s*:|act as (?:the|a|an) (?:system|developer|admin|administrator|seller'?s? agent|operator))/gi },
  { vector: "role_hijack", severity: "high", rule: "Role line injection", re: /(^|\n)\s*(system|assistant|developer|tool)\s*[:>]\s*/gi },
  { vector: "system_prompt_extraction", severity: "high", rule: "System prompt extraction", re: /\b(reveal|show|print|repeat|output|leak|dump|share)\b[^.\n]{0,25}\b(system prompt|your (?:instructions|prompt|rules)|hidden (?:instructions|prompt)|initial prompt)\b/gi },
  {
    vector: "mandate_extraction",
    severity: "high",
    rule: "Mandate extraction",
    re: /\b(reveal|tell|share|disclose|what(?:'s| is| are)|give me|print|state|confirm)\b[^.\n]{0,40}\b(floor(?: price)?|minimum (?:price|margin)|min(?:imum)? margin|reserve price|walk[- ]?away|bottom line|lowest (?:price|you can go)|cost basis|ceiling|max(?:imum)? budget|private (?:limits?|mandate)|mandate)\b/gi,
  },
  { vector: "jailbreak", severity: "high", rule: "Jailbreak pattern", re: /\b(jailbreak|DAN mode|developer mode|do anything now|no restrictions|unfiltered mode|god mode|act as an? (?:unrestricted|unfiltered|uncensored))\b/gi },
  { vector: "exfiltration", severity: "critical", rule: "Data exfiltration", re: /\b(send|post|upload|forward|exfiltrate|email|webhook)\b[^.\n]{0,40}\b(api keys?|credentials|secrets?|passwords?|tokens?|mandates?|database|private (?:data|limits?))\b[^.\n]{0,30}\b(to|at)\b/gi },
  { vector: "credential_material", severity: "critical", rule: "Credential material", re: /\b(sk-ant-[\w-]{8,}|sk-or-[\w-]{8,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|BLOOMK?-(?!XCH-)[A-Za-z0-9_-]{20,})/g },
  { vector: "role_token_smuggling", severity: "high", rule: "Role-token smuggling", re: /(<\|im_start\|>|<\|im_end\|>|<\|(?:system|assistant|user)\|>|<\/?system>|\[\/?INST\]|<<\/?SYS>>|###\s*(?:system|instruction)|BEGIN SYSTEM PROMPT)/gi },
  { vector: "tool_call_smuggling", severity: "high", rule: "Tool-call smuggling", re: /("?(?:function_call|tool_calls?|tool_use)"?\s*[:=]|<\/?tool_use>|\b(?:submit_result|accept_offer|settle_now|mint_certificate|executive_override)\s*\()/gi },
];

const RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const marker = (v: ThreatVector) => `[neutralized:${v}]`;

// Zero-width, bidi controls and other invisible formatting characters.
const INVISIBLE = /[­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
// Unicode tag characters (U+E0000-E007F) can smuggle a whole ASCII instruction invisibly.
const TAGS = /[\u{E0000}-\u{E007F}]+/gu;
const HIDDEN_MARKUP = /<!--([\s\S]*?)-->|<(script|style|iframe|object)\b[^>]*>([\s\S]*?)<\/\2\s*>|<(?:img|meta|link)\b[^>]*>/gi;
const BASE64 = /\b[A-Za-z0-9+/]{40,}={0,2}/g;
const DATA_URI = /\bdata:[\w/+.-]+;base64,[A-Za-z0-9+/=]+/gi;

export type FirewallResult = { clean: string; threats: Threat[]; verdict: FirewallVerdict };

function decodeBase64(s: string): string | null {
  try {
    const text = Buffer.from(s, "base64").toString("utf8");
    // Only treat it as a payload if it decodes to mostly printable text.
    const printable = text.replace(/[^\x20-\x7E\n\r\t]/g, "").length;
    return text.length >= 20 && printable / text.length > 0.9 ? text : null;
  } catch {
    return null;
  }
}

function excerpt(s: string) {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}…` : flat;
}

/** Runs the rule set over `text`, rewriting each match. Masks credentials so a finding never repeats a secret. */
function applyRules(text: string, field: string, threats: Threat[], extraVector?: ThreatVector): string {
  let out = text;
  for (const r of RULES) {
    out = out.replace(r.re, (m) => {
      threats.push({ vector: extraVector ?? r.vector, severity: r.severity, rule: extraVector ? `${r.rule} (in agent card)` : r.rule, field, excerpt: r.vector === "credential_material" ? `${m.slice(0, 7)}…` : excerpt(m) });
      return marker(r.vector);
    });
  }
  return out;
}

// Cyrillic and Greek letters that render identically to Latin ones. Mixed into a Latin word ("іgnоre"), they slip
// an instruction past ASCII rules; folded back, the rules see it.
const CONFUSABLES: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ј: "j", ѕ: "s", ԁ: "d", һ: "h", ӏ: "l", ο: "o", ν: "v", α: "a", ε: "e", ι: "i", κ: "k", ρ: "p", τ: "t", υ: "u",
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", І: "I", Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
};
const CONFUSABLE_CLASS = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "g");
const MIXED_SCRIPT_WORD = /[A-Za-z][Ͱ-ϿЀ-ӿ]|[Ͱ-ϿЀ-ӿ][A-Za-z]/;
const MAX_FIELD = 8000;
// The same 2-60 character unit repeated eight or more times in a row: a token-exhaustion / context-flooding loop.
const REPETITION = /(\S[\s\S]{1,59}?)(?:\s*\1){7,}/g;
const OVERRIDE_VECTORS = new Set<ThreatVector>(["instruction_override", "role_hijack", "jailbreak", "role_token_smuggling", "system_prompt_extraction"]);

/**
 * Scans one field. Threats found inside decoded channels count against the field they were hidden in. Beyond the
 * rule set it neutralizes swarm-style multi-vector payloads: homoglyph spoofing, token-exhaustion floods (oversized
 * fields, repetition loops) and policy-override loops, which escalate to critical so the payload is quarantined.
 */
export function scanText(input: string, field: string, opts: { cardField?: boolean } = {}): { clean: string; threats: Threat[] } {
  const r = scanLayers(input, field, opts);
  const overrides = r.threats.filter((t) => OVERRIDE_VECTORS.has(t.vector)).length;
  if (overrides >= 3) r.threats.push({ vector: "policy_override_loop", severity: "critical", rule: `Policy-override loop (${overrides} attempts)`, field, excerpt: "" });
  return r;
}

function scanLayers(input: string, field: string, opts: { cardField?: boolean }): { clean: string; threats: Threat[] } {
  const threats: Threat[] = [];
  const extra = opts.cardField ? ("card_skill_poisoning" as const) : undefined;
  let text = input.normalize("NFKC");
  if (text.length > MAX_FIELD) {
    threats.push({ vector: "token_exhaustion", severity: "high", rule: `Oversized payload (${text.length.toLocaleString("en-US")} chars, ${MAX_FIELD.toLocaleString("en-US")} max)`, field, excerpt: "" });
    text = text.slice(0, MAX_FIELD);
  }
  text = text.replace(REPETITION, (m, unit: string) => {
    threats.push({ vector: "token_exhaustion", severity: "high", rule: `Repetition flood (${Math.round(m.length / Math.max(1, unit.length))}× "${unit.trim().slice(0, 24)}")`, field, excerpt: excerpt(unit) });
    return marker("token_exhaustion");
  });
  if (MIXED_SCRIPT_WORD.test(text)) {
    const before = text;
    text = text.replace(CONFUSABLE_CLASS, (ch) => CONFUSABLES[ch] ?? ch);
    if (text !== before) threats.push({ vector: "homoglyph_spoofing", severity: "medium", rule: "Mixed-script homoglyphs folded to Latin", field, excerpt: excerpt(before.match(/\S*[Ͱ-ϿЀ-ӿ]\S*/)?.[0] ?? "") });
  }

  text = text.replace(TAGS, (m) => {
    const decoded = Array.from(m, (ch) => String.fromCharCode((ch.codePointAt(0) ?? 0xe0000) - 0xe0000)).join("");
    threats.push({ vector: "invisible_unicode", severity: "high", rule: "Unicode tag smuggling", field, excerpt: excerpt(decoded) });
    applyRules(decoded, `${field}<tags>`, threats, extra);
    return "";
  });
  const invisible = text.match(INVISIBLE);
  if (!invisible) return { clean: scanVisible(text, field, threats, extra), threats };
  threats.push({ vector: "invisible_unicode", severity: "medium", rule: `Invisible characters (${invisible.length})`, field, excerpt: "" });
  // Invisible characters can split a word ("dis​regard") or stand in for a space ("Please​disregard"). Scan both
  // readings and keep whichever exposes more, so neither trick slips an instruction past the rules.
  const joined: Threat[] = [];
  const spaced: Threat[] = [];
  const a = scanVisible(text.replace(INVISIBLE, ""), field, joined, extra);
  const b = scanVisible(text.replace(INVISIBLE, " "), field, spaced, extra);
  const pick = spaced.length > joined.length ? { clean: b, found: spaced } : { clean: a, found: joined };
  threats.push(...pick.found);
  return { clean: pick.clean, threats };
}

function scanVisible(input: string, field: string, threats: Threat[], extra: ThreatVector | undefined): string {
  let text = input;
  text = text.replace(HIDDEN_MARKUP, (m, comment?: string, _tag?: string, body?: string) => {
    const inner = comment ?? body ?? "";
    threats.push({ vector: "hidden_markup", severity: "medium", rule: comment !== undefined ? "Hidden HTML comment" : "Embedded markup", field, excerpt: excerpt(inner || m) });
    applyRules(inner, `${field}<markup>`, threats, extra);
    return marker("hidden_markup");
  });

  text = text.replace(DATA_URI, () => {
    threats.push({ vector: "encoded_payload", severity: "medium", rule: "Embedded data URI", field, excerpt: "" });
    return marker("encoded_payload");
  });
  text = text.replace(BASE64, (m) => {
    const decoded = decodeBase64(m);
    if (decoded === null) return m;
    const inner: Threat[] = [];
    applyRules(decoded, `${field}<base64>`, inner, extra);
    if (inner.length === 0) return m;
    threats.push({ vector: "encoded_payload", severity: "high", rule: "Base64-encoded instructions", field, excerpt: excerpt(decoded) }, ...inner);
    return marker("encoded_payload");
  });

  text = applyRules(text, field, threats, extra);
  return text.replace(/[ \t]{2,}/g, " ").trim();
}

export function verdictFor(threats: Threat[]): FirewallVerdict {
  if (threats.length === 0) return "clean";
  const critical = threats.some((t) => t.severity === "critical");
  const high = threats.filter((t) => RANK[t.severity] >= RANK.high).length;
  return critical || high >= 3 ? "quarantined" : "neutralized";
}

export const QUARANTINED = "[quarantined by Shield: message withheld, structured terms only]";

/** Scans every external text field. A quarantined payload's text never reaches an engine. */
export function screenPayload(fields: Record<string, string | undefined>): FirewallResult & { fields: Record<string, string> } {
  const threats: Threat[] = [];
  const cleaned: Record<string, string> = {};
  for (const [field, value] of Object.entries(fields)) {
    if (!value) continue;
    const r = scanText(value, field);
    threats.push(...r.threats);
    cleaned[field] = r.clean;
  }
  const verdict = verdictFor(threats);
  if (verdict === "quarantined") for (const k of Object.keys(cleaned)) cleaned[k] = k === "item" ? cleaned[k].replace(/\[neutralized:[a-z_]+\]/g, "").trim() || "Unspecified item" : QUARANTINED;
  return { clean: cleaned.message ?? "", threats: sortThreats(threats), verdict, fields: cleaned };
}

/** An external agent's card: name, description and every skill field are untrusted text. */
export type PeerCard = { name?: unknown; description?: unknown; skills?: unknown };

export function scanAgentCard(card: PeerCard): { name: string; threats: Threat[] } {
  const threats: Threat[] = [];
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const name = scanText(str(card.name).slice(0, 120), "card.name", { cardField: true });
  threats.push(...name.threats);
  threats.push(...scanText(str(card.description), "card.description", { cardField: true }).threats);
  const skills = Array.isArray(card.skills) ? card.skills.slice(0, 32) : [];
  skills.forEach((s, i) => {
    if (!s || typeof s !== "object") return;
    const sk = s as Record<string, unknown>;
    for (const f of ["name", "description"] as const) threats.push(...scanText(str(sk[f]), `card.skills[${i}].${f}`, { cardField: true }).threats);
    const examples = Array.isArray(sk.examples) ? sk.examples.slice(0, 16) : [];
    examples.forEach((e, j) => threats.push(...scanText(str(e), `card.skills[${i}].examples[${j}]`, { cardField: true }).threats));
  });
  const clean = name.clean.replace(/\[neutralized:[a-z_]+\]/g, "").trim();
  return { name: clean || "external-agent", threats: sortThreats(threats) };
}

const sortThreats = (t: Threat[]) => [...t].sort((a, b) => RANK[b.severity] - RANK[a.severity]);
