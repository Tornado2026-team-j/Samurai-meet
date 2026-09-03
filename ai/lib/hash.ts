import { createHash } from "node:crypto";
import type { MonsterSeed } from "@/lib/types";

/**
 * Stable hash of a monster seed. Order-insensitive for the tag arrays so that
 * ["a","b"] and ["b","a"] map to the same monster and do not burn a
 * regeneration. `note` is trimmed and lower-cased but otherwise kept verbatim.
 */
export function monsterSeedHash(seed: MonsterSeed): string {
  const norm = {
    skills: [...seed.skills].map((s) => s.trim().toLowerCase()).filter(Boolean).sort(),
    interests: [...seed.interests].map((s) => s.trim().toLowerCase()).filter(Boolean).sort(),
    note: (seed.note ?? "").trim().toLowerCase(),
  };
  return createHash("sha256").update(JSON.stringify(norm)).digest("hex");
}
