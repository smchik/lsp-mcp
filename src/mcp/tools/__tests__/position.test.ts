import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { findOccurrences, resolvePosition } from '../position';

describe('position resolution', () => {
  let dir: string;
  let file: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'lsp-mcp-position-'));
    file = path.join(dir, 'UseCase.kt');
    await writeFile(file, [
      'package demo',
      '',
      'import arrow.core.Either',
      'fun f(): Either<Failure, Either<Failure, EitherT>> = TODO()'
    ].join('\n'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('converts 1-based line and character to an LSP position', async () => {
    await expect(resolvePosition({ line: 3, character: 19 }, file))
      .resolves.toEqual({ position: { line: 2, character: 18 } });
  });

  it('points at a symbol on the line instead of a column', async () => {
    await expect(resolvePosition({ line: 3, symbol: 'Either' }, file))
      .resolves.toEqual({ position: { line: 2, character: 18 } });
    await expect(resolvePosition({ line: 4, symbol: 'Either', occurrence: 2 }, file))
      .resolves.toEqual({ position: { line: 3, character: 25 } });
  });

  it('matches identifiers as whole words only', () => {
    expect(findOccurrences('Either<Failure, EitherT>', 'Either')).toEqual([0]);
    expect(findOccurrences('a?.let { it }', '?.')).toEqual([1]);
  });

  it('explains why a symbol could not be resolved', async () => {
    await expect(resolvePosition({ line: 3, symbol: 'core.Option' }, file))
      .resolves.toEqual({ error: '"core.Option" is not on line 3: import arrow.core.Either' });
    await expect(resolvePosition({ line: 3, symbol: 'Either', occurrence: 2 }, file))
      .resolves.toEqual({ error: 'Line 3 has only 1 occurrence(s) of "Either": import arrow.core.Either' });
    await expect(resolvePosition({ line: 9, symbol: 'Either' }, file))
      .resolves.toEqual({ error: `Line 9 is past the end of ${file} (4 lines).` });
  });

  it('requires a 1-based line and either symbol or character', async () => {
    await expect(resolvePosition({ line: 0, character: 1 }, file))
      .resolves.toEqual({ error: 'line must be a 1-based line number.' });
    await expect(resolvePosition({ line: 3 }, file))
      .resolves.toEqual({ error: 'Pass symbol (the word to point at) or a 1-based character.' });
  });
});
