import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { registerReadTools } from '../tools/read-tools';
import type { MinimalLifecycleManager, McpToolResult } from '../tools/shared';
import { pathToUri } from '../../utils/uri';

type Handler = (args: Record<string, unknown>) => Promise<McpToolResult>;

// Exercises position lookup by symbol and source lines against real files.
describe('read tools with source files', () => {
  let root: string;
  let file: string;
  let request: jest.Mock;
  const handlers = new Map<string, Handler>();

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'lsp-mcp-source-'));
    file = path.join(root, 'UseCase.kt');
    await writeFile(file, [
      'import arrow.core.Either',
      '',
      'abstract class UseCase {',
      '    abstract fun execute(): Either<Failure, Unit>',
      '    fun run() = execute()',
      '}'
    ].join('\n'));

    request = jest.fn();
    const client = {
      request,
      notify: jest.fn(),
      getCapabilities: jest.fn(),
      ensureDidOpen: jest.fn(async () => undefined),
      waitForDiagnosticsPublish: jest.fn(),
      ensureSeedFileOpen: jest.fn()
    };
    const lifecycle = {
      getClientForFile: () => client,
      getDiagnosticClientsForFile: () => [client],
      getReadyClients: () => [client],
      getFileDiagnostics: () => [],
      getWorkspaceDiagnostics: () => [],
      getHealth: () => [],
      getRoot: () => root,
      ensureLanguageForFile: async () => undefined,
      ensureSeedFilesOpen: async () => undefined,
      analyzeWorkspace: async () => ({ perLanguage: [] })
    } as unknown as MinimalLifecycleManager;
    registerReadTools(
      { registerTool: (name, _config, handler) => handlers.set(name, handler) },
      lifecycle,
      { initializeManager: jest.fn() }
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const location = (line: number, character: number) => ({
    uri: pathToUri(file),
    range: { start: { line, character }, end: { line, character: character + 1 } }
  });

  it('resolves the symbol on the line and shows the definition source', async () => {
    request.mockResolvedValueOnce([location(3, 17)]);

    const result = await handlers.get('lsp_definition')!({ file, line: 5, symbol: 'execute' });

    expect(request).toHaveBeenLastCalledWith(
      'textDocument/definition',
      { textDocument: { uri: pathToUri(file) }, position: { line: 4, character: 16 } },
      5000
    );
    expect(result.content[0]?.text).toBe([
      'Found 1 definition: `UseCase.kt:4:18`',
      '  abstract fun execute(): Either<Failure, Unit>'
    ].join('\n'));
  });

  it('returns the lookup error without calling the server', async () => {
    request.mockClear();

    const result = await handlers.get('lsp_hover')!({ file, line: 1, symbol: 'Option' });

    expect(request).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      error: true,
      content: [{ text: '"Option" is not on line 1: import arrow.core.Either' }]
    });
  });

  it('shows source lines for references only when context is requested', async () => {
    request.mockResolvedValue([location(4, 16), location(3, 17)]);

    const compact = await handlers.get('lsp_references')!({ file, line: 4, symbol: 'execute' });
    const withContext = await handlers.get('lsp_references')!({ file, line: 4, symbol: 'execute', context: true });

    expect(compact.content[0]?.text).toBe('Found 2 references in 1 file:\n- `UseCase.kt`: 4:18, 5:17');
    expect(withContext.content[0]?.text).toBe([
      'Found 2 references in 1 file:',
      '- `UseCase.kt`',
      '  - 4:18  abstract fun execute(): Either<Failure, Unit>',
      '  - 5:17  fun run() = execute()'
    ].join('\n'));
  });
});
