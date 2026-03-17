// xterm.js globals loaded via script tags
declare class Terminal {
  cols: number;
  rows: number;
  constructor(options?: Record<string, unknown>);
  loadAddon(addon: unknown): void;
  open(container: HTMLElement): void;
  write(data: string): void;
  clear(): void;
  reset(): void;
  focus(): void;
  dispose(): void;
  onData(callback: (data: string) => void): void;
}

declare namespace FitAddon {
  class FitAddon {
    fit(): void;
  }
}

// Preload API exposed via contextBridge
interface SessionInfo {
  id: string;
  name: string;
  cwd: string;
  status: SessionStatus;
}

type SessionStatus = 'working' | 'needs-input' | 'idle' | 'done';

interface ElectronAPI {
  createSession(): Promise<SessionInfo | null>;
  createSessionWithDir(dir: string): Promise<SessionInfo | null>;
  getRecentDirs(): Promise<string[]>;
  killSession(id: string): Promise<void>;
  listSessions(): Promise<SessionInfo[]>;
  getBuffer(id: string): Promise<string>;
  setActiveSession(id: string): void;
  sendInput(id: string, data: string): void;
  resizeSession(id: string, cols: number, rows: number): void;
  onOutput(callback: (id: string, data: string) => void): void;
  onStateChange(callback: (id: string, state: SessionStatus) => void): void;
  onExit(callback: (id: string, code: number) => void): void;
  onNewSession(callback: () => void): void;
  onSwitchSession(callback: (id: string) => void): void;

  // Companion shell
  createShell(id: string): Promise<string>;
  getShellBuffer(id: string): Promise<string>;
  sendShellInput(id: string, data: string): void;
  resizeShell(id: string, cols: number, rows: number): void;
  onShellOutput(callback: (id: string, data: string) => void): void;
  onShellExit(callback: (id: string, code: number) => void): void;
  onToggleTerminal(callback: () => void): void;
}

interface Window {
  api: ElectronAPI;
}

// TerminalWrapper is declared in terminal.ts and loaded via script tag before app.ts
