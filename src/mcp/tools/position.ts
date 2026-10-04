import { readFile } from "node:fs/promises";

import { z } from "zod";

/**
 * Positions as tools accept them: 1-based like tool output and editors, and either
 * a column or the word to point at. Converted to LSP's 0-based positions here.
 */
export const positionShape = {
  file: z.string(),
  line: z.number().int().positive(),
  symbol: z.string().min(1).optional(),
  occurrence: z.number().int().positive().optional(),
  character: z.number().int().positive().optional(),
};

export const POSITION_HINT =
  'line and character are 1-based, as in tool output and editors. Pass symbol (the word on that line, e.g. "Either") instead of character to point at it; occurrence picks a later match on the same line.';

export interface LspPosition {
  line: number;
  character: number;
}

export type PositionResult =
  | { position: LspPosition }
  | { error: string };

/** Characters that can be part of an identifier, for whole-word symbol matching. */
const IDENTIFIER_CHAR = /[\p{L}\p{N}_$]/u;

/**
 * Resolves `line` plus `symbol` or `character` from tool arguments into an LSP
 * position. Reads the file only when `symbol` is given.
 */
export async function resolvePosition(
  args: Record<string, unknown>,
  filePath: string,
): Promise<PositionResult> {
  const line = toPositiveInt(args.line);
  if (line === null) {
    return { error: "line must be a 1-based line number." };
  }

  const symbol = typeof args.symbol === "string" && args.symbol !== "" ? args.symbol : null;
  if (symbol === null) {
    const character = toPositiveInt(args.character);
    if (character === null) {
      return {
        error: "Pass symbol (the word to point at) or a 1-based character.",
      };
    }

    return { position: { line: line - 1, character: character - 1 } };
  }

  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return { error: `Cannot read ${filePath} to find "${symbol}".` };
  }

  const lines = text.split(/\r?\n/);
  const lineText = lines[line - 1];
  if (lineText === undefined) {
    return {
      error: `Line ${line} is past the end of ${filePath} (${lines.length} lines).`,
    };
  }

  const matches = findOccurrences(lineText, symbol);
  const occurrence = toPositiveInt(args.occurrence) ?? 1;
  const index = matches[occurrence - 1];
  if (index === undefined) {
    const found =
      matches.length === 0
        ? `"${symbol}" is not on line ${line}`
        : `Line ${line} has only ${matches.length} occurrence(s) of "${symbol}"`;
    return { error: `${found}: ${lineText.trim()}` };
  }

  return { position: { line: line - 1, character: index } };
}

/**
 * Start indexes of `symbol` in `text`. Identifier-like symbols only match whole
 * words, so "Either" does not match inside "EitherT".
 */
export function findOccurrences(text: string, symbol: string): number[] {
  const wholeWord = [...symbol].every((char) => IDENTIFIER_CHAR.test(char));
  const matches: number[] = [];
  let from = 0;
  for (;;) {
    const index = text.indexOf(symbol, from);
    if (index === -1) {
      return matches;
    }

    const before = text[index - 1];
    const after = text[index + symbol.length];
    const isWord =
      (before === undefined || !IDENTIFIER_CHAR.test(before)) &&
      (after === undefined || !IDENTIFIER_CHAR.test(after));
    if (!wholeWord || isWord) {
      matches.push(index);
    }

    from = index + 1;
  }
}

/** Converts a 1-based {line, character} pair from tool input into LSP's 0-based form. */
export function toLspPosition(value: { line: number; character: number }): LspPosition {
  return { line: value.line - 1, character: value.character - 1 };
}

function toPositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}
