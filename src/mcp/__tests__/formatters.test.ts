import {
  formatCompletion,
  formatDefinition,
  formatDiagnostics,
  formatError,
  formatHealth,
  formatHover,
  formatLocationList,
  formatReferences,
  formatWorkspaceSymbols,
  formatSymbols
} from '../formatters';

import type { CompletionItem } from 'vscode-languageserver-protocol';

describe('mcp formatters', () => {
  it('returns the full hover markdown', () => {
    expect(formatHover({
      contents: {
        kind: 'markdown',
        value: '```ts\ntype Foo = string\n```\n\nFoo description\n\nSecond paragraph\n'
      }
    })).toBe('```ts\ntype Foo = string\n```\n\nFoo description\n\nSecond paragraph');
  });

  it('caps long hover text and closes an open code block', () => {
    const text = formatHover({
      contents: { kind: 'markdown', value: '```kotlin\n' + 'x'.repeat(5000) + '\n```' }
    });

    expect(text).toContain('\n```\n\n(Truncated: showing 4000 of');
    expect(text.length).toBeLessThan(4100);
  });

  it('formats definition locations with file coordinates', () => {
    expect(formatDefinition([
      {
        uri: 'file:///workspace/src/index.ts',
        range: {
          start: { line: 41, character: 4 },
          end: { line: 41, character: 7 }
        }
      }
    ])).toBe('Found 1 definition: `/workspace/src/index.ts:42:5`');
  });

  it('shows definitions relative to the root and keeps library URIs', () => {
    const range = { start: { line: 4, character: 10 }, end: { line: 4, character: 19 } };

    expect(formatDefinition([
      { uri: 'file:///workspace/domain/Analytics.kt', range },
      { uri: 'jar:///libs/koin-compose.jar!/org/koin/compose/KoinApplication.kt', range }
    ], '/workspace')).toBe([
      'Found definitions:',
      '- `domain/Analytics.kt:5:11`',
      '- `jar:///libs/koin-compose.jar!/org/koin/compose/KoinApplication.kt:5:11`'
    ].join('\n'));
  });

  it('formats references as a bulleted list', () => {
    expect(formatReferences([
      {
        uri: 'file:///workspace/src/index.ts',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 }
        }
      },
      {
        uri: 'file:///workspace/src/lib.ts',
        range: {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 4 }
        }
      }
    ])).toBe('Found 2 references in 2 files:\n- `/workspace/src/index.ts`: 1:1\n- `/workspace/src/lib.ts`: 3:4');
  });

  describe('source lines', () => {
    const uri = 'file:///workspace/domain/UseCase.kt';
    const lines = new Map([[uri, [
      'package demo',
      'abstract class UseCase<in Params, out Type> {',
      '    protected abstract suspend fun execute(params: Params): Either<Failure, Type>',
      '    val long = "' + 'x'.repeat(200) + '"'
    ]]]);
    const at = (line: number, character: number) => ({
      uri,
      range: { start: { line, character }, end: { line, character: character + 1 } }
    });

    it('shows the source line under a definition', () => {
      expect(formatDefinition([at(2, 35)], '/workspace', 'definition', lines)).toBe([
        'Found 1 definition: `domain/UseCase.kt:3:36`',
        '  protected abstract suspend fun execute(params: Params): Either<Failure, Type>'
      ].join('\n'));
    });

    it('lists one result per line with its source when context is on', () => {
      const text = formatReferences([at(3, 8), at(1, 15), { ...at(0, 0), uri: 'jar:///lib.jar!/A.class' }], {
        root: '/workspace',
        context: true,
        lines
      });

      expect(text).toBe([
        'Found 3 references in 2 files:',
        '- `domain/UseCase.kt`',
        '  - 2:16  abstract class UseCase<in Params, out Type> {',
        '  - 4:9   val long = "' + 'x'.repeat(107) + '…',
        '- `jar:///lib.jar!/A.class`',
        '  - 1:1'
      ].join('\n'));
    });
  });

  it('shows document symbol positions and nests members', () => {
    const range = (line: number, character: number) => ({
      start: { line, character },
      end: { line, character: character + 1 }
    });

    expect(formatSymbols([
      {
        name: 'OfficesViewModel',
        kind: 5,
        range: range(21, 0),
        selectionRange: range(21, 6),
        children: [
          { name: 'fetchOffices', kind: 6, range: range(39, 4), selectionRange: range(39, 8), children: [
            { name: 'result', kind: 13, range: range(40, 8), selectionRange: range(40, 12), children: [
              { name: 'tooDeep', kind: 13, range: range(41, 8), selectionRange: range(41, 12) }
            ] }
          ] }
        ]
      }
    ])).toBe([
      '- 📦 `OfficesViewModel` 22:7',
      '  - 🔧 `fetchOffices` 40:9',
      '    - ≡ `result` 41:13'
    ].join('\n'));
  });

  describe('location lists', () => {
    const at = (file: string, line: number, character = 0) => ({
      uri: `file:///workspace/${file}`,
      range: { start: { line, character }, end: { line, character: character + 1 } }
    });
    // Deliberately out of order, as servers return them.
    const locations = [
      at('domain/b.kt', 9, 4),
      at('data/repo.kt', 2),
      at('domain/a.kt', 0),
      at('domain/b.kt', 1, 2),
      at('data/repo.kt', 7)
    ];

    it('groups by file, sorts, and shows paths relative to the root', () => {
      expect(formatReferences(locations, { root: '/workspace' })).toBe([
        'Found 5 references in 3 files:',
        '- `data/repo.kt`: 3:1, 8:1',
        '- `domain/a.kt`: 1:1',
        '- `domain/b.kt`: 2:3, 10:5'
      ].join('\n'));
    });

    it('filters by path and reports the unfiltered total', () => {
      expect(formatReferences(locations, { root: '/workspace', path: 'domain/' })).toBe([
        'Found 3 references in 2 files matching path "domain/" (5 in total):',
        '- `domain/a.kt`: 1:1',
        '- `domain/b.kt`: 2:3, 10:5'
      ].join('\n'));
      expect(formatReferences(locations, { root: '/workspace', path: 'presentation/' }))
        .toBe('No references matching path "presentation/" (5 in total)');
    });

    it('pages through the sorted results with a footer', () => {
      expect(formatLocationList(locations, 'implementation', { root: '/workspace', limit: 2 })).toBe([
        'Found 5 implementations in 3 files:',
        '- `data/repo.kt`: 3:1, 8:1',
        '',
        'Showing 1–2 of 5. Pass offset: 2 for more.'
      ].join('\n'));
      expect(formatLocationList(locations, 'implementation', { root: '/workspace', limit: 2, offset: 4 })).toBe([
        'Found 5 implementations in 3 files:',
        '- `domain/b.kt`: 10:5',
        '',
        'Showing 5–5 of 5.'
      ].join('\n'));
      expect(formatLocationList(locations, 'implementation', { offset: 10 }))
        .toContain('No results at offset 10; there are 5 in total.');
    });

    it('hides results from build directories of the project and says so', () => {
      const withBuild = [
        at('data/src/Repo.kt', 3),
        { uri: 'jar:///workspace/data/build/intermediates/full.jar!/Repo.class', range: at('x', 5).range },
        at('data/build/generated/ksp/Repo_Impl.kt', 8),
        { uri: 'jar:///home/u/.gradle/caches/arrow.jar!/arrow/core/Either.class', range: at('x', 5).range }
      ];

      expect(formatReferences(withBuild, { root: '/workspace' })).toBe([
        'Found 2 references in 2 files:',
        '- `data/src/Repo.kt`: 4:1',
        '- `jar:///home/u/.gradle/caches/arrow.jar!/arrow/core/Either.class`: 6:1',
        '',
        'Hidden: 2 results from build directories.'
      ].join('\n'));
      expect(formatReferences([withBuild[2]], { root: '/workspace' }))
        .toBe('No references outside build directories (1 hidden in build directories)');
    });

    it('groups workspace symbols by file', () => {
      expect(formatWorkspaceSymbols([
        { name: 'UserRepositoryImpl', kind: 5, location: at('data/UserRepositoryImpl.kt', 20, 6) },
        { name: 'UserRepository', kind: 11, location: at('domain/UserRepository.kt', 5, 10) },
        { name: 'removeAccount', kind: 6, location: at('data/UserRepositoryImpl.kt', 40, 4) }
      ], { root: '/workspace', path: 'data/' })).toBe([
        'Found 2 symbols in 1 file matching path "data/" (3 in total):',
        '- `data/UserRepositoryImpl.kt`',
        '  - 📦 `UserRepositoryImpl` 21:7',
        '  - 🔧 `removeAccount` 41:5'
      ].join('\n'));
    });
  });

  it('formats symbols with kind icons', () => {
    expect(formatSymbols([
      {
        name: 'UserService',
        kind: 5,
        location: {
          uri: 'file:///workspace/src/user-service.ts',
          range: {
            start: { line: 4, character: 0 },
            end: { line: 10, character: 0 }
          }
        }
      },
      {
        name: 'login',
        kind: 12,
        location: {
          uri: 'file:///workspace/src/user-service.ts',
          range: {
            start: { line: 6, character: 2 },
            end: { line: 8, character: 0 }
          }
        }
      }
    ])).toContain('- 📦 `UserService` — /workspace/src/user-service.ts:5:1');
  });

  it('formats diagnostics grouped by severity with errors first', () => {
    expect(formatDiagnostics([
      {
        message: 'Cannot find name Foo',
        severity: 1,
        source: 'ts',
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 3 }
        },
        uri: 'file:///workspace/src/index.ts'
      },
      {
        message: 'Unused variable',
        severity: 2,
        source: 'ts',
        range: {
          start: { line: 3, character: 2 },
          end: { line: 3, character: 5 }
        },
        uri: 'file:///workspace/src/index.ts'
      }
    ], 'workspace')).toBe([
      'Workspace diagnostics: 2 issue(s)',
      '',
      '### Errors',
      '- `/workspace/src/index.ts:2:1` ts: Cannot find name Foo',
      '',
      '### Warnings',
      '- `/workspace/src/index.ts:4:3` ts: Unused variable'
    ].join('\n'));
  });

  it('formats completion items grouped by kind and limited to 50', () => {
    const items: CompletionItem[] = Array.from({ length: 55 }, (_, index) => ({
      label: `item-${index}`,
      kind: index < 30 ? 3 : 2,
      detail: index === 0 ? 'string' : undefined
    }));

    const text = formatCompletion(items);

    expect(text).toContain('Showing 50 of 55 completion item(s)');
    expect(text).toContain('### Functions');
    expect(text).toContain('- `item-0` — string');
    expect(text).toContain('### Methods');
    expect(text).not.toContain('item-54');
  });

  it('formats health rows as a markdown table', () => {
    expect(formatHealth([
      { language: 'typescript', status: 'ready' },
      { language: 'python', status: 'error', error: 'spawn failed' }
    ])).toBe([
      '| Language | Status | Error |',
      '| --- | --- | --- |',
      '| typescript | ready |  |',
      '| python | error | spawn failed |'
    ].join('\n'));
  });

  it('formats errors with raw payload passthrough', () => {
    expect(formatError(new Error('boom'))).toEqual({
      error: true,
      text: 'boom',
      raw: expect.any(Error)
    });
  });

  it('returns no result for empty formatter inputs', () => {
    expect(formatHover(null)).toBe('No result');
    expect(formatDefinition(null)).toBe('No result');
    expect(formatReferences([])).toBe('No result');
    expect(formatSymbols(null)).toBe('No result');
    expect(formatDiagnostics([], 'file')).toBe('No diagnostics found');
    expect(formatCompletion(null)).toBe('No result');
    expect(formatHealth([])).toBe('No result');
  });

  it('formats multi-definition and string hover fallbacks', () => {
    expect(formatHover({ contents: 'Plain hover text' })).toBe('Plain hover text');
    expect(formatDefinition([
      {
        uri: 'file:///workspace/src/a.ts',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }
      },
      {
        uri: 'file:///workspace/src/b.ts',
        range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } }
      }
    ])).toContain('Found definitions:');
  });
});
