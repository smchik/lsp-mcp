import { readFile } from "node:fs/promises";

import { uriToPath } from "./uri";

/** Source lines keyed by file URI, for showing the code at result locations. */
export type SourceLines = Map<string, string[]>;

/**
 * Reads the files behind the given URIs. Non-file URIs (e.g. `jar:` entries) and
 * unreadable files are skipped, so their results simply show no source line.
 */
export async function loadSourceLines(uris: Iterable<string>): Promise<SourceLines> {
  const unique = [...new Set(uris)].filter((uri) => uri.startsWith("file:///"));
  const entries = await Promise.all(
    unique.map(async (uri) => {
      try {
        const text = await readFile(uriToPath(uri), "utf8");
        return [uri, text.split(/\r?\n/)] as const;
      } catch {
        return null;
      }
    }),
  );

  return new Map(entries.filter((entry) => entry !== null));
}

/** Longest source line shown next to a result before it is cut with "…". */
export const SOURCE_LINE_MAX_LENGTH = 120;

/** The trimmed source text at a 0-based line, cut to SOURCE_LINE_MAX_LENGTH. */
export function sourceLineAt(
  lines: SourceLines | undefined,
  uri: string,
  line: number,
): string | null {
  const text = lines?.get(uri)?.[line]?.trim();
  if (!text) {
    return null;
  }

  return text.length > SOURCE_LINE_MAX_LENGTH
    ? `${text.slice(0, SOURCE_LINE_MAX_LENGTH - 1)}…`
    : text;
}
