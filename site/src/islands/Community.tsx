// Examples / See Also / Notes for a symbol page: a port of ClojureDocs'
// examples.cljs, see_alsos.cljs and notes.cljs (same markup, classes and copy).
// Rendered at build time from the baked doc, then hydrated: it loads the live
// doc, and logged-in users can add, edit and delete (PLAN.md §5 #11–17).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { highlightPython } from '../lib/highlight';
import {
  api,
  avatarUrl,
  currentUser,
  emptyDoc,
  loadLiveDoc,
  loginUrl,
  renderMarkdown,
  timeago,
  updateCounts,
} from '../lib/community-client';
import type { Author, CookieUser, Example, Note, SeeAlso, SymbolDoc } from '../lib/community-client';
import { REPO_URL } from '../lib/site';

/** "report" opens a prefilled GitHub issue (PLAN.md §5, Phase 6): no backend needed. */
const reportUrl = (what: string, sid: string, id: string) => {
  const title = `Report: ${what} ${id} on ${sid}`;
  const body = `**Page:** https://pydocs.org/${sid}\n**${what[0]!.toUpperCase()}${what.slice(1)} id:** ${id}\n\n**What's wrong?**\n\n`;
  return `${REPO_URL}/issues/new?labels=report&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
};
const Report = ({ what, sid, id }: { what: string; sid: string; id: string }) => (
  <span>
    {' / '}
    <a href={reportUrl(what, sid, id)} rel="nofollow noopener" target="_blank">
      report
    </a>
  </span>
);

interface Props {
  sid: string;
  /** Baked doc (Phase 5); null until then. */
  initial: SymbolDoc | null;
  /** One-line docs of see-also targets known at build time. */
  seeAlsoDocs?: Record<string, string>;
}

type Save = (method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<void>;

const pluralize = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const prevent = (fn: () => void) => (e: Event) => {
  e.preventDefault();
  fn();
};

function Avatar({ author }: { author: Author }) {
  return (
    <a href={`/u/${author.login}`} title={author.login}>
      <img class="avatar" src={avatarUrl(author.id)} alt={author.login} loading="lazy" />
    </a>
  );
}

function LoginRequired({ what }: { what: string }) {
  // hydrate() keeps server-rendered attributes, so add the return URL after mount.
  const [href, setHref] = useState('/auth/login');
  useEffect(() => setHref(loginUrl()), []);
  return (
    <div class="login-required-message">
      <a href={href}>Log in</a> to add {what}
    </div>
  );
}

function ErrorMessage({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div class="form-group">
      <div class="error-message text-danger">
        <i class="fa fa-exclamation-circle"></i> {error}
      </div>
    </div>
  );
}

/** "Editor | Preview" tabs with an auto-growing textarea (ClojureDocs' $tabbed-clojure-editor). */
function TabbedEditor(props: {
  value: string;
  onInput: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  placeholder: string;
  preview: (text: string) => JSX.Element;
  guide?: boolean;
}) {
  const [tab, setTab] = useState<'editor' | 'preview'>('editor');
  const rows = Math.max(props.value.split('\n').length + 3, 10);
  const onKeyDown = (e: KeyboardEvent) => {
    const ta = e.currentTarget as HTMLTextAreaElement;
    if (e.key === 'Tab' && !e.shiftKey) {
      // Tab inserts 4 spaces (PLAN.md §5 #12).
      e.preventDefault();
      // Edits the DOM value and caret together, so fast typing can't land in the wrong place.
      ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end');
      props.onInput(ta.value);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      props.onSubmit();
    }
  };
  return (
    <div class="tabbed-editor">
      <ul class="nav nav-tabs">
        <li class={tab === 'editor' ? 'active' : undefined}>
          <a href="#" onClick={prevent(() => setTab('editor'))}>
            <i class="fa fa-code"></i> Editor
          </a>
        </li>
        <li class={tab === 'preview' ? 'active' : undefined}>
          <a href="#" onClick={prevent(() => setTab('preview'))}>
            <i class="fa fa-eye"></i> Preview
          </a>
        </li>
      </ul>
      <div class={tab === 'preview' ? 'hidden' : undefined}>
        <div class={`example-editor${props.disabled ? ' disabled' : ''}`}>
          <textarea
            class="form-control"
            cols={80}
            rows={rows}
            value={props.value}
            placeholder={props.placeholder}
            disabled={props.disabled}
            autoFocus
            spellcheck={false}
            onInput={(e) => props.onInput((e.currentTarget as HTMLTextAreaElement).value)}
            onKeyDown={onKeyDown}
          />
          {props.guide && <pre class="columns-guide">{'#' + '-'.repeat(32) + ' 80 columns ' + '-'.repeat(34) + '>'}</pre>}
        </div>
      </div>
      <div class={`live-preview${tab === 'editor' ? ' hidden' : ''}`}>
        {props.value ? props.preview(props.value) : <div class="null-state">Live Preview</div>}
      </div>
    </div>
  );
}

const CodePreview = (text: string) => <pre class="syntaxify" dangerouslySetInnerHTML={{ __html: highlightPython(text) }} />;

const ExampleInstructions = () => (
  <p class="example-instructions">
    See our <a href="/examples-styleguide">examples style guide</a> for content and formatting guidelines. Examples submitted to
    PyDocs are licensed under the <a href="https://creativecommons.org/publicdomain/zero/1.0/">Creative Commons CC0 license</a>.
  </p>
);

/** Shared editor + Cancel/Submit controls (ClojureDocs' $example-editor). */
function EditorForm(props: {
  initial: string;
  submitText: string;
  placeholder: string;
  instructions: JSX.Element;
  preview: (text: string) => JSX.Element;
  guide?: boolean;
  onCancel: () => void;
  onSubmit: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(props.initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await props.onSubmit(text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div>
      <TabbedEditor value={text} onInput={setText} onSubmit={submit} disabled={loading} placeholder={props.placeholder} preview={props.preview} guide={props.guide} />
      {props.instructions}
      <ErrorMessage error={error} />
      <div class="add-example-controls form-group clearfix">
        <button class="btn btn-default" disabled={loading} onClick={prevent(props.onCancel)}>
          Cancel
        </button>
        <button class="btn btn-success pull-right" disabled={loading} onClick={prevent(submit)}>
          {props.submitText}
        </button>
        <img class={`loading pull-right${loading ? '' : ' hidden'}`} src="/img/loading.gif" alt="" />
      </div>
    </div>
  );
}

/** "delete" -> "cancel | confirm delete?" (ClojureDocs' delete-state). */
function DeleteControl({ onConfirm, confirmText }: { onConfirm: () => Promise<void>; confirmText: string }) {
  const [state, setState] = useState<'none' | 'confirm' | 'loading' | 'error'>('none');
  if (state === 'loading') return <img class="loading" src="/img/loading.gif" alt="" />;
  if (state === 'confirm') {
    return (
      <span class="delete-confirmation">
        <a href="#" onClick={prevent(() => setState('none'))}>
          cancel
        </a>
        {' | '}
        <a
          href="#"
          onClick={prevent(() => {
            setState('loading');
            onConfirm().catch(() => setState('error'));
          })}
        >
          {confirmText}
        </a>
      </span>
    );
  }
  return (
    <span class={state === 'error' ? 'error-deleting bg-danger' : undefined}>
      <a href="#" onClick={prevent(() => setState('confirm'))}>
        delete
      </a>
    </span>
  );
}

function ExampleItem({ ex, user, save, highlighted, sid }: { ex: Example; user: CookieUser | null; save: Save; highlighted: boolean; sid: string }) {
  const [editing, setEditing] = useState(false);
  const authors = [ex.author, ...ex.editors].filter((a, i, all) => all.findIndex((b) => b.id === a.id) === i);
  const shown = authors.slice(0, 7);
  const canDelete = user !== null && user.id === ex.author.id;
  return (
    <div class={`var-example${highlighted ? ' highlighted' : ''}`}>
      <a id={`example-${ex.id}`}></a>
      <div>
        <div class="example-meta">
          <div class="contributors">
            {shown.map((a) => (
              <Avatar author={a} key={a.id} />
            ))}
            {authors.length > shown.length && <div class="contributors">+ {authors.length - shown.length} more</div>}
          </div>
          <div class="links">
            <a href={`#example-${ex.id}`}>link</a>
            {' / '}
            <a href={`/ex/${ex.id}`}>history</a>
            {user && (
              <span>
                {' / '}
                <a href="#" onClick={prevent(() => setEditing(!editing))}>
                  {editing ? 'cancel edit' : 'edit'}
                </a>
              </span>
            )}
            {canDelete && !editing && (
              <span>
                {' / '}
                <DeleteControl confirmText="confirm delete?" onConfirm={() => save('DELETE', `/examples/${ex.id}`)} />
              </span>
            )}
            <Report what="example" sid={sid} id={ex.id} />
            <span class="edit-example-widget"></span>
          </div>
        </div>
      </div>
      {editing ? (
        <div>
          <h5>Edit Example</h5>
          <EditorForm
            initial={ex.body}
            submitText="Update Example"
            placeholder="Code Here"
            instructions={<ExampleInstructions />}
            preview={CodePreview}
            guide
            onCancel={() => setEditing(false)}
            onSubmit={async (text) => {
              await save('PATCH', `/examples/${ex.id}`, { body: text });
              setEditing(false);
            }}
          />
        </div>
      ) : (
        <div class="example-body">
          {CodePreview(ex.body)}
          {ex.source === 'python-docs' && <div class="example-source">from the Python docs</div>}
        </div>
      )}
    </div>
  );
}

function Toggle({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) {
  return (
    <div class="toggle-controls">
      <a class="toggle-link" href="#" onClick={prevent(onToggle)}>
        {open ? 'Collapse' : label}
      </a>
    </div>
  );
}

function Examples({ doc, user, save, hash }: { doc: SymbolDoc; user: CookieUser | null; save: Save; hash: string }) {
  const [adding, setAdding] = useState(false);
  const [draftKey, setDraftKey] = useState(0);
  return (
    <div class="var-examples">
      <h5>{pluralize(doc.examples.length, 'Example', 'Examples')}</h5>
      {doc.examples.length === 0 ? (
        <div class="null-state">No examples for {doc.symbol}.</div>
      ) : (
        doc.examples.map((ex) => <ExampleItem key={ex.id} ex={ex} user={user} save={save} highlighted={hash === `#example-${ex.id}`} sid={doc.symbol} />)
      )}
      {user ? (
        <div class="add-example">
          <Toggle open={adding} label="Add an Example" onToggle={() => setAdding(!adding)} />
          <div class={`add-example-content${adding ? '' : ' hidden'}`}>
            {adding && (
              <EditorForm
                key={draftKey}
                initial=""
                submitText="Add Example"
                placeholder="Code Here"
                instructions={<ExampleInstructions />}
                preview={CodePreview}
                guide
                onCancel={() => setAdding(false)}
                onSubmit={async (text) => {
                  await save('POST', '/examples', { body: text });
                  setAdding(false);
                  setDraftKey((k) => k + 1);
                }}
              />
            )}
          </div>
        </div>
      ) : (
        <LoginRequired what="an example" />
      )}
    </div>
  );
}

const splitSid = (sid: string) => {
  const i = sid.indexOf('/');
  return { module: sid.slice(0, i), qualname: sid.slice(i + 1) };
};

function SeeAlsoItem({ sa, doc, user, save, sid }: { sa: SeeAlso; doc: string; user: CookieUser | null; save: Save; sid: string }) {
  const { module, qualname } = splitSid(sa.to);
  return (
    <div class="col-sm-6 see-also">
      <div class="var-title">
        <a href={`/${sa.to}`}>
          <span class="ns">{module}/</span>
          <span class="name">{qualname}</span>
        </a>
      </div>
      <p>
        {doc.slice(0, 100)}
        {doc.length > 100 && '...'}
      </p>
      <div class="meta">
        Added by <a href={`/u/${sa.author.login}`}>{sa.author.login}</a>
        <Report what="see also" sid={sid} id={sa.id} />
        {user?.id === sa.author.id && (
          <span class="delete-controls">
            {' / '}
            <DeleteControl confirmText="confirm delete" onConfirm={() => save('DELETE', `/see-alsos/${sa.id}`)} />
          </span>
        )}
      </div>
    </div>
  );
}

function AddSeeAlso({ doc, save }: { doc: SymbolDoc; save: Save }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [results, setResults] = useState<{ sid: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const onInput = async (v: string) => {
    setText(v);
    const mine = ++seq.current;
    if (!v.trim()) return setResults([]);
    const [{ loadIndex }, { search }] = await Promise.all([import('../scripts/search-index-client'), import('../scripts/search-core')]);
    const hits = search(await loadIndex(), v, 12).filter((e) => e.kind !== 'module').slice(0, 8);
    if (mine === seq.current) setResults(hits.map((e) => ({ sid: `${e.module}/${e.qualname}`, label: `${e.module}/${e.qualname}` })));
  };
  const add = async (sid: string) => {
    setLoading(true);
    setError(null);
    try {
      await save('POST', '/see-alsos', { to: sid });
      setText('');
      setResults([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div class="add-see-also">
      <Toggle open={open} label="Add See Also" onToggle={() => setOpen(!open)} />
      <div class={`add-see-also-content${open ? '' : ' hidden'}`}>
        <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
          <input
            class={`form-control${loading ? ' loading' : ''}`}
            name="see-also-name"
            placeholder="Symbol Name"
            disabled={loading}
            value={text}
            onInput={(e) => void onInput((e.currentTarget as HTMLInputElement).value)}
          />
          {error && (
            <div class="error-message text-danger">
              <i class="fa fa-exclamation-circle"></i> {error}
            </div>
          )}
        </form>
        <div class="ac-results">
          <ul>
            {results.map((r) => {
              const disabledText = r.sid === doc.symbol ? 'This Symbol' : doc.seeAlsos.some((s) => s.to === r.sid) ? 'Already Exists' : null;
              return (
                <li class="flex-apart" key={r.sid}>
                  <div>{r.label}</div>
                  {disabledText ? (
                    <button class="btn btn-default btn-xs" disabled>
                      {disabledText}
                    </button>
                  ) : (
                    <button class="btn btn-success btn-xs" disabled={loading} onClick={prevent(() => void add(r.sid))}>
                      Add
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

function SeeAlsos({ doc, user, save, docs }: { doc: SymbolDoc; user: CookieUser | null; save: Save; docs: Record<string, string> }) {
  const pairs: SeeAlso[][] = [];
  doc.seeAlsos.forEach((sa, i) => (i % 2 ? pairs[pairs.length - 1]!.push(sa) : pairs.push([sa])));
  return (
    <div>
      <h5>See Also</h5>
      {doc.seeAlsos.length === 0 ? (
        <div class="null-state">
          No see-alsos for <code>{doc.symbol}</code>
        </div>
      ) : (
        pairs.map((pair) => (
          <div class="row" key={pair[0]!.id}>
            {pair.map((sa) => (
              <SeeAlsoItem key={sa.id} sa={sa} doc={docs[sa.to] ?? ''} user={user} save={save} sid={doc.symbol} />
            ))}
          </div>
        ))
      )}
      {user ? <AddSeeAlso doc={doc} save={save} /> : <LoginRequired what="a see-also" />}
    </div>
  );
}

const MarkdownInstructions = () => <p class="instructions">Markdown allowed, code in ``` fences.</p>;

function MarkdownBody({ body, html }: { body: string; html?: string }) {
  const [rendered, setRendered] = useState<string | null>(html ?? null);
  useEffect(() => {
    let live = true;
    renderMarkdown(body).then((h) => live && setRendered(h));
    return () => {
      live = false;
    };
  }, [body]);
  return rendered === null ? <div class="note-body markdown"><p>{body}</p></div> : <div class="note-body markdown" dangerouslySetInnerHTML={{ __html: rendered }} />;
}

function MarkdownPreview(text: string) {
  return <MarkdownBody body={text} />;
}

function NoteItem({ note, user, save, sid }: { note: Note; user: CookieUser | null; save: Save; sid: string }) {
  const [editing, setEditing] = useState(false);
  const mine = user?.id === note.author.id;
  return (
    <div class="note">
      <div class="note-meta">
        By <Avatar author={note.author} />, created {timeago(note.createdAt)} ago
        {note.createdAt !== note.updatedAt && <span>, updated {timeago(note.updatedAt)} ago</span>}
        <Report what="note" sid={sid} id={note.id} />
        {mine && (
          <span>
            {' / '}
            <a href="#" onClick={prevent(() => setEditing(!editing))}>
              {editing ? 'cancel edit' : 'edit'}
            </a>
          </span>
        )}
        {mine && !editing && (
          <span>
            {' / '}
            <DeleteControl confirmText="confirm delete?" onConfirm={() => save('DELETE', `/notes/${note.id}`)} />
          </span>
        )}
      </div>
      {editing ? (
        <EditorForm
          initial={note.body}
          submitText="Update Note"
          placeholder="Note"
          instructions={<MarkdownInstructions />}
          preview={MarkdownPreview}
          onCancel={() => setEditing(false)}
          onSubmit={async (text) => {
            await save('PATCH', `/notes/${note.id}`, { body: text });
            setEditing(false);
          }}
        />
      ) : (
        <MarkdownBody body={note.body} />
      )}
    </div>
  );
}

function Notes({ doc, user, save }: { doc: SymbolDoc; user: CookieUser | null; save: Save }) {
  const [adding, setAdding] = useState(false);
  const name = splitSid(doc.symbol).qualname;
  return (
    <div class="var-notes">
      <h5>{pluralize(doc.notes.length, 'Note', 'Notes')}</h5>
      <div>
        {doc.notes.length === 0 ? (
          <div class="null-state">
            No notes for <code>{name}</code>
          </div>
        ) : (
          <ul>
            {doc.notes.map((n) => (
              <li key={n.id}>
                <NoteItem note={n} user={user} save={save} sid={doc.symbol} />
              </li>
            ))}
          </ul>
        )}
      </div>
      {user ? (
        <div class="add-note">
          <Toggle open={adding} label="Add a Note" onToggle={() => setAdding(!adding)} />
          <div class={`add-note-content${adding ? '' : ' hidden'}`}>
            <h5>New Note</h5>
            {adding && (
              <EditorForm
                initial=""
                submitText="Add Note"
                placeholder="Note"
                instructions={<MarkdownInstructions />}
                preview={MarkdownPreview}
                onCancel={() => setAdding(false)}
                onSubmit={async (text) => {
                  await save('POST', '/notes', { body: text });
                  setAdding(false);
                }}
              />
            )}
          </div>
        </div>
      ) : (
        <LoginRequired what="a note" />
      )}
    </div>
  );
}

export default function Community({ sid, initial, seeAlsoDocs = {} }: Props) {
  const [doc, setDoc] = useState<SymbolDoc>(initial ?? emptyDoc(sid));
  const [user, setUser] = useState<CookieUser | null>(null);
  const [hash, setHash] = useState('');
  const [docs, setDocs] = useState(seeAlsoDocs);

  useEffect(() => {
    setUser(currentUser());
    setHash(location.hash);
    const onHash = () => setHash(location.hash);
    addEventListener('hashchange', onHash);
    loadLiveDoc(sid)
      .then((live) => {
        if (live.updatedAt !== doc.updatedAt) setDoc(live);
        updateCounts(live);
        if (location.hash.startsWith('#example-')) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
      })
      .catch((e) => console.warn('live refresh failed', e));
    return () => removeEventListener('hashchange', onHash);
  }, [sid]);

  // One-line docs for see-also targets added after the build.
  const missing = useMemo(() => doc.seeAlsos.map((s) => s.to).filter((t) => !(t in docs)), [doc, docs]);
  useEffect(() => {
    if (!missing.length) return;
    Promise.all([import('../scripts/search-index-client'), import('../scripts/search-core')]).then(async ([{ loadIndex }]) => {
      const p = await loadIndex();
      const found: Record<string, string> = {};
      for (const e of p.entries) {
        const id = `${e.module}/${e.qualname}`;
        if (missing.includes(id)) found[id] = e.summary;
      }
      setDocs((d) => ({ ...d, ...found }));
    });
  }, [missing.join('|')]);

  const save: Save = async (method, path, body) => {
    const next = await api(sid, method, path, body);
    setDoc(next);
    updateCounts(next);
  };

  return (
    <>
      <section>
        <div class="examples-widget" id="examples">
          <Examples doc={doc} user={user} save={save} hash={hash} />
        </div>
      </section>
      <section>
        <div class="see-alsos-widget" id="see-also">
          <SeeAlsos doc={doc} user={user} save={save} docs={docs} />
        </div>
      </section>
      <section>
        <div class="notes-widget" id="notes">
          <Notes doc={doc} user={user} save={save} />
        </div>
      </section>
    </>
  );
}
