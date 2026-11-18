import { describe, expect, it } from "vitest";
import { DICTS as EXCHANGE } from "@/components/exchange/copy";
import { DESK_DICTS as DESK } from "@/components/exchange/desk-copy";
import { DICTS as OMNI } from "@/components/exchange/omni-copy";

/**
 * Bloom Exchange ships in exactly two languages. Every English string must exist in Spanish with the same shape
 * (keys, array lengths), no string may be empty, and nothing from a dropped language may linger.
 */

type Tree = string | number | boolean | null | undefined | Tree[] | { [k: string]: Tree };

function shape(v: Tree, path = "$", out: string[] = []): string[] {
  if (Array.isArray(v)) {
    out.push(`${path}[${v.length}]`);
    v.forEach((x, i) => shape(x, `${path}[${i}]`, out));
  } else if (v && typeof v === "object") for (const k of Object.keys(v).sort()) shape(v[k], `${path}.${k}`, out);
  else out.push(`${path}:${typeof v}`);
  return out;
}

function strings(v: Tree, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

const SETS = { copy: EXCHANGE, omni: OMNI, desk: DESK } as unknown as Record<string, Record<string, Tree>>;

describe.each(Object.entries(SETS))("%s dictionaries", (_name, dicts) => {
  it("ships English and Spanish only", () => {
    expect(Object.keys(dicts).sort()).toEqual(["en", "es"]);
  });

  it("has the same shape in Spanish as in English", () => {
    expect(shape(dicts.es)).toEqual(shape(dicts.en));
  });

  it("has no empty strings", () => {
    for (const lang of ["en", "es"]) expect(strings(dicts[lang]).filter((s) => !s.trim())).toEqual([]);
  });

  it("is actually translated (most Spanish strings differ from English)", () => {
    const en = strings(dicts.en);
    const es = strings(dicts.es);
    const same = en.filter((s, i) => s === es[i]).length;
    expect(same / en.length).toBeLessThan(0.35);
  });

  it("carries no Hebrew text", () => {
    for (const lang of ["en", "es"]) expect(strings(dicts[lang]).some((s) => /[֐-׿]/.test(s))).toBe(false);
  });
});
