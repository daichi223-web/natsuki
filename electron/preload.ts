import { ipcRenderer, contextBridge } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
    on(channel: string, callback: (...args: any[]) => void) {
        const subscription = (_event: any, ...args: any[]) => callback(...args);
        ipcRenderer.on(channel, subscription);
        return () => ipcRenderer.removeListener(channel, subscription);
    },
    send(channel: string, ...args: any[]) {
        ipcRenderer.send(channel, ...args)
    },
    invoke(channel: string, ...args: any[]) {
        return ipcRenderer.invoke(channel, ...args)
    },
    removeAllListeners(channel: string) {
        ipcRenderer.removeAllListeners(channel);
    }
})
