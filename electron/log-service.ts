import fs from 'fs';
import path from 'path';
import os from 'os';

const LOG_DIR = path.join(os.homedir(), '.natsuki', 'logs');

if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFile() {
    // One log file per session or day?
    // Session ID based on timestamp
    const date = new Date().toISOString().split('T')[0];
    return path.join(LOG_DIR, `natsuki-${date}.jsonl`);
}

export function logEvent(event: string, payload: any) {
    const entry = {
        timestamp: new Date().toISOString(),
        event,
        payload
    };
    try {
        fs.appendFileSync(getLogFile(), JSON.stringify(entry) + '\n');
    } catch (e) {
        console.error('Failed to write log', e);
    }
}
