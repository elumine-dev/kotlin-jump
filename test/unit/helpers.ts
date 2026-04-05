import { Position, Range } from './__mocks__/vscode';

const WORD_RE = /[A-Za-z_]\w*/g;

export function mockDocument(uri: string, code: string) {
  const lines = code.split('\n');
  return {
    uri: { toString: () => uri, path: uri.replace('file://', '') },
    languageId: uri.endsWith('.java') ? 'java' : 'kotlin',
    version: 1,
    getText: (range?: any) => {
      if (!range) return code;
      return lines[range.start.line].substring(range.start.character, range.end.character);
    },
    getWordRangeAtPosition: (pos: Position, regex?: RegExp) => {
      const line = lines[pos.line] || '';
      const re = new RegExp((regex || WORD_RE).source, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        if (m.index <= pos.character && pos.character < m.index + m[0].length) {
          return new Range(
            new Position(pos.line, m.index),
            new Position(pos.line, m.index + m[0].length),
          );
        }
      }
      return undefined;
    },
    lineAt: (n: number) => {
      const text = lines[n] ?? '';
      return { text, range: { start: new Position(n, 0), end: new Position(n, text.length) } };
    },
    lineCount: lines.length,
  } as any;
}

/** Find the Position of a word in code (0-indexed line, character at start of word) */
export function positionOf(code: string, word: string, occurrence = 1): Position {
  const lines = code.split('\n');
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    let idx = -1;
    while ((idx = lines[i].indexOf(word, idx + 1)) !== -1) {
      count++;
      if (count === occurrence) return new Position(i, idx);
    }
  }
  throw new Error(`Word "${word}" occurrence ${occurrence} not found`);
}
