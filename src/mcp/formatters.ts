import type {
  CompletionItem,
  Diagnostic,
  DocumentSymbol,
  Hover,
  Location,
  SymbolInformation,
} from "vscode-languageserver-protocol";

type MarkedString = string | { language: string; value: string };

import type { LanguageServerHealth } from "../lsp/lifecycle-manager";

import { sourceLineAt, type SourceLines } from "../utils/source-lines";
import { isInProjectBuildDirectory, uriToDisplayPath } from "../utils/uri";

type DiagnosticWithUri = Diagnostic & { uri?: string };

const SYMBOL_KIND_ICONS: Record<number, string> = {
  1: "📄",
  2: "📦",
  3: "🔖",
  4: "🧩",
  5: "📦",
  6: "🔧",
  7: "🏗️",
  8: "🧠",
  9: "📐",
  10: "📚",
  11: "🔌",
  12: "ƒ",
  13: "≡",
  14: "🔒",
  15: "📝",
  16: "№",
  17: "🧮",
  18: "📏",
  19: "🧱",
  20: "🔑",
  21: "❌",
  22: "🧩",
  23: "➡️",
  24: "🎯",
  25: "📦",
  26: "🔎",
};

const COMPLETION_KIND_LABELS: Record<number, string> = {
  2: "Methods",
  3: "Functions",
  4: "Constructors",
  5: "Fields",
  6: "Variables",
  7: "Classes",
  8: "Interfaces",
  9: "Modules",
  10: "Properties",
  11: "Units",
  12: "Values",
  13: "Enums",
  14: "Keywords",
  15: "Snippets",
  16: "Colors",
  17: "Files",
  18: "References",
  19: "Folders",
  20: "Enum members",
  21: "Constants",
  22: "Structs",
  23: "Events",
  24: "Operators",
  25: "Type parameters",
};

const DIAGNOSTIC_SEVERITY_LABELS: Record<number, string> = {
  1: "Errors",
  2: "Warnings",
  3: "Information",
  4: "Hints",
};

/** Hover text longer than this is cut, so a huge KDoc can't flood the context. */
export const HOVER_MAX_LENGTH = 4000;

/**
 * Returns the server's hover markdown as-is (signature code block plus the full
 * documentation), trimmed and capped at HOVER_MAX_LENGTH characters.
 */
export function formatHover(result: Hover | null): string {
  if (!result) {
    return "No result";
  }

  const text = hoverContentsToText(result.contents).trim();
  if (!text) {
    return "No result";
  }

  if (text.length <= HOVER_MAX_LENGTH) {
    return text;
  }

  const cut = text.slice(0, HOVER_MAX_LENGTH);
  // Close a code block left open by the cut so the rest renders as text.
  const openFence = (cut.match(/```/g)?.length ?? 0) % 2 === 1 ? "\n```" : "";
  return `${cut}${openFence}\n\n(Truncated: showing ${HOVER_MAX_LENGTH} of ${text.length} characters.)`;
}

/**
 * Formats definition-style results. With `lines`, the source line at each location
 * is shown under it, since these results are few and that line is usually what
 * the caller wants to see next.
 */
export function formatDefinition(
  locations: Location[] | null,
  root?: string | null,
  noun = "definition",
  lines?: SourceLines,
): string {
  if (!locations || locations.length === 0) {
    return "No result";
  }

  const withSource = (location: Location, indent: string): string[] => {
    const source = sourceLineAt(lines, location.uri, location.range.start.line);
    return source ? [`${indent}${source}`] : [];
  };

  if (locations.length === 1) {
    return [
      `Found 1 ${noun}: \`${formatLocation(locations[0], root)}\``,
      ...withSource(locations[0], "  "),
    ].join("\n");
  }

  return [
    `Found ${noun}s:`,
    ...locations.flatMap((location) => [
      `- \`${formatLocation(location, root)}\``,
      ...withSource(location, "  "),
    ]),
  ].join("\n");
}

/** Options for tools that can return long location lists. */
export interface ListOptions {
  /** Project root; paths under it are shown relative to it. */
  root?: string | null;
  /** Keep only results whose displayed path contains this text. */
  path?: string;
  limit?: number;
  offset?: number;
  /** Show each result's source line, one result per line. */
  context?: boolean;
  /** Source of the files on the current page; needed for `context`. */
  lines?: SourceLines;
}

export interface ListPage<T> {
  items: T[];
  /** Results left after dropping build output and applying the path filter. */
  total: number;
  /** Distinct files among those `total` results. */
  files: number;
  /** Results left after dropping build output, before the path filter. */
  unfiltered: number;
  /** Results dropped because they live in a build directory of the project. */
  hidden: number;
  offset: number;
}

/**
 * Drops results from the project's build directories (compiled jars and
 * generated code that duplicate the sources), filters by path, sorts by path then
 * position (servers return results in no stable order, which would make offsets
 * meaningless), and cuts one page.
 */
export function selectPage<T>(
  items: T[],
  locationOf: (item: T) => Location,
  options: ListOptions,
  defaultLimit: number,
): ListPage<T> {
  const keyed = items
    .map((item) => ({ item, location: locationOf(item) }))
    .filter((entry) => !isInProjectBuildDirectory(entry.location.uri, options.root))
    .map((entry) => ({
      ...entry,
      path: uriToDisplayPath(entry.location.uri, options.root),
    }));
  const filtered = options.path
    ? keyed.filter((entry) => entry.path.includes(options.path ?? ""))
    : keyed;
  filtered.sort(
    (left, right) =>
      compareStrings(left.path, right.path) ||
      left.location.range.start.line - right.location.range.start.line ||
      left.location.range.start.character - right.location.range.start.character,
  );

  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = Math.max(1, Math.floor(options.limit ?? defaultLimit));
  return {
    items: filtered.slice(offset, offset + limit).map((entry) => entry.item),
    total: filtered.length,
    files: new Set(filtered.map((entry) => entry.path)).size,
    unfiltered: keyed.length,
    hidden: items.length - keyed.length,
    offset,
  };
}

export const DEFAULT_LOCATION_LIMIT = 200;
export const DEFAULT_SYMBOL_LIMIT = 100;
/** Default page size when source lines are shown, since each result takes a line. */
export const DEFAULT_CONTEXT_LIMIT = 50;

/** The default page size for a list, smaller when source lines are shown. */
export function defaultLimitFor(options: ListOptions, base: number): number {
  return options.context ? Math.min(base, DEFAULT_CONTEXT_LIMIT) : base;
}

/**
 * Formats locations grouped by file, so each path is printed once:
 * "- `src/a.kt`: 3:19, 15:50".
 */
export function formatLocationList(
  locations: Location[] | null,
  noun: string,
  options: ListOptions = {},
): string {
  if (!locations || locations.length === 0) {
    return "No result";
  }

  const page = selectPage(
    locations,
    (location) => location,
    options,
    defaultLimitFor(options, DEFAULT_LOCATION_LIMIT),
  );
  if (page.total === 0) {
    return emptyListMessage(noun, page, options);
  }

  const groups = groupByPath(page.items, (location) => location, options.root);
  const lines = [listHeader(noun, page, options)];
  for (const [path, entries] of groups) {
    if (options.context) {
      lines.push(`- \`${path}\``, ...formatSourceEntries(entries, options.lines));
      continue;
    }

    const positions = entries
      .map(
        (location) =>
          `${location.range.start.line + 1}:${location.range.start.character + 1}`,
      )
      .join(", ");
    lines.push(`- \`${path}\`: ${positions}`);
  }

  return appendPageFooter(lines, page).join("\n");
}

/**
 * One line per location: the position, padded so the code lines up, then the
 * source text at it (when the file could be read).
 */
function formatSourceEntries(entries: Location[], lines?: SourceLines): string[] {
  const positions = entries.map(
    (location) =>
      `${location.range.start.line + 1}:${location.range.start.character + 1}`,
  );
  const width = Math.max(...positions.map((position) => position.length));
  return entries.map((location, index) => {
    const source = sourceLineAt(lines, location.uri, location.range.start.line);
    const position = positions[index] ?? "";
    return source
      ? `  - ${position.padEnd(width)}  ${source}`
      : `  - ${position}`;
  });
}

export function formatReferences(
  locations: Location[] | null,
  options: ListOptions = {},
): string {
  return formatLocationList(locations, "reference", options);
}

/** Formats workspace symbols grouped by file, one symbol per line. */
export function formatWorkspaceSymbols(
  symbols: SymbolInformation[] | null,
  options: ListOptions = {},
): string {
  if (!symbols || symbols.length === 0) {
    return "No result";
  }

  const page = selectPage(
    symbols,
    (symbol) => symbol.location,
    options,
    DEFAULT_SYMBOL_LIMIT,
  );
  if (page.total === 0) {
    return emptyListMessage("symbol", page, options);
  }

  const groups = groupByPath(page.items, (symbol) => symbol.location, options.root);
  const lines = [listHeader("symbol", page, options)];
  for (const [path, entries] of groups) {
    lines.push(`- \`${path}\``);
    for (const symbol of entries) {
      const icon = SYMBOL_KIND_ICONS[symbol.kind] ?? "•";
      const start = symbol.location.range.start;
      lines.push(
        `  - ${icon} \`${symbol.name}\` ${start.line + 1}:${start.character + 1}`,
      );
    }
  }

  return appendPageFooter(lines, page).join("\n");
}

function listHeader<T>(noun: string, page: ListPage<T>, options: ListOptions): string {
  const filter = options.path
    ? ` matching path "${options.path}" (${page.unfiltered} in total)`
    : "";
  return `Found ${plural(page.total, noun)} in ${plural(page.files, "file")}${filter}:`;
}

function emptyListMessage<T>(
  noun: string,
  page: ListPage<T>,
  options: ListOptions,
): string {
  const message =
    options.path && page.unfiltered > 0
      ? `No ${noun}s matching path "${options.path}" (${page.unfiltered} in total)`
      : `No ${noun}s outside build directories`;
  return `${message}${hiddenNote(page)}`;
}

function appendPageFooter<T>(lines: string[], page: ListPage<T>): string[] {
  const end = page.offset + page.items.length;
  const footer: string[] = [];
  if (page.items.length === 0) {
    footer.push(`No results at offset ${page.offset}; there are ${page.total} in total.`);
  } else if (page.offset > 0 || end < page.total) {
    const more = end < page.total ? ` Pass offset: ${end} for more.` : "";
    footer.push(`Showing ${page.offset + 1}–${end} of ${page.total}.${more}`);
  }

  if (page.hidden > 0) {
    footer.push(`Hidden: ${plural(page.hidden, "result")} from build directories.`);
  }

  return footer.length === 0 ? lines : [...lines, "", ...footer];
}

function hiddenNote<T>(page: ListPage<T>): string {
  return page.hidden > 0 ? ` (${page.hidden} hidden in build directories)` : "";
}

function groupByPath<T>(
  items: T[],
  locationOf: (item: T) => Location,
  root?: string | null,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const path = uriToDisplayPath(locationOf(item).uri, root);
    const bucket = groups.get(path) ?? [];
    bucket.push(item);
    groups.set(path, bucket);
  }

  return groups;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Nesting levels of document symbols shown (e.g. class › member › local). */
export const DOCUMENT_SYMBOL_MAX_DEPTH = 3;

/**
 * Formats document symbols with the 1-based position of their name, so the line
 * can be passed straight to other tools, and their members indented below them.
 */
export function formatSymbols(
  symbols: Array<DocumentSymbol | SymbolInformation> | null,
  root?: string | null,
): string {
  if (!symbols || symbols.length === 0) {
    return "No result";
  }

  const lines: string[] = [];
  const visit = (symbol: DocumentSymbol | SymbolInformation, depth: number): void => {
    const icon = SYMBOL_KIND_ICONS[symbol.kind] ?? "•";
    const indent = "  ".repeat(depth);
    if ("location" in symbol) {
      lines.push(`${indent}- ${icon} \`${symbol.name}\` — ${formatLocation(symbol.location, root)}`);
      return;
    }

    const start = symbol.selectionRange.start;
    lines.push(`${indent}- ${icon} \`${symbol.name}\` ${start.line + 1}:${start.character + 1}`);
    if (depth + 1 < DOCUMENT_SYMBOL_MAX_DEPTH) {
      for (const child of symbol.children ?? []) {
        visit(child, depth + 1);
      }
    }
  };
  for (const symbol of symbols) {
    visit(symbol, 0);
  }

  return lines.join("\n");
}

export function formatDiagnostics(
  diagnostics: DiagnosticWithUri[] | null,
  scope: "file" | "workspace",
  root?: string | null,
): string {
  if (!diagnostics || diagnostics.length === 0) {
    return scope === "workspace"
      ? "No diagnostics found in workspace"
      : "No diagnostics found";
  }

  const grouped = new Map<number, DiagnosticWithUri[]>();
  const ordered = [...diagnostics].sort(
    (left, right) => (left.severity ?? 4) - (right.severity ?? 4),
  );
  for (const diagnostic of ordered) {
    const severity = diagnostic.severity ?? 4;
    const bucket = grouped.get(severity) ?? [];
    bucket.push(diagnostic);
    grouped.set(severity, bucket);
  }

  const lines = [
    `${scope === "workspace" ? "Workspace" : "File"} diagnostics: ${diagnostics.length} issue(s)`,
  ];
  for (const severity of [1, 2, 3, 4]) {
    const bucket = grouped.get(severity);
    if (!bucket || bucket.length === 0) {
      continue;
    }

    lines.push("", `### ${DIAGNOSTIC_SEVERITY_LABELS[severity]}`);
    for (const diagnostic of bucket) {
      lines.push(`- ${formatDiagnostic(diagnostic, root)}`);
    }
  }

  return lines.join("\n");
}

export function formatCompletion(items: CompletionItem[] | null): string {
  if (!items || items.length === 0) {
    return "No result";
  }

  const limited = items.slice(0, 50);
  const grouped = new Map<string, CompletionItem[]>();
  for (const item of limited) {
    const label = COMPLETION_KIND_LABELS[item.kind ?? 1] ?? "Other";
    const bucket = grouped.get(label) ?? [];
    bucket.push(item);
    grouped.set(label, bucket);
  }

  const lines = [
    `Showing ${limited.length} of ${items.length} completion item(s)`,
  ];
  for (const [label, bucket] of grouped.entries()) {
    lines.push("", `### ${label}`);
    for (const item of bucket) {
      lines.push(
        `- \`${item.label}\`${item.detail ? ` — ${item.detail}` : ""}`,
      );
    }
  }

  return lines.join("\n");
}

export function formatHealth(healths: LanguageServerHealth[]): string {
  if (healths.length === 0) {
    return "No result";
  }

  return [
    "| Language | Status | Error |",
    "| --- | --- | --- |",
    ...healths.map(
      (health) =>
        `| ${health.language} | ${health.status} | ${health.error ?? ""} |`,
    ),
  ].join("\n");
}

export function formatError(error: unknown): {
  error: true;
  text: string;
  raw: unknown;
} {
  return {
    error: true,
    text: error instanceof Error ? error.message : String(error),
    raw: error,
  };
}

function hoverContentsToText(contents: Hover["contents"]): string {
  if (typeof contents === "string") {
    return contents;
  }

  if (Array.isArray(contents)) {
    return contents.map(markedStringToText).join("\n\n");
  }

  if ("kind" in contents) {
    return contents.value;
  }

  return markedStringToText(contents);
}

function markedStringToText(value: MarkedString): string {
  return typeof value === "string"
    ? value
    : `\`\`\`${value.language}\n${value.value}\n\`\`\``;
}

function formatLocation(location: Location, root?: string | null): string {
  return `${uriToDisplayPath(location.uri, root)}:${location.range.start.line + 1}:${location.range.start.character + 1}`;
}

function formatDiagnostic(
  diagnostic: DiagnosticWithUri,
  root?: string | null,
): string {
  const location = diagnostic.uri
    ? `\`${uriToDisplayPath(diagnostic.uri, root)}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}\` `
    : "";
  const source = diagnostic.source ? `${diagnostic.source}: ` : "";
  return `${location}${source}${diagnostic.message}`.trim();
}
