// ===== UI Utilities =====
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function switchTab(tabId) {
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabId);
    });
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.toggle('active', tab.id === `tab-${tabId}`);
    });
    
    // Update page title
    const titles = {
        chat: 'Чат',
        code: 'Генерация кода',
        multimodal: 'Мультимодальность',
        audio: 'Аудио',
        agent: 'Агент',
        rag: 'RAG / Документы',
        compare: 'Сравнение моделей',
        settings: 'Настройки'
    };
    document.getElementById('pageTitle').textContent = titles[tabId] || tabId;
    
    // Update current tab for chat history
    window.currentTab = tabId;
    
    // Refresh history for this tab
    if (tabId !== 'settings') {
        loadChatHistory(tabId);
    }
}

function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebarToggle');
    const menuBtn = document.getElementById('menuBtn');
    
    toggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });
    
    menuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });
    
    // Nav items
    document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
        item.addEventListener('click', () => {
            switchTab(item.dataset.tab);
            if (window.innerWidth <= 768) {
                sidebar.classList.add('collapsed');
            }
        });
    });
}

function initSettings() {
    // API Key
    const apiKeyInput = document.getElementById('apiKeyInput');
    const toggleBtn = document.getElementById('toggleApiKey');
    
    storage.getSetting('apiKey', '').then(key => {
        apiKeyInput.value = key;
        api.setKey(key);
    });
    
    apiKeyInput.addEventListener('change', () => {
        const key = apiKeyInput.value.trim();
        api.setKey(key);
        showToast('API ключ сохранен');
    });
    
    toggleBtn.addEventListener('click', () => {
        const isPassword = apiKeyInput.type === 'password';
        apiKeyInput.type = isPassword ? 'text' : 'password';
        toggleBtn.textContent = isPassword ? 'Скрыть' : 'Показать';
    });
    
    // Parameters
    const tempSlider = document.getElementById('temperatureSlider');
    const tempValue = document.getElementById('temperatureValue');
    const topPSlider = document.getElementById('topPSlider');
    const topPValue = document.getElementById('topPValue');
    const maxTokens = document.getElementById('maxTokensInput');
    
    storage.getSetting('temperature', 0.7).then(v => {
        tempSlider.value = v;
        tempValue.textContent = v;
    });
    storage.getSetting('topP', 1).then(v => {
        topPSlider.value = v;
        topPValue.textContent = v;
    });
    storage.getSetting('maxTokens', 4096).then(v => {
        maxTokens.value = v;
    });
    
    tempSlider.addEventListener('input', () => {
        tempValue.textContent = tempSlider.value;
        storage.setSetting('temperature', parseFloat(tempSlider.value));
    });
    
    topPSlider.addEventListener('input', () => {
        topPValue.textContent = topPSlider.value;
        storage.setSetting('topP', parseFloat(topPSlider.value));
    });
    
    maxTokens.addEventListener('change', () => {
        storage.setSetting('maxTokens', parseInt(maxTokens.value));
    });
    
    // System prompt
    const presetSelect = document.getElementById('systemPresetSelect');
    const systemPrompt = document.getElementById('systemPromptInput');
    
    const presets = {
        coder: 'You are a senior software engineer with 20 years of experience. You write clean, efficient, well-documented code. You explain your reasoning and best practices.',
        assistant: 'You are a helpful, harmless, and honest AI assistant. You provide accurate, concise answers and admit when you don\'t know something.',
        creative: 'You are a creative writer with a vivid imagination. You craft engaging stories, poems, and creative content with rich detail and emotional depth.',
        analyst: 'You are a data analyst and research expert. You provide data-driven insights, identify patterns, and support claims with evidence. You think step by step.'
    };
    
    storage.getSetting('systemPrompt', '').then(v => {
        systemPrompt.value = v;
    });
    
    presetSelect.addEventListener('change', () => {
        const preset = presetSelect.value;
        if (presets[preset]) {
            systemPrompt.value = presets[preset];
            storage.setSetting('systemPrompt', presets[preset]);
        }
    });
    
    systemPrompt.addEventListener('change', () => {
        storage.setSetting('systemPrompt', systemPrompt.value);
    });
    
    // Export/Import
    document.getElementById('exportDataBtn').addEventListener('click', async () => {
        const data = await storage.exportAll();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `openrouter-hub-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Данные экспортированы');
    });
    
    document.getElementById('importDataBtn').addEventListener('click', () => {
        document.getElementById('importFileInput').click();
    });
    
    document.getElementById('importFileInput').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            await storage.importAll(data);
            showToast('Данные импортированы. Перезагрузите страницу.');
            setTimeout(() => location.reload(), 1500);
        } catch (err) {
            showToast('Ошибка импорта: ' + err.message, 'error');
        }
    });
    
    document.getElementById('clearAllBtn').addEventListener('click', async () => {
        if (confirm('Вы уверены? Все чаты, документы и настройки будут удалены безвозвратно.')) {
            await storage.clearAll();
            showToast('Все данные очищены');
            setTimeout(() => location.reload(), 1000);
        }
    });
}

async function getChatParams() {
    const temperature = await storage.getSetting('temperature', 0.7);
    const topP = await storage.getSetting('topP', 1);
    const maxTokens = await storage.getSetting('maxTokens', 4096);
    const systemPrompt = await storage.getSetting('systemPrompt', '');
    return { temperature, topP, maxTokens, systemPrompt };
}
