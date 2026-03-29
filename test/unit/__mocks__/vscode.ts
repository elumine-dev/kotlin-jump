export class Position {
  constructor(public line: number, public character: number) {}
  isEqual(other: Position) { return this.line === other.line && this.character === other.character; }
  translate(dl: number, dc: number) { return new Position(this.line + dl, this.character + dc); }
}

export class Range {
  constructor(public start: Position, public end: Position) {}
}

export class Location {
  constructor(public uri: any, public range: Range | Position) {}
}

export class MarkdownString {
  value = '';
  appendCodeblock(code: string) { this.value += code; return this; }
  appendMarkdown(md: string) { this.value += md; return this; }
}

export class Hover {
  constructor(public contents: MarkdownString[], public range?: Range) {}
}

export const Uri = {
  parse: (s: string) => ({
    toString: () => s,
    path: s.replace(/^file:\/\//, ''),
    fsPath: s.replace(/^file:\/\//, ''),
    scheme: 'file',
  }),
};

export const workspace = {
  getConfiguration: () => ({
    get: (key: string, defaultVal: any) => defaultVal,
  }),
  openTextDocument: async () => null,
  findFiles: async () => [] as any[],
  fs: {
    readFile: async () => Buffer.from(''),
  },
};

export const window = {
  activeTextEditor: undefined,
};

export const commands = {
  executeCommand: async () => {},
};
