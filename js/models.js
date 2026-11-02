// ===== Model Management =====
class ModelManager {
    constructor() {
        this.models = [];
        this.currentModel = null;
        this.loadModels();
    }

    async loadModels() {
        const saved = await storage.getSetting('models', null);
        if (saved) {
            this.models = saved;
        } else {
            // Default models
            this.models = [
                { id: 'openai/gpt-4o', name: 'GPT-4o', context: 128000 },
                { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', context: 128000 },
                { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', context: 200000 },
                { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', context: 1000000 },
                { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', context: 128000 },
                { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', context: 64000 },
                { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B', context: 128000 },
                { id: 'nousresearch/hermes-3-llama-3.1-405b', name: 'Hermes 3 405B', context: 128000 }
            ];
            await this.saveModels();
        }
        
        this.currentModel = await storage.getSetting('currentModel', this.models[0]?.id || '');
    }

    async saveModels() {
        await storage.setSetting('models', this.models);
    }

    addModel(model) {
        if (!this.models.find(m => m.id === model.id)) {
            this.models.push(model);
            this.saveModels();
            return true;
        }
        return false;
    }

    removeModel(id) {
        this.models = this.models.filter(m => m.id !== id);
        this.saveModels();
        if (this.currentModel === id && this.models.length > 0) {
            this.setCurrentModel(this.models[0].id);
        }
    }

    setCurrentModel(id) {
        this.currentModel = id;
        storage.setSetting('currentModel', id);
    }

    getCurrentModel() {
        return this.models.find(m => m.id === this.currentModel) || this.models[0];
    }

    getModelById(id) {
        return this.models.find(m => m.id === id);
    }

    async refreshFromAPI() {
        const apiModels = await api.fetchModels();
        if (apiModels.length > 0) {
            // Merge with existing, preserving custom names
            const existingIds = new Set(this.models.map(m => m.id));
            for (const m of apiModels) {
                if (!existingIds.has(m.id)) {
                    this.models.push({
                        id: m.id,
                        name: m.name || m.id,
                        context: m.context_length || 0,
                        pricing: m.pricing
                    });
                }
            }
            await this.saveModels();
        }
        return this.models;
    }
}

const modelManager = new ModelManager();

// ===== Model Selector UI =====
function initModelSelector() {
    const btn = document.getElementById('modelSelectBtn');
    const dropdown = document.getElementById('modelDropdown');
    const list = document.getElementById('modelList');
    const search = document.getElementById('modelSearch');
    const currentLabel = document.getElementById('currentModel');

    function renderList(filter = '') {
        list.innerHTML = '';
        const filtered = modelManager.models.filter(m => 
            m.id.toLowerCase().includes(filter.toLowerCase()) ||
            (m.name && m.name.toLowerCase().includes(filter.toLowerCase()))
        );
        
        for (const model of filtered) {
            const item = document.createElement('div');
            item.className = 'model-item';
            if (model.id === modelManager.currentModel) item.style.background = 'var(--bg-active)';
            
            const pricing = model.pricing ? 
                `Prompt: $${model.pricing.prompt}/1M · Completion: $${model.pricing.completion}/1M` : 
                (model.context ? `Context: ${(model.context / 1000).toFixed(0)}K tokens` : '');
            
            item.innerHTML = `
                <span class="model-item-name">${model.name || model.id}</span>
                <span class="model-item-meta">${model.id} · ${pricing}</span>
            `;
            item.onclick = () => {
                modelManager.setCurrentModel(model.id);
                updateCurrentLabel();
                dropdown.classList.remove('open');
                showToast(`Выбрана модель: ${model.name || model.id}`);
            };
            list.appendChild(item);
        }
    }

    function updateCurrentLabel() {
        const m = modelManager.getCurrentModel();
        currentLabel.textContent = m ? (m.name || m.id) : 'Выберите модель';
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
        if (dropdown.classList.contains('open')) {
            renderList();
            search.focus();
        }
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== btn) {
            dropdown.classList.remove('open');
        }
    });

    search.addEventListener('input', (e) => renderList(e.target.value));

    // Add model modal
    const addModal = document.getElementById('addModelModal');
    document.getElementById('addModelBtn').addEventListener('click', () => {
        dropdown.classList.remove('open');
        addModal.classList.add('open');
        document.getElementById('newModelId').focus();
    });

    document.getElementById('closeAddModel').addEventListener('click', () => addModal.classList.remove('open'));
    document.getElementById('cancelAddModel').addEventListener('click', () => addModal.classList.remove('open'));
    
    document.getElementById('confirmAddModel').addEventListener('click', async () => {
        const id = document.getElementById('newModelId').value.trim();
        const name = document.getElementById('newModelName').value.trim();
        const context = parseInt(document.getElementById('newModelContext').value) || 0;
        
        if (!id) {
            showToast('Введите ID модели', 'error');
            return;
        }
        
        if (modelManager.addModel({ id, name: name || id, context })) {
            showToast('Модель добавлена');
            addModal.classList.remove('open');
            document.getElementById('newModelId').value = '';
            document.getElementById('newModelName').value = '';
            document.getElementById('newModelContext').value = '';
        } else {
            showToast('Модель уже существует', 'error');
        }
    });

    // Close modal on backdrop click
    addModal.addEventListener('click', (e) => {
        if (e.target === addModal) addModal.classList.remove('open');
    });

    updateCurrentLabel();
}
