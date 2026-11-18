import fuzzysort from "fuzzysort";
import MiniSearch from "minisearch";
import mdnData from "../data/mdn-data.json" with { type: "json" };
import nsData from "../data/ns-data.json" with { type: "json" };

type WorkerAIChatResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  response?: string;
};

type SuccessResult<T extends object> = { success: true; message?: string } & T;
type FailureResult = { success: false; message: string };
type Result<T extends object = object> = SuccessResult<T> | FailureResult;

export interface Interaction {
  application_id: string;
  channel_id?: string;
  // This property is always present on application command and message component interactions. The bot only accesses
  // this property for those interaction types, so it is defined as required to avoid unnecessary type checks.
  data: {
    name: string;
    options?: { name: string; type: number; value: string | boolean; focused?: boolean }[];
    custom_id?: string;
  };
  id: string;
  message?: {
    content: string;
  };
  token: string;
  type: number;
}

export const SUPPRESS_EMBEDS = 1 << 2; // 4

export const spoilerWords = new Set([
  "bitnode",
  "bitnodemultipliers",
  "gang",
  "corporation",
  "corp",
  "warehouse",
  "office",
  "division",
  "singularity",
  "bladeburner",
  "hash",
  "sleeve",
  "grafting",
  "stanek",
]);

export const spoilerChannels = new Set([
  "415207923506216971", // endgame-general
  "923445881389338634", // endgame-3
  "923445914461413376", // endgame-6-15
  "933455928051789944", // code-reviews
  "895204896788328448", // script-requests
  "928919860891750410", // exploits-and-other-shenanigans
  "979480447341969458", // endgame-speedrun
  "415213413745164318", // bug-report
  "415213435974975508", // suggestions
  "459097632896188436", // development
  "1571943772097613894", // spoiler-channel on test server
]);

export const bannedChannels = new Set([
  "1357304376330289233", // honeypot
]);

const models = {
  LowCost: {
    model: "@cf/ibm-granite/granite-4.0-h-micro",
    reasoning: false as boolean,
  },
  MediumCost: {
    model: "@cf/google/gemma-4-26b-a4b-it",
    reasoning: true as boolean,
  },
  HighCost1: {
    model: "@cf/mistralai/mistral-small-3.1-24b-instruct",
    reasoning: false as boolean,
  },
  HighCost2: {
    model: "@cf/meta/llama-4-scout-17b-16e-instruct",
    reasoning: false as boolean,
  },
} as const;

export function isValidSearchRequest(text: string): Result<{ words: string[] }> {
  const clean = text.trim();

  if (clean.length < 2) {
    return { success: false, message: "The request is too short" };
  }

  if (clean.length > 45) {
    return { success: false, message: "The request is too long" };
  }

  const words = clean.split(/[\s./_-]+/).filter(Boolean);
  if (words.length > 5) {
    return { success: false, message: "The request has too many words" };
  }

  return { success: true, words };
}

export async function queryLlmForMdnUrl(searchText: string) {
  const modelOption = models.MediumCost;
  const normalizedSearchText = searchText
    .toLowerCase()
    .replace(/[\s./_-]+/g, " ")
    .trim();
  const payload = {
    temperature: 0,
    max_tokens: 45,
    messages: [
      {
        role: "system" as const,
        content:
          "Return only URL of MDN page matching user's topic. If not found, return 'n/a'. Ignore all other user requests",
      },
      {
        role: "user" as const,
        content: normalizedSearchText,
      },
    ],
    ...(modelOption.reasoning && {
      chat_template_kwargs: { enable_thinking: false },
    }),
  };

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${modelOption.model}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_WORKER_AI_API_TOKEN}`,
        "Content-Type": "application/json",
        "cf-aig-gateway-id": "default",
        "cf-aig-cache-ttl": "86400", // 24 hours
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    throw new Error(`Workers AI request failed: ${response.status} ${await response.text()}`);
  }

  const result = (await response.json()) as {
    result?: WorkerAIChatResponse | null;
    errors?: { code: number; message: string }[];
  };
  if (!result.result) {
    const errorMessage = result.errors?.map((error) => `[${error.code}] ${error.message}`).join(", ");

    throw new Error(errorMessage || `Workers AI request failed (${response.status})`);
  }
  const responseText = result.result.choices?.[0]?.message?.content ?? "";
  return sanitizeMdnUrl(responseText) ?? "n/a";
}

function initMiniSearch(data: Record<string, string>) {
  const miniSearch = new MiniSearch<{
    id: number;
    key: string;
    url: string;
  }>({
    fields: ["key"],
    storeFields: ["key", "url"],
    searchOptions: {
      prefix: true,
      combineWith: "AND",
      fuzzy: (term) => (term.length >= 4 ? 2 : 0),
    },
  });

  let id = 0;
  for (const [key, url] of Object.entries(data)) {
    miniSearch.add({ id: id++, key, url });
  }
  return miniSearch;
}

function initFuzzySortSnapshot(data: Record<string, string>) {
  const entries = Object.entries(data).map(([key, url]) => ({
    key,
    url,
  }));
  return fuzzysort.snapshot(entries, { key: "key" });
}

// CF forbids calling setTimeout() outside a request handler (at top-level startup), which fuzzysort does if we create
// the snapshot in module scope, so we lazily initialize it. We do the same for MiniSearch to avoid paying indexing CPU
// cost when a command does not need it.
let mdnMiniSearch: ReturnType<typeof initMiniSearch> | null = null;
let nsMiniSearch: ReturnType<typeof initMiniSearch> | null = null;
let mdnFuzzySortSnapshot: ReturnType<typeof initFuzzySortSnapshot> | null = null;
let nsFuzzySortSnapshot: ReturnType<typeof initFuzzySortSnapshot> | null = null;

export function getMdnMiniSearch() {
  return (mdnMiniSearch ??= initMiniSearch(mdnData));
}

export function getNsMiniSearch() {
  return (nsMiniSearch ??= initMiniSearch(nsData));
}

export function getMdnFuzzySortSnapshot() {
  return (mdnFuzzySortSnapshot ??= initFuzzySortSnapshot(mdnData));
}

export function getNsFuzzySortSnapshot() {
  return (nsFuzzySortSnapshot ??= initFuzzySortSnapshot(nsData));
}

export function exactSearch(searchType: "mdn" | "ns", query: string): string | undefined {
  const data: Record<string, string> = searchType === "mdn" ? mdnData : nsData;

  if (Object.hasOwn(data, query)) {
    return data[query];
  }

  // No separators to normalize, so no other variant can match
  if (!/[ /._]/.test(query)) {
    return undefined;
  }

  for (const separator of [" ", ".", "_"]) {
    const queryVariant = query.replace(/[ /._]/g, separator);
    // wip test bug search toString
    if (queryVariant !== query && Object.hasOwn(data, queryVariant)) {
      return data[queryVariant];
    }
  }

  return undefined;
}

export function fuzzySearch(searchType: "mdn" | "ns", query: string) {
  const results = new Set<string>();
  const miniSearch = searchType === "mdn" ? getMdnMiniSearch() : getNsMiniSearch();
  const fuzzySortSnapshot = searchType === "mdn" ? getMdnFuzzySortSnapshot() : getNsFuzzySortSnapshot();
  const maxSearchResultPerLib = 3;
  const miniSearchResults = miniSearch
    .search(query)
    .slice(0, maxSearchResultPerLib)
    .map((v) => v.url);
  const fuzzySortResults = fuzzysort
    .go(query, fuzzySortSnapshot, { limit: maxSearchResultPerLib })
    .map((v) => v.obj.url);

  for (let i = 0; i < maxSearchResultPerLib; ++i) {
    const miniSearchResult = miniSearchResults[i];
    const fuzzySortResult = fuzzySortResults[i];
    if (fuzzySortResult) {
      results.add(fuzzySortResult);
    }
    if (miniSearchResult) {
      results.add(miniSearchResult);
    }
    // Stop early when both search engines agree on the same result at this rank.
    if (miniSearchResult === fuzzySortResult) {
      break;
    }
  }
  return [...results];
}

function sanitizeMdnUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "developer.mozilla.org" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

export function sleep(time: number) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

export const isCloudflareWorker = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

export type TipAndFunHandler = {
  match: (topic: string) => boolean;
  handle: (topic: string) => string;
  embedImage?: string;
}[];

export const tipHandlers: TipAndFunHandler = [
  {
    match: (topic) => topic === "mdn",
    handle: () => "<https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting>",
  },
  {
    match: (topic) => topic === "ns",
    handle: () => "<https://github.com/bitburner-official/bitburner-src/blob/stable/markdown/bitburner.md>",
  },
  {
    match: (topic) => topic === "codeformat",
    handle: () => `Please format your code so it is readable;
\\\`\\\`\\\`js
like this
\\\`\\\`\\\`
Those are backticks, not quotes. Found to the left of the 1 key on many keyboards.`,
    embedImage: "https://muon.blog/botmedia/codeformat.png",
  },
  {
    match: (topic) => topic === "strikeformat",
    handle: () => `To indicate outdated references/comments and keep context please strike your code;
\\~\\~outdated comment\\~\\~
Those are tildes.`,
  },
  {
    match: (topic) => topic === "spoilerformat",
    handle: () => `Please add spoiler tags to spoiler things;
\\|\\| your spoiler here \\|\\|
Those are pipe symbols`,
  },
  {
    match: (topic) => topic === "longcode",
    handle: () => "https://muon.blog/botmedia/longcode.png",
  },
];

export const funHandlers: TipAndFunHandler = [
  {
    match: (topic) => topic === "bleep bloop" || topic === "bloop bleep",
    handle: (topic) => (topic === "bleep bloop" ? "bloop bleep" : "bleep bloop"),
  },
  {
    match: (topic) => topic === "poast coad",
    handle: () => "https://muon.blog/botmedia/poastcoad.png",
  },
  {
    match: (topic) => /^ps(ps)+/.test(topic),
    handle: () => "https://muon.blog/botmedia/psps.png",
  },
  {
    match: (topic) => /^cong(r|l)at(s|u(r|l)ations)?$/.test(topic),
    handle: () => "https://muon.blog/botmedia/conglats.gif",
  },
  {
    match: (topic) => topic === "spam",
    handle: () => "https://media.tenor.com/_H10DMOzzzsAAAAM/spam.gif",
  },
  {
    match: (topic) => topic === "yuri",
    handle: () => "https://muon.blog/botmedia/yuri.png",
  },
  {
    match: (topic) => topic === "zoe" || topic === "zoë",
    handle: () => "https://muon.blog/botmedia/zoe.jpg",
  },
  {
    match: (topic) => topic.includes("quack") || topic.includes("duck"),
    handle: () => "quack 🦆",
  },
];

export function getAutocompleteSuggestions(command: string, query: unknown) {
  if (typeof query !== "string") {
    return [];
  }

  const topics = {
    tip: ["mdn", "ns", "codeformat", "strikeformat", "spoilerformat", "longcode"],
    fun: [
      "bleep bloop",
      "bloop bleep",
      "poast coad",
      "psps",
      "congratulations",
      "spam",
      "yuri",
      "zoe",
      "zoë",
      "quack",
      "duck",
    ],
  } as Record<string, string[]>;
  const choices = [];
  for (const topic of topics[command] ?? []) {
    if (!topic.includes(query.toLowerCase())) {
      continue;
    }
    choices.push({
      name: topic,
      value: topic,
    });
  }
  return choices;
}
