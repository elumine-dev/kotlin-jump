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

export class EventEmitter<T> {
  private _listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void) => { this._listeners.push(listener); return { dispose: () => {} }; };
  fire(e: T) { for (const l of this._listeners) l(e); }
  dispose() { this._listeners = []; }
}

export class CodeLens {
  command?: any;
  constructor(public range: Range) {}
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

export class CodeActionKind {
  static readonly SourceOrganizeImports = new CodeActionKind('source.organizeImports');
  static readonly QuickFix              = new CodeActionKind('quickfix');
  static readonly Source                = new CodeActionKind('source');
  constructor(public readonly value: string) {}
  contains(other: CodeActionKind): boolean {
    return other.value === this.value || other.value.startsWith(`${this.value}.`);
  }
  append(part: string): CodeActionKind {
    return new CodeActionKind(`${this.value}.${part}`);
  }
}

export class CodeAction {
  edit?: WorkspaceEdit;
  isPreferred?: boolean;
  constructor(
    public title: string,
    public kind?: CodeActionKind,
  ) {}
}

export enum SymbolKind {
  File = 0,
  Class = 4,
  Method = 5,
  Property = 6,
  Field = 7,
  Enum = 9,
  Interface = 10,
  Function = 11,
  Variable = 12,
  Constant = 13,
  Object = 18,
  EnumMember = 21,
  Struct = 22,
}

export enum SymbolTag {
  Deprecated = 1,
}

export class DocumentSymbol {
  children: DocumentSymbol[] = [];
  tags?: readonly SymbolTag[];
  constructor(
    public name: string,
    public detail: string,
    public kind: SymbolKind,
    public range: Range,
    public selectionRange: Range,
  ) {}
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

export class SymbolInformation {
  constructor(
    public name: string,
    public kind: number,
    public containerName: string,
    public location: any,
  ) {}
}

export class TextEdit {
  constructor(public range: Range, public newText: string) {}
  static replace(range: Range, newText: string): TextEdit { return new TextEdit(range, newText); }
  static insert(position: Position, newText: string): TextEdit { return new TextEdit(new Range(position, position), newText); }
  static delete(range: Range): TextEdit { return new TextEdit(range, ''); }
}

export class WorkspaceEdit {
  private _entries: Array<{ uri: any; range: Range; newText: string }> = [];
  public _fileRenames: Array<{ oldUri: any; newUri: any; options?: any; metadata?: any }> = [];

  replace(uri: any, range: Range, newText: string, _metadata?: any): void {
    this._entries.push({ uri, range, newText });
  }

  set(uri: any, edits: ReadonlyArray<TextEdit | [TextEdit, any]>): void {
    for (const item of edits) {
      if (Array.isArray(item)) {
        const [te] = item as [TextEdit, any];
        this._entries.push({ uri, range: te.range, newText: te.newText });
      } else {
        const te = item as TextEdit;
        this._entries.push({ uri, range: te.range, newText: te.newText });
      }
    }
  }

  renameFile(oldUri: any, newUri: any, options?: any, metadata?: any): void {
    this._fileRenames.push({ oldUri, newUri, options, metadata });
  }

  entries(): Array<{ uri: any; range: Range; newText: string }> { return this._entries; }
  get size(): number { return this._entries.length; }
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
