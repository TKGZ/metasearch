// Can't use import/require in this source file since its compiled JS is loaded
// directly into the browser

const { useEffect, useReducer, useState } = React;

interface ResultGroup {
  elapsedMs: number;
  engineId: string;
  results: Result[];
}

const { ENGINES, FOOTER, TRACKING_ID } = window.metasearch;

/** Converts an object to a query string that includes a cache-busting param */
const querify = (params: Record<string, string> = {}) =>
  Object.entries({ ...params, _: Date.now() })
    .sort((a, b) => (a[0] > b[0] ? 1 : -1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

const Header = ({
  onChange,
  onSearch,
  q,
}: {
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSearch: (q: string) => any;
  q: string;
}) => (
  <div className="header">
    <form
      onSubmit={e => {
        onSearch(q);
        e.preventDefault();
      }}
    >
      <input
        autoFocus
        className="search-box"
        // For Firefox's "Add a Keyword for this Search..." feature
        name="q"
        onChange={onChange}
        placeholder={"Search for anything!"}
        type="text"
        value={q}
      />
      <input className="submit" title="Search" type="submit" value="" />
    </form>
  </div>
);

const Sidebar = ({
  hiddenEngines,
  resultGroups,
}: {
  hiddenEngines: string[];
  resultGroups: ResultGroup[];
}) => (
  <div className="sidebar">
    <ul>
      {Object.values(ENGINES)
        .sort((a, b) => (a.name > b.name ? 1 : -1))
        .map(engine => {
          const numResults = resultGroups.find(rg => rg.engineId === engine.id)
            ?.results.length;
          return (
            <li
              className={
                numResults && !hiddenEngines.includes(engine.id)
                  ? "has-results"
                  : undefined
              }
              key={engine.id}
              onClick={() => {
                if (!numResults) {
                  return;
                }
                const $results = document.querySelector(".results");
                const $resultGroup: HTMLDivElement | null = document.querySelector(
                  `[data-engine-results=${engine.id}]`,
                );
                if (!($results && $resultGroup)) {
                  return;
                }
                $results.scrollTo({
                  behavior: "smooth",
                  top: $resultGroup.offsetTop,
                });
              }}
              title={
                numResults === undefined
                  ? "Searching..."
                  : numResults
                  ? "Jump to results"
                  : "No results found"
              }
            >
              <div className="engine-wrap">
                {engine.name}
                {numResults === undefined ? null : (
                  <span className="num-results">{numResults}</span>
                )}
              </div>
            </li>
          );
        })}
    </ul>
  </div>
);

/** Converts 1593668572 to "Jul 2" */
const formatDate = (() => {
  const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "America/New_York",
    year: "numeric",
  });
  const THIS_YEAR = `, ${new Date().getFullYear()}`;

  return (unixTimestampSeconds: number) =>
    DATE_FORMATTER.format(new Date(unixTimestampSeconds * 1000)).replace(
      THIS_YEAR,
      "",
    );
})();

const Results = ({
  hiddenEngines,
  onToggle,
  resultGroups,
}: {
  hiddenEngines: string[];
  onToggle: (engineId: string) => void;
  resultGroups: ResultGroup[];
}) => (
  <div className="results">
    {resultGroups
      .filter(rg => rg.results.length)
      .map(({ elapsedMs, engineId, results }) => {
        const showResults = !hiddenEngines.includes(engineId);
        return (
          <div
            className="result-group"
            data-engine-results={engineId}
            key={engineId}
          >
            <h2
              className={showResults ? undefined : "hide-results"}
              onClick={() => onToggle(engineId)}
              title="Toggle results"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 -256 1792 1792"
              >
                <path
                  d="M1426.44 407.864q0 26-19 45l-448 448q-19 19-45 19t-45-19l-448-448q-19-19-19-45t19-45q19-19 45-19h896q26 0 45 19t19 45z"
                  fill="currentColor"
                />
              </svg>
              {ENGINES[engineId].name}
            </h2>
            <span className="stats">
              {results.length} result{results.length === 1 ? "" : "s"} (
              {(elapsedMs / 1000).toFixed(2)} seconds)
            </span>
            {showResults
              ? results.map((result, i) => (
                  <div className="result" key={i}>
                    <div>
                      <a
                        className="title"
                        dangerouslySetInnerHTML={{ __html: result.title }}
                        href={result.url}
                      />
                      {result.modified ? (
                        <span className="modified">
                          {formatDate(result.modified)}
                        </span>
                      ) : null}
                    </div>
                    {result.snippet ? (
                      <div
                        className="snippet"
                        dangerouslySetInnerHTML={{ __html: result.snippet }}
                      />
                    ) : null}
                  </div>
                ))
              : null}
          </div>
        );
      })}
  </div>
);

const memoize = <F extends Function>(fn: F) => {
  let cache: Record<string, any> = {};
  return (((...args: any[]) => {
    const cacheKey = JSON.stringify(args);
    if (!(cacheKey in cache)) {
      cache[cacheKey] = fn(...args);
    }
    return cache[cacheKey];
  }) as unknown) as F;
};

const getResults = memoize(
  async (id: string, q: string): Promise<Result[]> =>
    await (await fetch(`/api/search?${querify({ engine: id, q })}`)).json(),
);

const handleSearch = async (
  dispatch: React.Dispatch<ResultGroup | undefined>,
  q: string,
  createHistoryEntry: boolean,
) => {
  // Normalize and validate query
  q = q.trim().replace(/\s+/, " ");
  if (!/\w/.test(q)) {
    return;
  }

  // Update browser URL and tab title
  const path = `/?q=${encodeURIComponent(q)}`;
  createHistoryEntry
    ? window.history.pushState(null, "", path)
    : window.history.replaceState(null, "", path);
  TRACKING_ID && window.gtag?.("config", TRACKING_ID, { page_path: path });
  document.title = `${q} - Metasearch`;

  // Clear results
  dispatch(undefined);

  // Get results
  const highlightRegex = new RegExp(
    q
      .replace(/\W|_/g, "")
      .split("")
      .join("(\\W|_)*"),
    "gi",
  );
  await Promise.all(
    Object.values(ENGINES).map(async engine => {
      const start = Date.now();
      const results = await getResults(engine.id, q);

      // Highlight query
      for (const result of results) {
        for (const property of ["title", "snippet"] as const) {
          const value = result[property];
          if (!value) {
            continue;
          }
          const node = new DOMParser().parseFromString(value, "text/html").body;
          new window.Mark(node).markRegExp(highlightRegex);
          result[property] = node.innerHTML;
        }
      }

      dispatch({ elapsedMs: Date.now() - start, engineId: engine.id, results });
    }),
  );
};

/** Helper for interacting with localStorage */
const STORAGE_MANAGER = (() => {
  type Data = Partial<{
    hiddenEngines: string[];
  }>;
  let cachedData: Data = JSON.parse(window.localStorage.metasearch || "{}");
  return {
    get: () => cachedData,
    set: (data: Data) => {
      cachedData = data;
      window.localStorage.metasearch = JSON.stringify(data);
    },
  };
})();

const getUrlQ = () =>
  new URLSearchParams(window.location.search).get("q") ?? "";

const App = () => {
  const [localData, setLocalData] = useState(STORAGE_MANAGER.get());
  const [q, setQ] = useState<string>("");
  const [resultGroups, dispatch] = useReducer(
    (state: ResultGroup[], action: ResultGroup | undefined) =>
      action ? [...state, action] : [],
    [],
  );

  useEffect(() => {
    // Run query on initial page load and on HTML5 history change
    const runUrlQ = () => {
      const urlQ = getUrlQ();
      setQ(urlQ);
      handleSearch(dispatch, urlQ, false);
    };
    runUrlQ();
    window.addEventListener("popstate", runUrlQ);
  }, []);

  useEffect(() => {
    STORAGE_MANAGER.set(localData);
  }, [localData]);

  return (
    <>
      <div
        className="logo"
        onClick={() => {
          document
            .querySelector(".results")
            ?.scrollTo({ behavior: "smooth", top: 0 });
        }}
      >
        Metasearch
      </div>
      <Header
        onChange={e => setQ(e.target.value)}
        onSearch={q => handleSearch(dispatch, q, !!getUrlQ().trim())}
        q={q}
      />
      <Sidebar
        hiddenEngines={localData.hiddenEngines || []}
        resultGroups={resultGroups}
      />
      <Results
        hiddenEngines={localData.hiddenEngines || []}
        onToggle={engineId => {
          const hiddenEngines = localData.hiddenEngines || [];
          setLocalData({
            ...localData,
            hiddenEngines: hiddenEngines.includes(engineId)
              ? hiddenEngines.filter(id => id !== engineId)
              : [...hiddenEngines, engineId].sort(),
          });
        }}
        resultGroups={resultGroups}
      />
      <div
        className="footer"
        dangerouslySetInnerHTML={FOOTER ? { __html: FOOTER } : undefined}
      />
    </>
  );
};

ReactDOM.render(React.createElement(App), document.querySelector("#root"));
