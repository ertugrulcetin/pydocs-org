// Baked community content (PLAN.md Phase 5): the snapshot taken by
// scripts/snapshot.mjs before the build. Missing snapshot = no content.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ActivityEvent, Example, SymbolDoc } from '../../worker/community.ts';
import { symbolById } from './data';

interface Snapshot {
  takenAt: number;
  symbols: Record<string, SymbolDoc>;
  activity: ActivityEvent[];
}

const file = resolve(process.cwd(), '.bake/snapshot.json');
const raw: Snapshot = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { takenAt: 0, symbols: {}, activity: [] };

/** Only symbols that still have a page (PLAN.md Q11: data stays in R2, page goes). */
export const bakedDocs: Record<string, SymbolDoc> = Object.fromEntries(
  Object.entries(raw.symbols).filter(([sid]) => symbolById.has(sid)),
);
export const bakedAt = raw.takenAt;
export const recentActivity: ActivityEvent[] = raw.activity.filter((e) => symbolById.has(e.symbol)).slice(0, 3);

export const docFor = (sid: string): SymbolDoc | null => bakedDocs[sid] ?? null;
export const exampleCount = (sid: string): number => bakedDocs[sid]?.examples.length ?? 0;

const allExamples: { sid: string; ex: Example }[] = Object.values(bakedDocs)
  .flatMap((d) => d.examples.map((ex) => ({ sid: d.symbol, ex })))
  .sort((a, b) => (a.ex.id < b.ex.id ? -1 : 1));

/** Same example all day, a different one each day (the nightly build picks it). */
export function exampleOfTheDay(now = Date.now()): { sid: string; ex: Example } | null {
  if (!allExamples.length) return null;
  const day = Math.floor(now / 86_400_000);
  return allExamples[(day * 2654435761) % allExamples.length]!;
}
