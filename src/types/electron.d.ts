export interface IElectronAPI {
    on(channel: string, callback: (...args: any[]) => void): () => void;
    send(channel: string, ...args: any[]): void;
    removeAllListeners(channel: string): void;

    // Key Management
    invoke(channel: 'key-set', provider: string, key: string): Promise<boolean>;
    invoke(channel: 'key-has', provider: string): Promise<boolean>;
    invoke(channel: 'key-delete', provider: string): Promise<boolean>;
    invoke(channel: 'set-card-provider', provider: string): Promise<boolean>;

    // Research Engine
    invoke(channel: 'research-intent', intent: string): Promise<any>;
    invoke(channel: 'research-plan', premises: any): Promise<any>;
    invoke(channel: 'research-evidence', args: { cwd: string, plan: any }): Promise<string[]>;
    invoke(channel: 'research-build-contract', args: { premises: any, evidence: string[] }): Promise<any>;

    // Fallback
    invoke(channel: string, ...args: any[]): Promise<any>;
}

declare global {
    interface Window {
        electronAPI: IElectronAPI;
    }
}
