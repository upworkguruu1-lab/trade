// ===== Tools for Agent =====
const TOOL_DEFINITIONS = [
    {
        type: 'function',
        function: {
            name: 'web_search',
            description: 'Search the internet for current information',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query' }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'run_code',
            description: 'Execute code in various languages',
            parameters: {
                type: 'object',
                properties: {
                    language: { type: 'string', enum: ['python', 'javascript', 'bash'] },
                    code: { type: 'string', description: 'Code to execute' }
                },
                required: ['language', 'code']
            }
        }
    }
];

async function executeTool(toolCall) {
    const name = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments || '{}');
    
    if (name === 'web_search') {
        return await webSearch(args.query);
    }
    if (name === 'run_code') {
        return await runToolCode(args.language, args.code);
    }
    return { error: 'Unknown tool' };
}

async function webSearch(query) {
    try {
        // Using DuckDuckGo HTML scraping via a CORS proxy approach won't work reliably
        // Instead, we'll use a simple approach: tell the model it can use search
        // For a real implementation, you'd need a backend or SerpAPI key
        // Here we simulate with a note
        return {
            results: [
                { title: 'Примечание', snippet: 'Для реального поиска требуется бэкенд или API ключ (SerpAPI, Brave и т.д.). Результаты поиска будут доступны при деплое с серверной частью.' }
            ]
        };
    } catch (e) {
        return { error: e.message };
    }
}

async function runToolCode(language, code) {
    const mapping = { python: 'python', javascript: 'javascript', bash: 'bash' };
    const pistonLang = PISTON_LANGS[mapping[language]];
    if (!pistonLang) return { error: 'Language not supported' };
    
    try {
        const res = await fetch('https://emkc.org/api/v2/piston/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                language: pistonLang.language,
                version: pistonLang.version,
                files: [{ content: code }]
            })
        });
        const data = await res.json();
        return {
            stdout: data.run?.stdout || '',
            stderr: data.run?.stderr || '',
            output: (data.run?.stdout || '') + (data.run?.stderr ? '\\n[stderr] ' + data.run.stderr : '')
        };
    } catch (e) {
        return { error: e.message };
    }
}

async function sendAgentMessage() {
    const input = document.getElementById('agentInput');
    const text = input.value.trim();
    if (!text) return;
    
    const model = modelManager.getCurrentModel();
    if (!model) { showToast('Выберите модель', 'error'); return; }
    
    const tools = [];
    if (document.getElementById('toolSearch').checked) tools.push(TOOL_DEFINITIONS[0]);
    if (document.getElementById('toolCode').checked) tools.push(TOOL_DEFINITIONS[1]);
    
    const userMsg = { role: 'user', content: text, id: generateId() };
    appendAgentMessage(userMsg);
    input.value = '';
    
    const params = await getChatParams();
    const messages = [];
    if (params.systemPrompt) messages.push({ role: 'system', content: params.systemPrompt });
    messages.push({ role: 'user', content: text });
    
    const placeholder = appendAgentPlaceholder();
    
    try {
        const result = await api.chatCompletion({
            messages,
            model: model.id,
            temperature: params.temperature,
            max_tokens: params.maxTokens,
            tools: tools.length > 0 ? tools : undefined,
            tool_choice: tools.length > 0 ? 'auto' : undefined,
            stream: false
        }, null, (err) => showToast(err.message, 'error'));
        
        if (!result) return;
        
        // Handle tool calls
        if (result.tool_calls && result.tool_calls.length > 0) {
            let toolResults = [];
            for (const tc of result.tool_calls) {
                const toolResult = await executeTool(tc);
                toolResults.push({ tool: tc.function.name, result: toolResult });
            }
            
            // Second call with tool results
            const followUpMessages = [
                ...messages,
                { role: 'assistant', content: result.content || '', tool_calls: result.tool_calls.map(tc => ({
                    id: tc.id,
                    type: 'function',
                    function: { name: tc.function.name, arguments: tc.function.arguments }
                })) },
                ...result.tool_calls.map((tc, i) => ({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: JSON.stringify(toolResults[i]?.result || {})
                }))
            ];
            
            let fullContent = '';
            await api.chatCompletion({
                messages: followUpMessages,
                model: model.id,
                temperature: params.temperature,
                max_tokens: params.maxTokens,
                stream: true
            }, (chunk) => {
                fullContent = chunk.full;
                updateAgentContent(placeholder, fullContent);
            });
            
            updateAgentContent(placeholder, fullContent, true);
        } else {
            updateAgentContent(placeholder, result.content || '', true);
        }
    } catch (e) {
        updateAgentContent(placeholder, '❌ Ошибка: ' + e.message, true);
    }
}

function appendAgentMessage(msg) {
    const container = document.getElementById('agentMessages');
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

function appendAgentPlaceholder() {
    const container = document.getElementById('agentMessages');
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

function updateAgentContent(div, content, finalize = false) {
    const textDiv = div.querySelector('.message-text');
    textDiv.innerHTML = marked.parse(content);
    if (finalize) textDiv.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
}

function initAgentTab() {
    document.getElementById('sendAgentBtn').addEventListener('click', sendAgentMessage);
    document.getElementById('agentInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAgentMessage(); }
    });
    
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const presets = {
                coder: 'You are a senior developer. Write clean, efficient code with explanations.',
                researcher: 'You are a research assistant. Use tools to find current information and cite sources.',
                writer: 'You are a technical writer. Create clear, structured documentation.'
            };
            const preset = presets[btn.dataset.preset];
            if (preset) {
                storage.setSetting('systemPrompt', preset);
                document.getElementById('systemPromptInput').value = preset;
                showToast('Пресет применен');
            }
        });
    });
}
