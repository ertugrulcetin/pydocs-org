// Hand-curated Python quick reference (PLAN.md §5 #24): spheres > categories >
// groups > symbol ids. Same shape as ClojureDocs' quickref, original Python
// content. Every id is checked against data/py-3.15 at build time.
export interface QGroup {
  title: string;
  ids: string[];
}
export interface QCategory {
  title: string;
  slug: string;
  groups: QGroup[];
}
export interface QSphere {
  title: string;
  slug: string;
  categories: QCategory[];
}

const b = (...names: string[]) => names.map((n) => `builtins/${n}`);
const m = (mod: string, ...names: string[]) => names.map((n) => `${mod}/${n}`);

export const quickref: QSphere[] = [
  {
    title: 'Simple Values',
    slug: 'simple-values',
    categories: [
      {
        title: 'Numbers',
        slug: 'numbers',
        groups: [
          { title: 'Arithmetic', ids: b('abs', 'divmod', 'pow', 'round', 'sum', 'min', 'max') },
          { title: 'Convert', ids: b('int', 'float', 'complex', 'bin', 'oct', 'hex', 'int.from_bytes', 'int.to_bytes', 'float.as_integer_ratio', 'float.is_integer') },
          { title: 'Math', ids: m('math', 'floor', 'ceil', 'trunc', 'sqrt', 'isqrt', 'exp', 'log', 'log10', 'log2', 'isclose', 'gcd', 'lcm', 'factorial', 'comb', 'perm', 'prod', 'fsum', 'pi', 'inf', 'nan', 'isnan', 'isinf') },
          { title: 'Exact', ids: [...m('decimal', 'Decimal', 'getcontext'), ...m('fractions', 'Fraction')] },
          { title: 'Random', ids: m('random', 'random', 'randint', 'randrange', 'uniform', 'choice', 'choices', 'sample', 'shuffle', 'seed') },
          { title: 'Statistics', ids: m('statistics', 'mean', 'median', 'mode', 'stdev', 'variance', 'quantiles') },
        ],
      },
      {
        title: 'Booleans',
        slug: 'booleans',
        groups: [
          { title: 'Create', ids: b('bool') },
          { title: 'Test', ids: b('all', 'any', 'callable', 'isinstance', 'issubclass') },
        ],
      },
      {
        title: 'Strings',
        slug: 'strings',
        groups: [
          { title: 'Create', ids: b('str', 'repr', 'ascii', 'chr', 'ord', 'format', 'str.format', 'str.format_map') },
          { title: 'Test', ids: b('str.startswith', 'str.endswith', 'str.isdigit', 'str.isnumeric', 'str.isalpha', 'str.isalnum', 'str.isspace', 'str.isupper', 'str.islower', 'str.isidentifier') },
          { title: 'Search', ids: b('str.find', 'str.rfind', 'str.index', 'str.count') },
          { title: 'Transform', ids: b('str.upper', 'str.lower', 'str.casefold', 'str.title', 'str.capitalize', 'str.swapcase', 'str.replace', 'str.strip', 'str.lstrip', 'str.rstrip', 'str.removeprefix', 'str.removesuffix', 'str.zfill', 'str.center', 'str.ljust', 'str.rjust', 'str.expandtabs', 'str.translate', 'str.maketrans') },
          { title: 'Split / Join', ids: b('str.split', 'str.rsplit', 'str.splitlines', 'str.partition', 'str.rpartition', 'str.join') },
          { title: 'Text Tools', ids: [...m('textwrap', 'dedent', 'indent', 'fill', 'wrap', 'shorten'), ...m('string', 'Template', 'ascii_letters', 'digits', 'punctuation'), ...m('difflib', 'get_close_matches', 'unified_diff')] },
        ],
      },
      {
        title: 'Regular Expressions',
        slug: 'regular-expressions',
        groups: [
          { title: 'Match', ids: m('re', 'match', 'search', 'fullmatch', 'findall', 'finditer') },
          { title: 'Change', ids: m('re', 'sub', 'subn', 'split', 'escape') },
          { title: 'Compile', ids: m('re', 'compile', 'Pattern', 'Match', 'Match.group', 'Match.groups', 'Match.groupdict', 'IGNORECASE', 'MULTILINE', 'DOTALL', 'VERBOSE') },
        ],
      },
      {
        title: 'Bytes',
        slug: 'bytes',
        groups: [
          { title: 'Create', ids: b('bytes', 'bytearray', 'memoryview', 'bytes.fromhex') },
          { title: 'Convert', ids: [...b('bytes.decode', 'str.encode', 'bytes.hex'), ...m('base64', 'b64encode', 'b64decode'), ...m('struct', 'pack', 'unpack')] },
        ],
      },
    ],
  },
  {
    title: 'Collections',
    slug: 'collections',
    categories: [
      {
        title: 'Lists',
        slug: 'lists',
        groups: [
          { title: 'Create', ids: b('list', 'range', 'list.copy') },
          { title: 'Change', ids: b('list.append', 'list.extend', 'list.insert', 'list.remove', 'list.pop', 'list.clear', 'list.sort', 'list.reverse') },
          { title: 'Inspect', ids: b('len', 'list.index', 'list.count', 'sorted', 'reversed', 'min', 'max') },
          { title: 'Sorted lists', ids: m('bisect', 'bisect_left', 'bisect_right', 'insort') },
        ],
      },
      {
        title: 'Tuples',
        slug: 'tuples',
        groups: [
          { title: 'Create', ids: [...b('tuple', 'tuple.count', 'tuple.index'), ...m('collections', 'namedtuple'), ...m('typing', 'NamedTuple')] },
        ],
      },
      {
        title: 'Dictionaries',
        slug: 'dictionaries',
        groups: [
          { title: 'Create', ids: b('dict', 'dict.fromkeys', 'dict.copy') },
          { title: 'Read', ids: b('dict.get', 'dict.keys', 'dict.values', 'dict.items') },
          { title: 'Change', ids: b('dict.setdefault', 'dict.update', 'dict.pop', 'dict.popitem', 'dict.clear') },
          { title: 'Specialized', ids: m('collections', 'defaultdict', 'Counter', 'Counter.most_common', 'OrderedDict', 'ChainMap') },
          { title: 'Views', ids: m('types', 'MappingProxyType') },
        ],
      },
      {
        title: 'Sets',
        slug: 'sets',
        groups: [
          { title: 'Create', ids: b('set', 'frozenset') },
          { title: 'Change', ids: b('set.add', 'set.discard', 'set.remove', 'set.pop', 'set.update', 'set.clear') },
          { title: 'Set operations', ids: b('frozenset.union', 'frozenset.intersection', 'frozenset.difference', 'frozenset.symmetric_difference') },
          { title: 'Test', ids: b('frozenset.issubset', 'frozenset.issuperset', 'frozenset.isdisjoint') },
        ],
      },
      {
        title: 'Specialized Containers',
        slug: 'specialized-containers',
        groups: [
          { title: 'Queues', ids: [...m('collections', 'deque'), ...m('queue', 'Queue', 'PriorityQueue')] },
          { title: 'Heaps', ids: m('heapq', 'heappush', 'heappop', 'heapify', 'nlargest', 'nsmallest', 'merge') },
          { title: 'Records', ids: [...m('dataclasses', 'dataclass', 'field', 'asdict', 'replace', 'fields'), ...m('typing', 'TypedDict')] },
          { title: 'Arrays', ids: m('array', 'array') },
        ],
      },
    ],
  },
  {
    title: 'Iteration & Functions',
    slug: 'iteration-functions',
    categories: [
      {
        title: 'Iteration',
        slug: 'iteration',
        groups: [
          { title: 'Basics', ids: b('iter', 'next', 'enumerate', 'zip', 'range', 'reversed', 'sorted', 'len') },
          { title: 'Transform', ids: b('map', 'filter', 'sum', 'min', 'max', 'all', 'any') },
        ],
      },
      {
        title: 'itertools',
        slug: 'itertools',
        groups: [
          { title: 'Infinite', ids: m('itertools', 'count', 'cycle', 'repeat') },
          { title: 'Slice / Filter', ids: m('itertools', 'islice', 'takewhile', 'dropwhile', 'filterfalse', 'compress') },
          { title: 'Combine', ids: m('itertools', 'chain', 'chain.from_iterable', 'zip_longest', 'pairwise', 'batched', 'tee') },
          { title: 'Group / Accumulate', ids: m('itertools', 'groupby', 'accumulate', 'starmap') },
          { title: 'Combinatorics', ids: m('itertools', 'product', 'permutations', 'combinations', 'combinations_with_replacement') },
        ],
      },
      {
        title: 'Functional Tools',
        slug: 'functional-tools',
        groups: [
          { title: 'functools', ids: m('functools', 'partial', 'reduce', 'cache', 'lru_cache', 'cached_property', 'wraps', 'total_ordering', 'singledispatch', 'cmp_to_key') },
          { title: 'operator', ids: m('operator', 'itemgetter', 'attrgetter', 'methodcaller', 'add', 'mul', 'not_') },
        ],
      },
      {
        title: 'Generators & Context Managers',
        slug: 'generators-context-managers',
        groups: [
          { title: 'contextlib', ids: m('contextlib', 'contextmanager', 'asynccontextmanager', 'suppress', 'closing', 'nullcontext', 'ExitStack', 'redirect_stdout', 'chdir') },
          { title: 'Generator protocol', ids: m('collections.abc', 'Iterable', 'Iterator', 'Generator') },
        ],
      },
    ],
  },
  {
    title: 'Objects & Types',
    slug: 'objects-types',
    categories: [
      {
        title: 'Type Inspection',
        slug: 'type-inspection',
        groups: [
          { title: 'Types', ids: b('type', 'isinstance', 'issubclass', 'callable', 'id', 'hash') },
          { title: 'Attributes', ids: b('getattr', 'setattr', 'hasattr', 'delattr', 'dir', 'vars') },
          { title: 'inspect', ids: m('inspect', 'signature', 'getsource', 'getmembers', 'getdoc', 'isfunction', 'isclass') },
        ],
      },
      {
        title: 'Classes',
        slug: 'classes',
        groups: [
          { title: 'Define', ids: b('object', 'property', 'classmethod', 'staticmethod', 'super') },
          { title: 'Abstract', ids: m('abc', 'ABC', 'abstractmethod') },
          { title: 'Enums', ids: m('enum', 'Enum', 'IntEnum', 'StrEnum', 'Flag', 'auto') },
          { title: 'Copy', ids: m('copy', 'copy', 'deepcopy') },
        ],
      },
      {
        title: 'Type Hints',
        slug: 'type-hints',
        groups: [
          { title: 'typing', ids: m('typing', 'Any', 'Optional', 'Union', 'Literal', 'TypeVar', 'Generic', 'Protocol', 'Callable', 'cast', 'overload', 'Self', 'TYPE_CHECKING') },
        ],
      },
    ],
  },
  {
    title: 'Errors',
    slug: 'errors',
    categories: [
      {
        title: 'Exceptions',
        slug: 'exceptions',
        groups: [
          { title: 'Common', ids: b('Exception', 'ValueError', 'TypeError', 'KeyError', 'IndexError', 'AttributeError', 'NameError', 'RuntimeError', 'NotImplementedError', 'StopIteration', 'ZeroDivisionError') },
          { title: 'OS', ids: b('OSError', 'FileNotFoundError', 'PermissionError', 'TimeoutError') },
          { title: 'Groups', ids: b('ExceptionGroup', 'BaseExceptionGroup', 'BaseException.add_note') },
          { title: 'Tracebacks', ids: m('traceback', 'print_exc', 'format_exc') },
        ],
      },
      {
        title: 'Warnings & Logging',
        slug: 'warnings-logging',
        groups: [
          { title: 'warnings', ids: m('warnings', 'warn', 'catch_warnings', 'filterwarnings') },
          { title: 'logging', ids: m('logging', 'getLogger', 'basicConfig', 'debug', 'info', 'warning', 'error', 'exception', 'Logger') },
        ],
      },
    ],
  },
  {
    title: 'IO',
    slug: 'io',
    categories: [
      {
        title: 'Console',
        slug: 'console',
        groups: [{ title: 'Print / Read', ids: [...b('print', 'input'), ...m('pprint', 'pprint', 'pformat')] }],
      },
      {
        title: 'Files & Paths',
        slug: 'files-paths',
        groups: [
          { title: 'Open', ids: [...b('open'), ...m('io', 'StringIO', 'BytesIO')] },
          { title: 'pathlib', ids: m('pathlib', 'Path', 'Path.read_text', 'Path.write_text', 'Path.exists', 'Path.iterdir', 'Path.glob', 'Path.mkdir', 'Path.unlink', 'PurePath.name', 'PurePath.suffix', 'PurePath.parent') },
          { title: 'os.path', ids: m('os.path', 'join', 'exists', 'isfile', 'isdir', 'basename', 'dirname', 'splitext', 'abspath', 'expanduser') },
          { title: 'Copy / Move / Delete', ids: [...m('shutil', 'copy', 'copytree', 'move', 'rmtree'), ...m('os', 'remove', 'rename', 'listdir', 'walk', 'makedirs')] },
          { title: 'Temporary', ids: m('tempfile', 'TemporaryDirectory', 'NamedTemporaryFile', 'mkdtemp') },
        ],
      },
      {
        title: 'Data Formats',
        slug: 'data-formats',
        groups: [
          { title: 'JSON', ids: m('json', 'dumps', 'loads', 'dump', 'load') },
          { title: 'CSV', ids: m('csv', 'reader', 'writer', 'DictReader', 'DictWriter') },
          { title: 'Other', ids: [...m('tomllib', 'load', 'loads'), ...m('pickle', 'dumps', 'loads'), ...m('sqlite3', 'connect')] },
        ],
      },
    ],
  },
  {
    title: 'Environment',
    slug: 'environment',
    categories: [
      {
        title: 'Time & Dates',
        slug: 'time-dates',
        groups: [
          { title: 'time', ids: m('time', 'time', 'sleep', 'perf_counter', 'monotonic', 'strftime') },
          { title: 'datetime', ids: [...m('datetime', 'datetime', 'datetime.now', 'datetime.strptime', 'datetime.strftime', 'datetime.fromisoformat', 'datetime.isoformat', 'date', 'timedelta', 'timezone'), ...m('zoneinfo', 'ZoneInfo')] },
        ],
      },
      {
        title: 'Concurrency',
        slug: 'concurrency',
        groups: [
          { title: 'asyncio', ids: m('asyncio', 'run', 'gather', 'sleep', 'create_task', 'wait_for', 'TaskGroup', 'timeout', 'Queue') },
          { title: 'Threads / Processes', ids: [...m('threading', 'Thread', 'Lock', 'Event'), ...m('concurrent.futures', 'ThreadPoolExecutor', 'ProcessPoolExecutor', 'as_completed')] },
          { title: 'Subprocess', ids: m('subprocess', 'run', 'check_output', 'Popen', 'CalledProcessError') },
        ],
      },
      {
        title: 'System',
        slug: 'system',
        groups: [
          { title: 'sys', ids: m('sys', 'argv', 'exit', 'path', 'version_info', 'platform', 'stdin', 'stdout', 'stderr') },
          { title: 'os', ids: m('os', 'environ', 'getenv', 'getcwd', 'chdir', 'cpu_count') },
          { title: 'Command line', ids: m('argparse', 'ArgumentParser', 'ArgumentParser.add_argument', 'ArgumentParser.parse_args') },
          { title: 'Misc', ids: [...m('shutil', 'which'), ...m('platform', 'system', 'python_version'), ...m('importlib', 'import_module')] },
        ],
      },
    ],
  },
];

/** The four categories shown on the home page as "builtins, by purpose" (ClojureDocs shows four for clojure.core). */
export const HOME_CATEGORIES = ['strings', 'lists', 'dictionaries', 'iteration'];

/** Featured modules on the home page ("More modules"), with a few highlight symbols each. */
export const HOME_MODULES: { module: string; highlights: string[] }[] = [
  { module: 'os.path', highlights: ['join', 'exists', 'basename', 'splitext'] },
  { module: 'collections', highlights: ['Counter', 'defaultdict', 'deque', 'namedtuple'] },
  { module: 'itertools', highlights: ['chain', 'groupby', 'product', 'islice'] },
  { module: 'functools', highlights: ['partial', 'reduce', 'lru_cache', 'wraps'] },
  { module: 're', highlights: ['search', 'sub', 'findall', 'compile'] },
  { module: 'json', highlights: ['dumps', 'loads', 'dump', 'load'] },
  { module: 'pathlib', highlights: ['Path', 'Path.read_text', 'Path.glob', 'Path.mkdir'] },
  { module: 'datetime', highlights: ['datetime', 'date', 'timedelta', 'datetime.strptime'] },
];
