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
      item.tabIndex = 0;
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
    browseItem.tabIndex = 0;
    browseItem.textContent = 'Browse...';
    browseItem.addEventListener('click', () => {
      closeRecentDirsMenu();
      createNewSession();
    });
    menu.appendChild(browseItem);

    btn.parentElement!.appendChild(menu);

    // Keyboard navigation within the menu
    menu.addEventListener('keydown', (e: KeyboardEvent) => {
      const items = Array.from(menu.querySelectorAll('.recent-dir-item')) as HTMLElement[];
      const focused = document.activeElement as HTMLElement;
      const index = items.indexOf(focused);

      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        const next = index < items.length - 1 ? index + 1 : 0;
        items[next].focus();
      } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault();
        const prev = index > 0 ? index - 1 : items.length - 1;
        items[prev].focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (index >= 0) items[index].click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeRecentDirsMenu();
      }
    });

    // Focus first item
    const firstItem = menu.querySelector('.recent-dir-item') as HTMLElement | null;
    if (firstItem) firstItem.focus();

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
    if (!e.metaKey) return;

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const ids = Array.from(sessions.keys());
      if (ids.length < 2) return;
      const currentIndex = ids.indexOf(activeSessionId!);
      const next = e.key === 'ArrowDown'
        ? (currentIndex + 1) % ids.length
        : (currentIndex - 1 + ids.length) % ids.length;
      switchToSession(ids[next]);
      return;
    }

    // Cmd+1-9: jump to session by position
    const digit = parseInt(e.key, 10);
    if (digit >= 1 && digit <= 9) {
      e.preventDefault();
      const ids = Array.from(sessions.keys());
      if (ids[digit - 1]) switchToSession(ids[digit - 1]);
      return;
    }

    // Cmd+T: new session in same project as active session
    if (e.key === 't') {
      e.preventDefault();
      const activeSession = activeSessionId ? sessions.get(activeSessionId) : null;
      if (activeSession?.cwd) {
        createSessionFromDir(activeSession.cwd);
      } else {
        createNewSession();
      }
      return;
    }

    // Cmd+W: close active session with confirmation
    if (e.key === 'w') {
      e.preventDefault();
      if (activeSessionId) showCloseConfirmation(activeSessionId);
      return;
    }

    // Cmd+R: rename active session
    if (e.key === 'r') {
      e.preventDefault();
      if (!activeSessionId) return;
      const nameSpan = document.querySelector(`#session-list li.active .session-name`) as HTMLSpanElement | null;
      if (nameSpan) startRename(activeSessionId, nameSpan);
      return;
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

  async function closeSession(id: string): Promise<void> {
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
  }

  function showCloseConfirmation(sessionId: string): void {
    // Remove existing modal if any
    const existing = document.getElementById('close-confirm-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'close-confirm-modal';
    overlay.innerHTML = `
      <div class="close-confirm-dialog">
        <p>Close this session?</p>
        <div class="close-confirm-buttons">
          <button class="close-confirm-btn confirm" autofocus>Close</button>
          <button class="close-confirm-btn cancel">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const confirmBtn = overlay.querySelector('.confirm') as HTMLButtonElement;
    const cancelBtn = overlay.querySelector('.cancel') as HTMLButtonElement;
    confirmBtn.focus();

    const dismiss = () => overlay.remove();

    confirmBtn.addEventListener('click', () => {
      dismiss();
      closeSession(sessionId);
    });

    cancelBtn.addEventListener('click', dismiss);

    overlay.addEventListener('click', (e: MouseEvent) => {
      if (e.target === overlay) dismiss();
    });

    overlay.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    });
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

    // Group sessions by cwd
    const groups = new Map<string, [string, SessionInfo][]>();
    for (const [id, session] of sessions) {
      const cwd = session.cwd || 'Unknown';
      if (!groups.has(cwd)) groups.set(cwd, []);
      groups.get(cwd)!.push([id, session]);
    }

    for (const [cwd, groupSessions] of groups) {
      // Render project header
      const header = document.createElement('li');
      header.className = 'project-header';
      header.title = cwd;
      header.textContent = cwd.split('/').pop() || cwd;
      list.appendChild(header);

      // Render sessions in this group
      for (const [id, session] of groupSessions) {
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

        li.querySelector('.session-close')!.addEventListener('click', () => {
          closeSession(id);
        });

        list.appendChild(li);
      }
    }
  }
});
