import { EventEmitter } from 'events';
import { execSync } from 'child_process';
import * as pty from 'node-pty';

function resolveShellPath(): string {
  try {
    return execSync('zsh -ilc "echo $PATH"', { encoding: 'utf-8' }).trim();
  } catch {
    return process.env.PATH || '';
  }
}

const shellPath = resolveShellPath();

interface Shell {
  ptyProcess: pty.IPty;
  buffer: string;
}

class ShellManager extends EventEmitter {
  private shells: Map<string, Shell> = new Map();

  createShell(sessionId: string, cwd: string): string {
    if (this.shells.has(sessionId)) {
      return this.shells.get(sessionId)!.buffer;
    }

    const shellBin = process.env.SHELL || 'zsh';

    const ptyProcess = pty.spawn(shellBin, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: { ...process.env, PATH: shellPath, TERM: 'xterm-256color' } as Record<string, string>,
    });

    const shell: Shell = {
      ptyProcess,
      buffer: '',
    };

    ptyProcess.onData((data: string) => {
      shell.buffer += data;
      if (shell.buffer.length > 1024 * 1024) {
        shell.buffer = shell.buffer.slice(-512 * 1024);
      }
      this.emit('output', sessionId, data);
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      this.shells.delete(sessionId);
      this.emit('exit', sessionId, exitCode);
    });

    this.shells.set(sessionId, shell);
    return '';
  }

  write(sessionId: string, data: string): void {
    const shell = this.shells.get(sessionId);
    if (shell) shell.ptyProcess.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const shell = this.shells.get(sessionId);
    if (shell) shell.ptyProcess.resize(cols, rows);
  }

  getBuffer(sessionId: string): string {
    const shell = this.shells.get(sessionId);
    return shell ? shell.buffer : '';
  }

  cdTo(sessionId: string, dir: string): void {
    const shell = this.shells.get(sessionId);
    if (shell) {
      shell.ptyProcess.write(`cd ${dir.replace(/ /g, '\\ ')}\n`);
    }
  }

  hasShell(sessionId: string): boolean {
    return this.shells.has(sessionId);
  }

  killShell(sessionId: string): void {
    const shell = this.shells.get(sessionId);
    if (shell) {
      shell.ptyProcess.kill();
      this.shells.delete(sessionId);
    }
  }

  killAll(): void {
    for (const shell of this.shells.values()) {
      shell.ptyProcess.kill();
    }
    this.shells.clear();
  }
}

export default ShellManager;
