import { useRef, useEffect } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { jobService } from '../services/jobService';
import 'xterm/css/xterm.css';

interface TerminalProps {
    cwd: string;
}

export function TerminalComponent({ cwd }: TerminalProps) {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const sessionRef = useRef<string | null>(null);

    useEffect(() => {
        if (!terminalRef.current) return;

        const term = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Consolas, "Courier New", monospace',
            theme: {
                background: '#1e1e1e',
            }
        });

        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();

        term.loadAddon(fitAddon);
        term.loadAddon(webLinksAddon);

        const safelyFit = () => {
            if (!terminalRef.current || !terminalRef.current.clientWidth) return;
            try { fitAddon.fit(); } catch (e) { }
        };

        term.open(terminalRef.current);
        xtermRef.current = term;

        // Init Session
        let isActive = true;
        (async () => {
            try {
                const res = await window.electronAPI.invoke('terminal-init', cwd);
                if (isActive && res?.sessionId) {
                    sessionRef.current = res.sessionId;
                    console.log(`[Terminal] Attached to session ${res.sessionId}`);

                    // Initial Resize
                    safelyFit();
                    if (term.cols && term.rows) {
                        window.electronAPI.send('terminal-resize', { sessionId: res.sessionId, cols: term.cols, rows: term.rows });
                    }
                }
            } catch (e) {
                term.write(`\r\nConnection failed: ${e}\r\n`);
            }
        })();

        // Resize Observer
        const resizeObserver = new ResizeObserver(() => {
            safelyFit();
            if (term.cols && term.rows && sessionRef.current) {
                window.electronAPI.send('terminal-resize', { sessionId: sessionRef.current, cols: term.cols, rows: term.rows });
            }
        });
        resizeObserver.observe(terminalRef.current);

        // Copy/Paste support
        term.attachCustomKeyEventHandler((event) => {
            if (event.type !== 'keydown') return true;

            // Ctrl+Shift+C: Copy
            if (event.ctrlKey && event.shiftKey && event.code === 'KeyC') {
                const selection = term.getSelection();
                if (selection) {
                    navigator.clipboard.writeText(selection);
                }
                return false;
            }
            // Ctrl+V or Ctrl+Shift+V: Paste
            if (event.ctrlKey && event.code === 'KeyV') {
                navigator.clipboard.readText().then(text => {
                    if (sessionRef.current) {
                        window.electronAPI.send('terminal-input', { sessionId: sessionRef.current, data: text });
                    }
                });
                return false;
            }
            return true;
        });

        // Input Handling
        term.onData(data => {
            if (sessionRef.current) {
                window.electronAPI.send('terminal-input', { sessionId: sessionRef.current, data });
            }
        });

        // Incoming Data
        const handleData = (event: any) => {
            // event = { sessionId, data }
            if (event.sessionId === sessionRef.current) {
                term.write(event.data);
                jobService.onTerminalOutput(event.data);
            }
        };

        const handleExit = (event: any) => {
            if (event.sessionId === sessionRef.current) {
                term.write(`\r\nProgram exited (Code ${event.exitCode})\r\n`);
            }
        };

        // Use dispose functions instead of removeAllListeners
        const disposeData = window.electronAPI.on('terminal-data', handleData);
        const disposeExit = window.electronAPI.on('terminal-exit', handleExit);

        const handleWindowResize = () => {
            safelyFit();
            if (term.cols && term.rows && sessionRef.current) {
                window.electronAPI.send('terminal-resize', { sessionId: sessionRef.current, cols: term.cols, rows: term.rows });
            }
        };
        window.addEventListener('resize', handleWindowResize);

        // Initial Focus
        setTimeout(() => {
            term.focus();
            safelyFit();
        }, 200);

        return () => {
            isActive = false;
            if (sessionRef.current) {
                window.electronAPI.send('terminal-kill', sessionRef.current);
                sessionRef.current = null;
            }
            resizeObserver.disconnect();
            window.removeEventListener('resize', handleWindowResize);
            // Properly dispose listeners
            disposeData();
            disposeExit();
            term.dispose();
        };
    }, [cwd]);

    return (
        <div className="h-full w-full bg-[#1e1e1e] p-1" ref={terminalRef} />
    );
}
