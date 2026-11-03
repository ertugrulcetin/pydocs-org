// Build-time GitHub stars for the home navbar (PLAN.md §5 #2). Never fails the
// build: on any error the stars link is simply left out.
import { REPO_URL } from './site';

export async function githubStars(): Promise<number | undefined> {
  const repo = new URL(REPO_URL).pathname.slice(1);
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'pydocs-build' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { stargazers_count?: number };
    return data.stargazers_count;
  } catch {
    return undefined;
  }
}
