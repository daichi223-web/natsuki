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

        // Helper to safely fit
        const safelyFit = () => {
            if (!terminalRef.current) return;
            if (terminalRef.current.clientWidth === 0 || terminalRef.current.clientHeight === 0) return;

            try {
                fitAddon.fit();
            } catch (e) {
                console.warn("xterm fit error suppressed:", e);
            }
        };

        term.open(terminalRef.current);
        xtermRef.current = term;

        // Delay fit() to ensure DOM is ready
        setTimeout(() => {
            safelyFit();
        }, 100);

        // Send init
        window.electronAPI.send('terminal-init', cwd);

        // Resize observer
        const resizeObserver = new ResizeObserver(() => {
            safelyFit();
            if (term.cols && term.rows) {
                window.electronAPI.send('terminal-resize', { cols: term.cols, rows: term.rows });
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
                    window.electronAPI.send('terminal-input', text);
                });
                return false;
            }
            return true;
        });

        // Input
        term.onData(data => {
            window.electronAPI.send('terminal-input', data);
        });

        // Output from Main
        const handleData = (data: string) => {
            term.write(data);
            // Forward to job service for completion detection
            jobService.onTerminalOutput(data);
        };
        const handleExit = ({ exitCode }: { exitCode: number }) => {
            term.write(`\r\nProgram exited with code ${exitCode}\r\n`);
        };

        window.electronAPI.on('terminal-data', handleData);
        window.electronAPI.on('terminal-exit', handleExit);

        // Window resize handler
        const handleWindowResize = () => {
            safelyFit();
            if (term.cols && term.rows) {
                window.electronAPI.send('terminal-resize', { cols: term.cols, rows: term.rows });
            }
        };
        window.addEventListener('resize', handleWindowResize);

        // Initial focus
        setTimeout(() => {
            term.focus();
            safelyFit();
        }, 200);

        return () => {
            resizeObserver.disconnect();
            window.removeEventListener('resize', handleWindowResize);
            window.electronAPI.removeAllListeners('terminal-data');
            term.dispose();
        };
    }, []);

    return (
        <div className="h-full w-full bg-[#1e1e1e] p-1" ref={terminalRef} />
    );
}
