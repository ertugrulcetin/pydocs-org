// Public user records in pydocs-content (PLAN.md §7.1–7.2):
//   users/{githubId}.json      profile + contributions
//   logins/{login-lower}.json  {id} lookup for /u/{login}
// No emails, tokens, or other private data are stored.
import { getJson, putJson, updateJson } from './r2json.ts';

export interface Contribution {
  type: 'example' | 'seeAlso' | 'note';
  symbol: string;
  id: string;
  at: number;
}

export interface UserDoc {
  id: number;
  login: string;
  joinedAt: number;
  lastSeenAt: number;
  contributions: Contribution[];
}

export const userKey = (id: number) => `users/${id}.json`;
export const loginKey = (login: string) => `logins/${login.toLowerCase()}.json`;

/** Creates or refreshes a user at login; handles GitHub renames. */
export async function upsertUser(bucket: R2Bucket, id: number, login: string, now: number): Promise<UserDoc> {
  const renamed: { from: string | null } = { from: null };
  const doc = await updateJson<UserDoc>(bucket, userKey(id), (cur) => {
    if (!cur) return { id, login, joinedAt: now, lastSeenAt: now, contributions: [] };
    renamed.from = cur.login !== login ? cur.login : null;
    return { ...cur, login, lastSeenAt: now };
  });
  await putJson(bucket, loginKey(login), { id });
  const from = renamed.from;
  if (from && from.toLowerCase() !== login.toLowerCase()) {
    const old = await getJson<{ id: number }>(bucket, loginKey(from));
    if (old?.id === id) await bucket.delete(loginKey(from));
  }
  return doc!;
}
