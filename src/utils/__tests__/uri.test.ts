import { isInProjectBuildDirectory, pathToUri, uriToDisplayPath, uriToPath } from '../uri';

describe('uri utilities', () => {
  it('converts an absolute posix path to a file URI', () => {
    expect(pathToUri('/home/user/foo.ts')).toBe('file:///home/user/foo.ts');
  });

  it('round-trips posix paths with spaces', () => {
    const uri = pathToUri('/home/user/My Project/foo bar.ts');

    expect(uri).toBe('file:///home/user/My%20Project/foo%20bar.ts');
    expect(uriToPath(uri)).toBe('/home/user/My Project/foo bar.ts');
  });

  it('returns file URIs unchanged and rejects relative paths', () => {
    expect(pathToUri('file:///home/user/foo.ts')).toBe('file:///home/user/foo.ts');
    expect(() => pathToUri('src/foo.ts')).toThrow('Expected an absolute file path');
  });

  it('handles windows drive paths in both directions', () => {
    expect(pathToUri('C:\\work\\foo bar.ts')).toBe('file:///C:/work/foo%20bar.ts');
    expect(uriToPath('file:///C:/work/foo%20bar.ts')).toBe('C:\\work\\foo bar.ts');
  });

  it('shortens file URIs under the root and leaves other paths absolute', () => {
    expect(uriToDisplayPath('file:///work/app/src/a.kt', '/work/app')).toBe('src/a.kt');
    expect(uriToDisplayPath('file:///work/app/src/a.kt', '/work/app/')).toBe('src/a.kt');
    expect(uriToDisplayPath('file:///work/app-other/a.kt', '/work/app')).toBe('/work/app-other/a.kt');
    expect(uriToDisplayPath('file:///work/app/src/a.kt')).toBe('/work/app/src/a.kt');
  });

  it('returns non-file URIs unchanged instead of throwing', () => {
    const jarUri = 'jar:///libs/compose-runtime.jar!/androidx/compose/runtime/State.kt';

    expect(uriToDisplayPath(jarUri, '/work/app')).toBe(jarUri);
  });

  it('detects files and archives in build directories inside the root', () => {
    const root = '/work/app';

    expect(isInProjectBuildDirectory('file:///work/app/data/build/generated/ksp/Dao_Impl.kt', root)).toBe(true);
    expect(isInProjectBuildDirectory('jar:///work/app/data/build/intermediates/full.jar!/a/B.class', root)).toBe(true);
    expect(isInProjectBuildDirectory('jar:file:///work/app/data/build/libs/data.jar!/a/B.class', root)).toBe(true);
    expect(isInProjectBuildDirectory('file:///work/app/data/src/main/Repo.kt', root)).toBe(false);
    expect(isInProjectBuildDirectory('file:///work/app/data/src/main/builder/Repo.kt', root)).toBe(false);
    // Libraries outside the project, even in a "build"-named folder, are kept.
    expect(isInProjectBuildDirectory('jar:///home/u/.gradle/caches/build/arrow.jar!/Either.class', root)).toBe(false);
    expect(isInProjectBuildDirectory('file:///work/app/data/build/a.kt')).toBe(false);
  });
});
