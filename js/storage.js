// ===== IndexedDB Storage =====
const DB_NAME = 'OpenRouterHub';
const DB_VERSION = 1;

class Storage {
    constructor() {
        this.db = null;
        this.initPromise = this.init();
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                if (!db.objectStoreNames.contains('chats')) {
                    const chatStore = db.createObjectStore('chats', { keyPath: 'id' });
                    chatStore.createIndex('tab', 'tab', { unique: false });
                    chatStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                }
                
                if (!db.objectStoreNames.contains('documents')) {
                    db.createObjectStore('documents', { keyPath: 'id' });
                }
                
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };
        });
    }

    async ensureReady() {
        if (!this.db) await this.initPromise;
        return this.db;
    }

    // ===== Chats =====
    async saveChat(chat) {
        const db = await this.ensureReady();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('chats', 'readwrite');
            const store = tx.objectStore('chats');
            chat.updatedAt = Date.now();
            const request = store.put(chat);
            request.onsuccess = () => resolve(chat);
            request.onerror = () => reject(request.error);
        });
    }

    async getChat(id) {
        const db = await this.ensureReady();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('chats', 'readonly');
            const store = tx.objectStore('chats');
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getChatsByTab(tab) {
        const db = await this.ensureReady();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('chats', 'readonly');
            const store = tx.objectStore('chats');
            const index = store.index('tab');
            const request = index.getAll(tab);
            request.onsuccess = () => {
                const chats = request.result || [];
                chats.sort((a, b) => b.updatedAt - a.updatedAt);
                resolve(chats);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async deleteChat(id) {
        const db = await this.ensureReady();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('chats', 'readwrite');
            const store = tx.objectStore('chats');
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // ===== Documents (RAG) =====
    async saveDocument(doc) {
        const db = await this.ensureReady();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('documents', 'readwrite');
            const store = tx.objectStore('documents');
            const request = store.put(doc);
            request.onsuccess = () => resolve(doc);
            request.onerror = () => reject(request.error);
        });
    }

    async getDocuments() {
        const db = await this.ensureReady();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('documents', 'readonly');
            const store = tx.objectStore('documents');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteDocument(id) {
        const db = await this.ensureReady();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('documents', 'readwrite');
            const store = tx.objectStore('documents');
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // ===== Settings =====
    async setSetting(key, value) {
        const db = await this.ensureReady();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('settings', 'readwrite');
            const store = tx.objectStore('settings');
            const request = store.put({ key, value });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getSetting(key, defaultValue = null) {
        const db = await this.ensureReady();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('settings', 'readonly');
            const store = tx.objectStore('settings');
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result ? request.result.value : defaultValue);
            request.onerror = () => reject(request.error);
        });
    }

    // ===== Export/Import =====
    async exportAll() {
        const db = await this.ensureReady();
        const data = { chats: [], documents: [], settings: {}, version: 1, exportedAt: new Date().toISOString() };
        
        await new Promise((resolve, reject) => {
            const tx = db.transaction('chats', 'readonly');
            const store = tx.objectStore('chats');
            const request = store.getAll();
            request.onsuccess = () => { data.chats = request.result || []; resolve(); };
            request.onerror = () => reject(request.error);
        });
        
        await new Promise((resolve, reject) => {
            const tx = db.transaction('documents', 'readonly');
            const store = tx.objectStore('documents');
            const request = store.getAll();
            request.onsuccess = () => { data.documents = request.result || []; resolve(); };
            request.onerror = () => reject(request.error);
        });
        
        await new Promise((resolve, reject) => {
            const tx = db.transaction('settings', 'readonly');
            const store = tx.objectStore('settings');
            const request = store.getAll();
            request.onsuccess = () => {
                (request.result || []).forEach(s => data.settings[s.key] = s.value);
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
        
        return data;
    }

    async importAll(data) {
        const db = await this.ensureReady();
        
        if (data.chats) {
            const tx = db.transaction('chats', 'readwrite');
            const store = tx.objectStore('chats');
            for (const chat of data.chats) store.put(chat);
        }
        
        if (data.documents) {
            const tx = db.transaction('documents', 'readwrite');
            const store = tx.objectStore('documents');
            for (const doc of data.documents) store.put(doc);
        }
        
        if (data.settings) {
            const tx = db.transaction('settings', 'readwrite');
            const store = tx.objectStore('settings');
            for (const [key, value] of Object.entries(data.settings)) store.put({ key, value });
        }
    }

    async clearAll() {
        const db = await this.ensureReady();
        for (const storeName of ['chats', 'documents', 'settings']) {
            await new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                const request = store.clear();
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }
    }
}

const storage = new Storage();
