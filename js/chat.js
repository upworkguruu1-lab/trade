// ===== Chat Module =====
let currentChatId = null;
let currentMessages = [];
let isGenerating = false;

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

async function createNewChat(tab = 'chat', title = 'Новый чат') {
    currentChatId = generateId();
    currentMessages = [];
    const chat = { id: currentChatId, tab, title, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    await storage.saveChat(chat);
    loadChatHistory(tab);
    renderMessages();
    return chat;
}

async function loadChat(chatId) {
    const chat = await storage.getChat(chatId);
    if (!chat) return;
    currentChatId = chatId;
    currentMessages = chat.messages || [];
    renderMessages();
}

async function saveCurrentChat(title) {
    if (!currentChatId) return;
    const chat = await storage.getChat(currentChatId) || { id: currentChatId, tab: window.currentTab || 'chat', createdAt: Date.now() };
    chat.messages = currentMessages;
    chat.updatedAt = Date.now();
    if (title) chat.title = title;
    await storage.saveChat(chat);
    loadChatHistory(chat.tab);
}

async function loadChatHistory(tab) {
    const container = document.getElementById('chatHistory');
    const chats = await storage.getChatsByTab(tab);
    container.innerHTML = '';
    
    for (const chat of chats.slice(0, 20)) {
        const item = document.createElement('div');
        item.className = 'history-item' + (chat.id === currentChatId ? ' active' : '');
        item.textContent = chat.title || 'Без названия';
        item.title = chat.title || 'Без названия';
        item.onclick = () => loadChat(chat.id);
        container.appendChild(item);
    }
}

function renderMessages() {
    const container = document.getElementById('chatMessages');
    container.innerHTML = '';
    
    for (const msg of currentMessages) {
        appendMessageToDOM(msg, false);
    }
    
    scrollToBottom();
}

function appendMessageToDOM(msg, animate = true) {
    const container = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = 'message' + (animate ? '' : '');
    div.dataset.role = msg.role;
    
    const avatarClass = msg.role === 'user' ? 'user' : 'assistant';
    const author = msg.role === 'user' ? 'Вы' : 'AI';
    const modelName = msg.model ? `<span class="message-model">${msg.model}</span>` : '';
    
    let contentHtml = '';
    if (typeof msg.content === 'string') {
        contentHtml = marked.parse(msg.content);
    } else if (Array.isArray(msg.content)) {
        // Multimodal content
        for (const part of msg.content) {
            if (part.type === 'text') contentHtml += marked.parse(part.text);
            if (part.type === 'image_url') {
                contentHtml += `<img src="${part.image_url.url}" class="message-image" alt="Image">`;
            }
        }
    }
    
    div.innerHTML = `
        <div class="message-avatar ${avatarClass}">${msg.role === 'user' ? 'Вы' : 'AI'}</div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-author">${author}</span>
                ${modelName}
            </div>
            <div class="message-text">${contentHtml}</div>
            <div class="message-actions">
                <button class="message-action-btn" onclick="copyMessage(this)" title="Копировать">Копировать</button>
                <button class="message-action-btn" onclick="deleteMessage('${msg.id}')" title="Удалить">Удалить</button>
            </div>
        </div>
    `;
    
    container.appendChild(div);
    if (!animate) div.style.animation = 'none';
    
    // Highlight code blocks
    div.querySelectorAll('pre code').forEach(block => {
        hljs.highlightElement(block);
        addCopyButton(block.parentElement);
    });
    
    scrollToBottom();
}

function addCopyButton(pre) {
    if (pre.parentElement.querySelector('.code-block-header')) return;
    
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    const header = document.createElement('div');
    header.className = 'code-block-header';
    const lang = pre.querySelector('code')?.className?.replace('language-', '') || 'code';
    header.innerHTML = `<span>${lang}</span><button class="copy-code-btn">Копировать</button>`;
    
    pre.parentElement.insertBefore(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
    
    header.querySelector('.copy-code-btn').addEventListener('click', () => {
        const code = pre.textContent;
        navigator.clipboard.writeText(code);
        showToast('Код скопирован');
    });
}

function scrollToBottom() {
    const container = document.getElementById('chatMessages');
    container.scrollTop = container.scrollHeight;
}

function copyMessage(btn) {
    const text = btn.closest('.message').querySelector('.message-text').innerText;
    navigator.clipboard.writeText(text);
    showToast('Сообщение скопировано');
}

async function deleteMessage(msgId) {
    currentMessages = currentMessages.filter(m => m.id !== msgId);
    renderMessages();
    await saveCurrentChat();
}

async function sendChatMessage() {
    if (isGenerating) return;
    
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    const attached = getAttachedFiles();
    
    if (!text && attached.length === 0) return;
    
    const model = modelManager.getCurrentModel();
    if (!model) {
        showToast('Выберите модель', 'error');
        return;
    }
    
    if (!currentChatId) await createNewChat('chat', text.slice(0, 40) || 'Новый чат');
    
    let userContent;
    if (attached.length > 0) {
        userContent = [{ type: 'text', text: text || 'Опишите это изображение' }];
        for (const file of attached) {
            if (file.type.startsWith('image/')) {
                userContent.push({ type: 'image_url', image_url: { url: file.data } });
            }
        }
    } else {
        userContent = text;
    }
    
    const userMsg = { id: generateId(), role: 'user', content: userContent, timestamp: Date.now() };
    currentMessages.push(userMsg);
    appendMessageToDOM(userMsg);
    input.value = '';
    input.style.height = 'auto';
    clearAttachedFiles();
    await saveCurrentChat(text.slice(0, 40));
    
    // Prepare messages for API
    const params = await getChatParams();
    const apiMessages = [];
    if (params.systemPrompt) apiMessages.push({ role: 'system', content: params.systemPrompt });
    
    for (const m of currentMessages) {
        if (typeof m.content === 'string') {
            apiMessages.push({ role: m.role, content: m.content });
        } else {
            apiMessages.push({ role: m.role, content: m.content });
        }
    }
    
    // Assistant placeholder
    const assistantMsg = { id: generateId(), role: 'assistant', content: '', model: model.id, timestamp: Date.now() };
    currentMessages.push(assistantMsg);
    const assistantDiv = appendAssistantPlaceholder();
    isGenerating = true;
    document.getElementById('sendBtn').disabled = true;
    
    try {
        const result = await api.chatCompletion({
            messages: apiMessages,
            model: model.id,
            temperature: params.temperature,
            top_p: params.topP,
            max_tokens: params.maxTokens,
            stream: true
        }, (chunk) => {
            assistantMsg.content = chunk.full;
            updateAssistantContent(assistantDiv, assistantMsg.content);
        }, (err) => {
            showToast(err.message, 'error');
            assistantMsg.content = '❌ Ошибка: ' + err.message;
            updateAssistantContent(assistantDiv, assistantMsg.content);
        });
        
        assistantMsg.content = result.content || assistantMsg.content;
        updateAssistantContent(assistantDiv, assistantMsg.content, true);
        await saveCurrentChat();
    } catch (e) {
        console.error(e);
    } finally {
        isGenerating = false;
        document.getElementById('sendBtn').disabled = false;
    }
}

function appendAssistantPlaceholder() {
    const container = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = 'message';
    div.innerHTML = `
        <div class="message-avatar assistant">AI</div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-author">AI</span>
                <span class="message-model">${modelManager.getCurrentModel()?.id || ''}</span>
            </div>
            <div class="message-text"><div class="loading-dots"><span></span><span></span><span></span></div></div>
        </div>
    `;
    container.appendChild(div);
    scrollToBottom();
    return div;
}

function updateAssistantContent(div, content, finalize = false) {
    const textDiv = div.querySelector('.message-text');
    if (!textDiv) return;
    
    textDiv.innerHTML = marked.parse(content);
    
    if (finalize) {
        textDiv.querySelectorAll('pre code').forEach(block => {
            hljs.highlightElement(block);
            addCopyButton(block.parentElement);
        });
        div.querySelector('.message-content').innerHTML += `
            <div class="message-actions">
                <button class="message-action-btn" onclick="copyMessage(this)">Копировать</button>
                <button class="message-action-btn" onclick="deleteMessage('${div.dataset.id}')">Удалить</button>
            </div>
        `;
    }
    
    scrollToBottom();
}

// File attachments
let attachedFiles = [];

function getAttachedFiles() { return attachedFiles; }
function clearAttachedFiles() { 
    attachedFiles = []; 
    document.getElementById('attachedFiles').innerHTML = ''; 
}

function initChat() {
    const input = document.getElementById('chatInput');
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    });
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    });
    
    document.getElementById('sendBtn').addEventListener('click', sendChatMessage);
    document.getElementById('newChatBtn').addEventListener('click', () => createNewChat(window.currentTab || 'chat'));
    
    // File attachment
    document.getElementById('attachFileBtn').addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                attachedFiles.push({ name: file.name, type: file.type, data: reader.result });
                renderAttachedFiles();
            };
            reader.readAsDataURL(file);
        };
        input.click();
    });
    
    // Web search toggle
    const webSearchBtn = document.getElementById('webSearchBtn');
    webSearchBtn.addEventListener('click', () => {
        webSearchBtn.classList.toggle('active');
        window.webSearchEnabled = webSearchBtn.classList.contains('active');
    });
}

function renderAttachedFiles() {
    const container = document.getElementById('attachedFiles');
    container.innerHTML = '';
    for (const file of attachedFiles) {
        const div = document.createElement('div');
        div.className = 'attached-file';
        div.innerHTML = `<span>${file.name}</span><button onclick="removeAttachedFile('${file.name}')">&times;</button>`;
        container.appendChild(div);
    }
}

window.removeAttachedFile = function(name) {
    attachedFiles = attachedFiles.filter(f => f.name !== name);
    renderAttachedFiles();
};
