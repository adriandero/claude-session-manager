import { EventEmitter } from 'events';
import { execSync, exec } from 'child_process';
import path from 'path';
import * as pty from 'node-pty';
import StateDetector, { SessionState } from './state-detector';

function resolveShellPath(): string {
  try {
    return execSync('zsh -ilc "echo $PATH"', { encoding: 'utf-8' }).trim();
  } catch {
    return process.env.PATH || '';
  }
}

const shellPath = resolveShellPath();

export interface Session {
  id: string;
  name: string;
  cwd: string;
  ptyProcess: pty.IPty;
  status: SessionState;
  buffer: string;
  stateDetector: StateDetector;
  cwdTimer: ReturnType<typeof setInterval> | null;
}

let nextId = 1;

class SessionManager extends EventEmitter {
  sessions: Map<string, Session> = new Map();

  createSession(cwd: string): Session {
    const id = String(nextId++);
    const name = path.basename(cwd);

    const ptyProcess = pty.spawn('claude', [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: { ...process.env, PATH: shellPath, TERM: 'xterm-256color' } as Record<string, string>,
    });

    const stateDetector = new StateDetector((newState: SessionState) => {
      if (newState !== session.status) {
        session.status = newState;
        this.emit('state-change', id, newState);
      }
    });

    const session: Session = {
      id,
      name,
      cwd,
      ptyProcess,
      status: 'idle',
      buffer: '',
      stateDetector,
      cwdTimer: null,
    };

    ptyProcess.onData((data: string) => {
      session.buffer += data;
      // Cap buffer at 1MB to prevent memory issues
      if (session.buffer.length > 1024 * 1024) {
        session.buffer = session.buffer.slice(-512 * 1024);
      }
      this.emit('output', id, data);
      session.stateDetector.feed(data);
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      if (session.cwdTimer) clearInterval(session.cwdTimer);
      session.status = 'done';
      this.emit('state-change', id, 'done');
      this.emit('exit', id, exitCode);
    });

    // Poll the PTY process's cwd to detect worktree switches
    session.cwdTimer = setInterval(() => {
      this.pollCwd(session);
    }, 2000);

    this.sessions.set(id, session);
    return session;
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (session && session.status !== 'done') {
      if (data.includes('\r') || data.includes('\n')) {
        session.stateDetector.markUserInput();
      }
      session.ptyProcess.write(data);
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (session && session.status !== 'done') session.ptyProcess.resize(cols, rows);
  }

  getBuffer(id: string): string {
    const session = this.sessions.get(id);
    return session ? session.buffer : '';
  }

  getSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  private pollCwd(session: Session): void {
    const pid = session.ptyProcess.pid;
    // On macOS, use lsof to get the cwd of the process
    exec(`lsof -a -d cwd -Fn -p ${pid} 2>/dev/null`, (err, stdout) => {
      if (err || !stdout) return;
      // lsof output: lines starting with 'n' contain the path
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.startsWith('n/')) {
          const newCwd = line.slice(1);
          if (newCwd !== session.cwd) {
            const oldCwd = session.cwd;
            session.cwd = newCwd;
            this.emit('cwd-change', session.id, newCwd, oldCwd);
          }
          break;
        }
      }
    });
  }

  killSession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      if (session.cwdTimer) clearInterval(session.cwdTimer);
      session.stateDetector.dispose();
      session.ptyProcess.kill();
      this.sessions.delete(id);
    }
  }

  killAll(): void {
    for (const session of this.sessions.values()) {
      if (session.cwdTimer) clearInterval(session.cwdTimer);
      session.stateDetector.dispose();
      session.ptyProcess.kill();
    }
    this.sessions.clear();
  }
}

export default SessionManager;
