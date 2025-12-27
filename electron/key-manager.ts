import { safeStorage, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const SECRETS_FILE = path.join(os.homedir(), '.natsuki', 'secrets.json');

interface EncryptedData {
    iv: string;
    data: string;
}

interface SecretsStore {
    [key: string]: string; // Key: Provider ID, Value: Encrypted hex string (from safeStorage)
}

/**
 * KeyManager handles secure storage of API keys using Electron's safeStorage.
 * Ideally, safeStorage uses OS Keychain (macOS) / DPAPI (Windows) / Libsecret (Linux).
 * 
 * However, safeStorage.encryptString returns Buffer. We need to persist that buffer.
 * Storing the raw buffer in a file is fine if it's encrypted by safeStorage.
 * 
 * Note: safeStorage is only available after app 'ready'.
 */
export class KeyManager {
    private storePath: string;
    private memoryCache: Map<string, string> = new Map(); // Cache decrypted keys

    constructor() {
        this.storePath = SECRETS_FILE;
        this.ensureStoreExists();
    }

    private ensureStoreExists() {
        const dir = path.dirname(this.storePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    private loadStore(): SecretsStore {
        if (!fs.existsSync(this.storePath)) {
            return {};
        }
        try {
            return JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
        } catch (e) {
            console.error('[KeyManager] Failed to read secrets file', e);
            return {};
        }
    }

    private saveStore(store: SecretsStore) {
        fs.writeFileSync(this.storePath, JSON.stringify(store, null, 2));
    }

    /**
     * Set an API key for a provider.
     * @param provider e.g., 'anthropic', 'google', 'openai'
     * @param key The raw API key
     */
    async setApiKey(provider: string, key: string): Promise<boolean> {
        if (!safeStorage.isEncryptionAvailable()) {
            console.error('[KeyManager] Encryption not available (safeStorage).');
            return false;
        }

        try {
            const encryptedBuffer = safeStorage.encryptString(key);
            // Convert buffer to hex string for JSON storage
            const encryptedHex = encryptedBuffer.toString('hex');

            const store = this.loadStore();
            store[provider] = encryptedHex;
            this.saveStore(store);

            // Update cache
            this.memoryCache.set(provider, key);
            return true;
        } catch (e) {
            console.error('[KeyManager] Encryption failed', e);
            return false;
        }
    }

    /**
     * Get the API key for a provider.
     * @param provider e.g., 'anthropic'
     */
    getApiKey(provider: string): string | null {
        // Check cache first
        if (this.memoryCache.has(provider)) {
            return this.memoryCache.get(provider) || null;
        }

        if (!safeStorage.isEncryptionAvailable()) {
            console.warn('[KeyManager] Encryption not available.');
            return null;
        }

        const store = this.loadStore();
        if (!store[provider]) {
            return null;
        }

        try {
            const buffer = Buffer.from(store[provider], 'hex');
            const decrypted = safeStorage.decryptString(buffer);
            this.memoryCache.set(provider, decrypted);
            return decrypted;
        } catch (e) {
            console.error(`[KeyManager] Failed to decrypt key for ${provider}`, e);
            return null;
        }
    }

    deleteApiKey(provider: string) {
        const store = this.loadStore();
        if (store[provider]) {
            delete store[provider];
            this.saveStore(store);
        }
        this.memoryCache.delete(provider);
    }
}

export const keyManager = new KeyManager();
