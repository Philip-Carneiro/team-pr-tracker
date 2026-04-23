export const window = {
  showInformationMessage: async (..._args: unknown[]) => undefined,
  showWarningMessage: async (..._args: unknown[]) => undefined,
  showErrorMessage: async (..._args: unknown[]) => undefined,
  showInputBox: async (..._args: unknown[]) => undefined,
  showQuickPick: async (..._args: unknown[]) => undefined,
  createTreeView: (..._args: unknown[]) => ({
    dispose: () => {},
  }),
};

export const env = {
  openExternal: async (..._args: unknown[]) => true,
};

export const Uri = {
  parse: (value: string) => ({ toString: () => value }),
};

export const workspace = {
  getConfiguration: () => ({
    get: (key: string, defaultValue: unknown) => defaultValue,
  }),
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
};

export const commands = {
  registerCommand: (_command: string, _callback: (...args: unknown[]) => unknown) => ({
    dispose: () => {},
  }),
  executeCommand: async (..._args: unknown[]) => {},
};

export class EventEmitter {
  event = () => ({ dispose: () => {} });
  fire() {}
  dispose() {}
}

export class TreeItem {
  label?: string;
  description?: string;
  tooltip?: unknown;
  iconPath?: unknown;
  contextValue?: string;
  command?: unknown;
  collapsibleState?: number;

  constructor(label: string, collapsibleState?: number) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

export class ThemeIcon {
  constructor(
    public id: string,
    public color?: unknown,
  ) {}
}

export class ThemeColor {
  constructor(public id: string) {}
}

export class MarkdownString {
  value: string;
  constructor(value?: string) {
    this.value = value ?? '';
  }
}

export const QuickPickItemKind = {
  Separator: -1,
  Default: 0,
};
