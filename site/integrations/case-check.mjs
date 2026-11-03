// Python names are case-sensitive, and 29 symbol ids differ only in case
// (logging/DEBUG vs logging/debug). On a case-insensitive disk (macOS default)
// one page silently overwrites the other. This integration warns after such a
// build; scripts/assert-case-sensitive.mjs blocks deploying from one.
import { isCaseInsensitive } from '../scripts/case-sensitivity.mjs';

/** @returns {import('astro').AstroIntegration} */
export default function caseCheck() {
  return {
    name: 'pydocs:case-check',
    hooks: {
      'astro:build:done': async ({ dir, pages, logger }) => {
        const seen = new Map();
        const collisions = [];
        for (const { pathname } of pages) {
          const key = pathname.toLowerCase();
          if (seen.has(key)) collisions.push(`${seen.get(key)} <-> ${pathname}`);
          else seen.set(key, pathname);
        }
        if (collisions.length === 0) return;
        if (await isCaseInsensitive(dir)) {
          logger.warn(
            `${collisions.length} page(s) differ only in case and overwrote each other on this ` +
              `case-insensitive disk (e.g. ${collisions[0]}). Fine for a local look; deploy only from a ` +
              `case-sensitive build (Linux / CI).`,
          );
        } else {
          logger.info(`${collisions.length} case-only page pairs written correctly (case-sensitive disk).`);
        }
      },
    },
  };
}
