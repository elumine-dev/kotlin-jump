export class Position {
  constructor(public line: number, public character: number) {}
  isEqual(other: Position) { return this.line === other.line && this.character === other.character; }
  translate(dl: number, dc: number) { return new Position(this.line + dl, this.character + dc); }
}

export class Range {
  public start: Position;
  public end: Position;
  constructor(startOrLine: Position | number, endOrChar: Position | number, endLine?: number, endChar?: number) {
    if (typeof startOrLine === 'number') {
      this.start = new Position(startOrLine, endOrChar as number);
      this.end = new Position(endLine ?? startOrLine, endChar ?? (endOrChar as number));
    } else {
      this.start = startOrLine;
      this.end = endOrChar as Position;
    }
  }
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

export class TypeHierarchyItem {
  constructor(
    public kind: number,
    public name: string,
    public detail: string,
    public uri: any,
    public range: Range,
    public selectionRange: Range,
  ) {}
}

export enum SymbolKind {
  Class = 4,
  Interface = 10,
  Enum = 9,
  Object = 18,
}

export class CallHierarchyItem {
  data?: any;
  constructor(
    public kind: number,
    public name: string,
    public detail: string,
    public uri: any,
    public range: Range,
    public selectionRange: Range,
  ) {}
}

export class CallHierarchyIncomingCall {
  constructor(public from: CallHierarchyItem, public fromRanges: Range[]) {}
}

export class CallHierarchyOutgoingCall {
  constructor(public to: CallHierarchyItem, public fromRanges: Range[]) {}
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
