// ULIDs (sortable, no index needed): 48-bit ms time + 80 random bits,
// Crockford base32. Items get a type prefix: ex_, sa_, nt_ (PLAN.md §7.2).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(now = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rand = crypto.getRandomValues(new Uint8Array(16));
  let r = '';
  for (let i = 0; i < 16; i++) r += ALPHABET[rand[i]! % 32];
  return time + r;
}

export type ItemPrefix = 'ex' | 'sa' | 'nt';
export const itemId = (prefix: ItemPrefix, now?: number) => `${prefix}_${ulid(now)}`;
export const isItemId = (prefix: ItemPrefix, id: string) => new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`).test(id);
