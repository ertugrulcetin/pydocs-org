// Data shapes shared by the Worker and the site (PLAN.md §7.2). Types only,
// no Workers or DOM dependencies, so both TypeScript projects can import them.

export interface Author {
  id: number;
  login: string;
}

export interface Example {
  id: string;
  body: string;
  author: Author;
  editors: Author[];
  createdAt: number;
  updatedAt: number;
  /** "python-docs" for seeded doctest examples (Phase 7), else null. */
  source: string | null;
}

export interface SeeAlso {
  id: string;
  to: string;
  author: Author;
  createdAt: number;
}

export interface Note {
  id: string;
  body: string;
  author: Author;
  createdAt: number;
  updatedAt: number;
}

export interface SymbolDoc {
  symbol: string;
  examples: Example[];
  seeAlsos: SeeAlso[];
  notes: Note[];
  updatedAt: number;
}

export interface HistoryDoc {
  exampleId: string;
  symbol: string;
  versions: { body: string; editor: Author; at: number }[];
  deletedAt?: number;
}

export interface ActivityEvent {
  type: 'example' | 'seeAlso' | 'note';
  action: 'create' | 'edit' | 'delete';
  symbol: string;
  id: string;
  user: Author;
  at: number;
}

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
