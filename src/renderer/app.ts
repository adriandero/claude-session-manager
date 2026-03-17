let claudeTerminal: TerminalWrapper;
let shellTerminal: TerminalWrapper;
let activeSessionId: string | null = null;
let activeTab: 'claude' | 'shell' = 'claude';
const sessions = new Map<string, SessionInfo>();
const shellCreated = new Set<string>();

document.addEventListener('DOMContentLoaded', () => {
  const terminalPanel = document.getElementById('terminal-panel')!;
  const shellPanel = document.getElementById('shell-panel')!;
  const terminalTabs = document.getElementById('terminal-tabs')!;
  const emptyState = document.getElementById('empty-state')!;

  claudeTerminal = new TerminalWrapper(terminalPanel);
  shellTerminal = new TerminalWrapper(shellPanel);

  claudeTerminal.onInput((sessionId: string, data: string) => {
    window.api.sendInput(sessionId, data);
  });

  shellTerminal.onInput((sessionId: string, data: string) => {
    window.api.sendShellInput(sessionId, data);
  });

  claudeTerminal.onResize((cols: number, rows: number) => {
    if (activeSessionId && activeTab === 'claude') {
      window.api.resizeSession(activeSessionId, cols, rows);
    }
  });

  shellTerminal.onResize((cols: number, rows: number) => {
    if (activeSessionId && activeTab === 'shell') {
      window.api.resizeShell(activeSessionId, cols, rows);
    }
  });

  function setActiveTab(tab: 'claude' | 'shell'): void {
    activeTab = tab;

    // Update tab buttons
    const tabs = terminalTabs.querySelectorAll('.terminal-tab');
    tabs.forEach(t => {
      t.classList.toggle('active', (t as HTMLElement).dataset.tab === tab);
    });

    if (tab === 'claude') {
      shellTerminal.setVisible(false);
      claudeTerminal.setVisible(true);
      claudeTerminal.focus();
    } else {
      claudeTerminal.setVisible(false);
      shellTerminal.setVisible(true);

      if (activeSessionId && !shellCreated.has(activeSessionId)) {
        // Lazily create shell on first access
        window.api.createShell(activeSessionId).then((buffer: string) => {
          if (activeSessionId) {
            shellCreated.add(activeSessionId);
            shellTerminal.switchTo(activeSessionId, buffer);
            const { cols, rows } = shellTerminal.getDimensions();
            window.api.resizeShell(activeSessionId, cols, rows);
          }
        });
      } else if (activeSessionId && shellCreated.has(activeSessionId)) {
        // Replay existing shell buffer
        window.api.getShellBuffer(activeSessionId).then((buffer: string) => {
          if (activeSessionId) {
            shellTerminal.switchTo(activeSessionId, buffer);
            const { cols, rows } = shellTerminal.getDimensions();
            window.api.resizeShell(activeSessionId, cols, rows);
          }
        });
      }

      shellTerminal.focus();
    }
  }

  // Tab click handlers
  terminalTabs.addEventListener('click', (e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest('.terminal-tab') as HTMLElement | null;
    if (!target) return;
    const tab = target.dataset.tab as 'claude' | 'shell';
    if (tab) setActiveTab(tab);
  });

  // Toggle terminal shortcut
  window.api.onToggleTerminal(() => {
    if (!activeSessionId) return;
    setActiveTab(activeTab === 'claude' ? 'shell' : 'claude');
  });

  async function createNewSession(): Promise<void> {
    const session = await window.api.createSession();
    if (!session) return;

    sessions.set(session.id, session);
    renderSidebar();
    switchToSession(session.id);
  }

  async function createSessionFromDir(dir: string): Promise<void> {
    const session = await window.api.createSessionWithDir(dir);
    if (!session) return;

    sessions.set(session.id, session);
    renderSidebar();
    switchToSession(session.id);
  }

  function closeRecentDirsMenu(): void {
    const existing = document.getElementById('recent-dirs-menu');
    if (existing) existing.remove();
  }

  async function showNewSessionMenu(): Promise<void> {
    closeRecentDirsMenu();
    const recentDirs = await window.api.getRecentDirs();

    if (recentDirs.length === 0) {
      createNewSession();
      return;
    }

    const btn = document.getElementById('new-session-btn')!;
    const menu = document.createElement('div');
    menu.id = 'recent-dirs-menu';

    for (const dir of recentDirs) {
      const item = document.createElement('div');
      item.className = 'recent-dir-item';
      item.title = dir;
      item.textContent = dir.split('/').pop() || dir;

      const dirPath = document.createElement('span');
      dirPath.className = 'recent-dir-path';
      // Shorten /Users/xxx/... to ~/...
      dirPath.textContent = dir.replace(/^\/Users\/[^/]+/, '~');
      item.appendChild(dirPath);

      item.addEventListener('click', () => {
        closeRecentDirsMenu();
        createSessionFromDir(dir);
      });
      menu.appendChild(item);
    }

    const browseItem = document.createElement('div');
    browseItem.className = 'recent-dir-item browse-item';
    browseItem.textContent = 'Browse...';
    browseItem.addEventListener('click', () => {
      closeRecentDirsMenu();
      createNewSession();
    });
    menu.appendChild(browseItem);

    btn.parentElement!.appendChild(menu);

    // Close when clicking outside
    const onClickOutside = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node) && e.target !== btn) {
        closeRecentDirsMenu();
        document.removeEventListener('click', onClickOutside);
      }
    };
    setTimeout(() => document.addEventListener('click', onClickOutside), 0);
  }

  document.getElementById('new-session-btn')!.addEventListener('click', showNewSessionMenu);
  document.getElementById('rename-session-btn')!.addEventListener('click', () => {
    if (!activeSessionId) return;
    const nameSpan = document.querySelector(`#session-list li.active .session-name`) as HTMLSpanElement | null;
    if (nameSpan) startRename(activeSessionId, nameSpan);
  });
  window.api.onNewSession(showNewSessionMenu);
  window.api.onSwitchSession((sessionId: string) => {
    if (sessions.has(sessionId)) switchToSession(sessionId);
  });

  window.api.onOutput((sessionId: string, data: string) => {
    if (sessionId === activeSessionId) {
      claudeTerminal.write(data);
    }
  });

  window.api.onShellOutput((sessionId: string, data: string) => {
    if (sessionId === activeSessionId && activeTab === 'shell') {
      shellTerminal.write(data);
    }
  });

  window.api.onShellExit((sessionId: string) => {
    shellCreated.delete(sessionId);
  });

  window.api.onStateChange((sessionId: string, state: SessionStatus) => {
    const session = sessions.get(sessionId);
    if (session) {
      session.status = state;
      renderSidebar();
    }
  });

  window.api.onExit((sessionId: string) => {
    const session = sessions.get(sessionId);
    if (session) {
      session.status = 'done';
      renderSidebar();
    }
  });

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const ids = Array.from(sessions.keys());
      if (ids.length < 2) return;
      const currentIndex = ids.indexOf(activeSessionId!);
      const next = e.key === 'ArrowDown'
        ? (currentIndex + 1) % ids.length
        : (currentIndex - 1 + ids.length) % ids.length;
      switchToSession(ids[next]);
    }
  });

  function switchToSession(sessionId: string): void {
    activeSessionId = sessionId;
    window.api.setActiveSession(sessionId);

    // Always reset to Claude tab on session switch
    terminalPanel.classList.add('visible');
    terminalTabs.classList.add('visible');
    emptyState.style.display = 'none';

    // Reset to claude tab
    activeTab = 'claude';
    const tabs = terminalTabs.querySelectorAll('.terminal-tab');
    tabs.forEach(t => {
      t.classList.toggle('active', (t as HTMLElement).dataset.tab === 'claude');
    });
    shellTerminal.setVisible(false);
    claudeTerminal.setVisible(true);

    window.api.getBuffer(sessionId).then((buffer: string) => {
      claudeTerminal.switchTo(sessionId, buffer);

      const { cols, rows } = claudeTerminal.getDimensions();
      window.api.resizeSession(sessionId, cols, rows);
    });

    renderSidebar();
  }

  function startRename(sessionId: string, nameSpan: HTMLSpanElement): void {
    const session = sessions.get(sessionId);
    if (!session) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'session-rename-input';
    input.value = session.name;

    const commit = () => {
      const newName = input.value.trim();
      if (newName && newName !== session.name) {
        session.name = newName;
      }
      renderSidebar();
    };

    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        renderSidebar();
      }
    });

    input.addEventListener('blur', commit);

    nameSpan.textContent = '';
    nameSpan.appendChild(input);
    input.focus();
    input.select();
  }

  function renderSidebar(): void {
    const renameBtn = document.getElementById('rename-session-btn')!;
    renameBtn.style.display = activeSessionId ? 'inline-block' : 'none';

    const list = document.getElementById('session-list')!;
    list.innerHTML = '';

    for (const [id, session] of sessions) {
      const li = document.createElement('li');
      li.className = id === activeSessionId ? 'active' : '';
      li.innerHTML = `
        <span class="status-dot ${session.status}"></span>
        <span class="session-name" title="${session.cwd}">${session.name}</span>
        <button class="session-close" title="Close session">&times;</button>
      `;

      li.addEventListener('click', (e: MouseEvent) => {
        if ((e.target as HTMLElement).classList.contains('session-close')) return;
        if ((e.target as HTMLElement).classList.contains('session-rename-input')) return;
        switchToSession(id);
      });

      li.querySelector('.session-close')!.addEventListener('click', async () => {
        await window.api.killSession(id);
        sessions.delete(id);
        shellCreated.delete(id);

        if (activeSessionId === id) {
          activeSessionId = null;
          terminalPanel.classList.remove('visible');
          terminalTabs.classList.remove('visible');
          emptyState.style.display = '';
          const remaining = Array.from(sessions.keys());
          if (remaining.length > 0) switchToSession(remaining[0]);
        }

        renderSidebar();
      });

      list.appendChild(li);
    }
  }
});
