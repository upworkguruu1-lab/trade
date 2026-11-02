// ===== Code Runner (via Piston API) =====
const PISTON_API = 'https://emkc.org/api/v2/piston';

const PISTON_LANGS = {
    javascript: { language: 'javascript', version: '18.15.0' },
    python: { language: 'python', version: '3.10.0' },
    bash: { language: 'bash', version: '5.1.0' },
    cpp: { language: 'cpp', version: '10.2.0' },
    go: { language: 'go', version: '1.16.2' },
    rust: { language: 'rust', version: '1.68.2' }
};

let codeMessages = [];
let currentCodeChatId = null;

async function sendCodeMessage() {
    const input = document.getElementById('codeInput');
    const text = input.value.trim();
    if (!text) return;
    
    const model = modelManager.getCurrentModel();
    if (!model) { showToast('Выберите модель', 'error'); return; }
    
    const userMsg = { role: 'user', content: text, id: generateId() };
    codeMessages.push(userMsg);
    appendCodeMessage(userMsg);
    input.value = '';
    
    const params = await getChatParams();
    const apiMessages = [];
    if (params.systemPrompt) apiMessages.push({ role: 'system', content: params.systemPrompt });
    apiMessages.push(...codeMessages.map(m => ({ role: m.role, content: m.content })));
    
    const assistantDiv = appendCodeAssistantPlaceholder();
    
    try {
        let fullContent = '';
        await api.chatCompletion({
            messages: apiMessages,
            model: model.id,
            temperature: params.temperature,
            max_tokens: params.maxTokens,
            stream: true
        }, (chunk) => {
            fullContent = chunk.full;
            updateCodeAssistant(assistantDiv, fullContent);
        });
        
        const finalMsg = { role: 'assistant', content: fullContent, id: generateId() };
        codeMessages.push(finalMsg);
        updateCodeAssistant(assistantDiv, fullContent, true);
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function appendCodeMessage(msg) {
    const container = document.getElementById('codeMessages');
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

function appendCodeAssistantPlaceholder() {
    const container = document.getElementById('codeMessages');
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

function updateCodeAssistant(div, content, finalize = false) {
    const textDiv = div.querySelector('.message-text');
    textDiv.innerHTML = marked.parse(content);
    if (finalize) {
        textDiv.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
    }
}

async function runExtractedCode() {
    const lang = document.getElementById('codeLang').value;
    const pistonLang = PISTON_LANGS[lang];
    if (!pistonLang) { showToast('Язык не поддерживается', 'error'); return; }
    
    // Extract last code block from assistant messages
    let codeToRun = '';
    for (let i = codeMessages.length - 1; i >= 0; i--) {
        if (codeMessages[i].role === 'assistant') {
            const match = codeMessages[i].content.match(/```(?:\w+)?\n([\s\S]+?)```/);
            if (match) {
                codeToRun = match[1].trim();
                break;
            }
        }
    }
    
    if (!codeToRun) { showToast('Код для выполнения не найден', 'error'); return; }
    
    const output = document.getElementById('outputContent');
    output.innerHTML = '<code>⏳ Выполнение...</code>';
    
    try {
        const res = await fetch(`${PISTON_API}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                language: pistonLang.language,
                version: pistonLang.version,
                files: [{ content: codeToRun }]
            })
        });
        const data = await res.json();
        
        let result = '';
        if (data.run?.stdout) result += data.run.stdout;
        if (data.run?.stderr) result += '\\n[stderr]\\n' + data.run.stderr;
        if (data.compile?.stderr) result = '[compile error]\\n' + data.compile.stderr + '\\n' + result;
        if (!result) result = '✅ Выполнено успешно (нет вывода)';
        
        output.innerHTML = `<code>${escapeHtml(result)}</code>`;
    } catch (e) {
        output.innerHTML = `<code>❌ Ошибка: ${e.message}</code>`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function initCodeTab() {
    document.getElementById('sendCodeBtn').addEventListener('click', sendCodeMessage);
    document.getElementById('runCodeBtn').addEventListener('click', runExtractedCode);
    document.getElementById('codeInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCodeMessage(); }
    });
}
