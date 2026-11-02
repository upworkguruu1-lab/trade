// ===== Simple RAG (client-side text search) =====
let ragDocuments = [];
let ragMessages = [];

async function loadRagDocuments() {
    ragDocuments = await storage.getDocuments();
    renderRagDocs();
}

function renderRagDocs() {
    const container = document.getElementById('ragDocuments');
    container.innerHTML = '';
    for (const doc of ragDocuments) {
        const div = document.createElement('div');
        div.className = 'rag-doc-item';
        div.innerHTML = `
            <span class="doc-name">${doc.name}</span>
            <button class="doc-remove" onclick="deleteRagDoc('${doc.id}')">&times;</button>
        `;
        container.appendChild(div);
    }
}

window.deleteRagDoc = async function(id) {
    await storage.deleteDocument(id);
    ragDocuments = ragDocuments.filter(d => d.id !== id);
    renderRagDocs();
};

async function handleRagUpload(files) {
    for (const file of files) {
        const text = await file.text();
        const id = generateId();
        const doc = { id, name: file.name, content: text, size: file.size, createdAt: Date.now() };
        await storage.saveDocument(doc);
        ragDocuments.push(doc);
    }
    renderRagDocs();
    showToast(`Загружено ${files.length} документов`);
}

function searchRagContext(query, maxChunks = 3) {
    // Simple keyword-based retrieval
    const keywords = query.toLowerCase().split(/\\s+/).filter(w => w.length > 3);
    const scored = [];
    
    for (const doc of ragDocuments) {
        const chunks = doc.content.split(/\\n{2,}/).filter(c => c.length > 50);
        for (const chunk of chunks) {
            const lower = chunk.toLowerCase();
            let score = 0;
            for (const kw of keywords) {
                if (lower.includes(kw)) score += 1;
            }
            if (score > 0) scored.push({ chunk, score, doc: doc.name });
        }
    }
    
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxChunks).map(s => `--- Из ${s.doc} ---\\n${s.chunk}`).join('\\n\\n');
}

async function sendRagMessage() {
    const input = document.getElementById('ragInput');
    const text = input.value.trim();
    if (!text) return;
    
    const model = modelManager.getCurrentModel();
    if (!model) { showToast('Выберите модель', 'error'); return; }
    
    if (ragDocuments.length === 0) {
        showToast('Сначала загрузите документы', 'error');
        return;
    }
    
    const context = searchRagContext(text);
    const userMsg = { role: 'user', content: text, id: generateId() };
    appendRagMessage(userMsg);
    input.value = '';
    
    const systemPrompt = `Ты — ассистент для работы с документами. Используй только предоставленный контекст для ответа. Если ответ не найден в контексте, скажи об этом честно.\\n\\nКонтекст:\\n${context}`;
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
    ];
    
    const placeholder = appendRagPlaceholder();
    
    try {
        let fullContent = '';
        await api.chatCompletion({
            messages,
            model: model.id,
            temperature: 0.3,
            max_tokens: 4096,
            stream: true
        }, (chunk) => {
            fullContent = chunk.full;
            updateRagContent(placeholder, fullContent);
        });
        updateRagContent(placeholder, fullContent, true);
    } catch (e) {
        updateRagContent(placeholder, '❌ Ошибка: ' + e.message, true);
    }
}

function appendRagMessage(msg) {
    const container = document.getElementById('ragMessages');
    const div = document.createElement('div');
    div.className = 'message';
    div.innerHTML = `
        <div class="message-avatar user">Вы</div>
        <div class="message-content">
            <div class="message-header"><span class="message-author">Вы</span></div>
            <div class="message-text">${marked.parse(msg.content)}</div>
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function appendRagPlaceholder() {
    const container = document.getElementById('ragMessages');
    const div = document.createElement('div');
    div.className = 'message';
    div.innerHTML = `
        <div class="message-avatar assistant">AI</div>
        <div class="message-content">
            <div class="message-header"><span class="message-author">AI</span></div>
            <div class="message-text"><div class="loading-dots"><span></span><span></span><span></span></div></div>
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
}

function updateRagContent(div, content, finalize = false) {
    const textDiv = div.querySelector('.message-text');
    textDiv.innerHTML = marked.parse(content);
    if (finalize) textDiv.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
}

function initRagTab() {
    loadRagDocuments();
    
    const dropzone = document.getElementById('ragDropzone');
    const fileInput = document.getElementById('ragFileInput');
    
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--accent)'; });
    dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = ''; });
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = '';
        handleRagUpload(Array.from(e.dataTransfer.files));
    });
    fileInput.addEventListener('change', (e) => handleRagUpload(Array.from(e.target.files)));
    
    document.getElementById('sendRagBtn').addEventListener('click', sendRagMessage);
    document.getElementById('ragInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendRagMessage(); }
    });
}
