// ===== App Initialization =====
document.addEventListener('DOMContentLoaded', async () => {
    // Wait for storage
    await storage.ensureReady();
    
    // Initialize modules
    initSidebar();
    initModelSelector();
    initSettings();
    initChat();
    initCodeTab();
    initAgentTab();
    initRagTab();
    initMultimodal();
    initAudio();
    initCompare();
    
    // Load initial chat history
    loadChatHistory('chat');
    
    // Set default tab
    window.currentTab = 'chat';
    
    console.log('OpenRouter AI Hub initialized');
});

// ===== Multimodal Tab =====
function initMultimodal() {
    const uploadArea = document.getElementById('mmUploadArea');
    const fileInput = document.getElementById('mmFileInput');
    const gallery = document.getElementById('mmGallery');
    let mmImages = [];
    
    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.style.borderColor = 'var(--accent)'; });
    uploadArea.addEventListener('dragleave', () => { uploadArea.style.borderColor = ''; });
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '';
        handleFiles(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')));
    });
    fileInput.addEventListener('change', (e) => handleFiles(Array.from(e.target.files)));
    
    function handleFiles(files) {
        for (const file of files) {
            const reader = new FileReader();
            reader.onload = () => {
                mmImages.push({ name: file.name, data: reader.result });
                renderGallery();
            };
            reader.readAsDataURL(file);
        }
    }
    
    function renderGallery() {
        gallery.innerHTML = '';
        for (const img of mmImages) {
            const div = document.createElement('div');
            div.className = 'mm-image-item';
            div.innerHTML = `<img src="${img.data}"><button class="remove-image" onclick="removeMmImage('${img.name}')">&times;</button>`;
            gallery.appendChild(div);
        }
    }
    
    window.removeMmImage = function(name) {
        mmImages = mmImages.filter(i => i.name !== name);
        renderGallery();
    };
    
    document.getElementById('sendMmBtn').addEventListener('click', async () => {
        const text = document.getElementById('mmInput').value.trim();
        const model = modelManager.getCurrentModel();
        if (!model) { showToast('Выберите модель', 'error'); return; }
        if (mmImages.length === 0 && !text) return;
        
        const content = [{ type: 'text', text: text || 'Опишите это изображение' }];
        for (const img of mmImages) {
            content.push({ type: 'image_url', image_url: { url: img.data } });
        }
        
        const container = document.getElementById('mmMessages');
        const userDiv = document.createElement('div');
        userDiv.className = 'message';
        userDiv.innerHTML = `
            <div class="message-avatar user">Вы</div>
            <div class="message-content">
                <div class="message-header"><span class="message-author">Вы</span></div>
                <div class="message-text">${text || ''}${mmImages.map(i => `<img src="${i.data}" class="message-image">`).join('')}</div>
            </div>
        `;
        container.appendChild(userDiv);
        document.getElementById('mmInput').value = '';
        
        const placeholder = document.createElement('div');
        placeholder.className = 'message';
        placeholder.innerHTML = `
            <div class="message-avatar assistant">AI</div>
            <div class="message-content">
                <div class="message-header"><span class="message-author">AI</span></div>
                <div class="message-text"><div class="loading-dots"><span></span><span></span><span></span></div></div>
            </div>
        `;
        container.appendChild(placeholder);
        container.scrollTop = container.scrollHeight;
        
        const params = await getChatParams();
        const messages = [];
        if (params.systemPrompt) messages.push({ role: 'system', content: params.systemPrompt });
        messages.push({ role: 'user', content });
        
        try {
            let fullContent = '';
            await api.chatCompletion({
                messages,
                model: model.id,
                temperature: params.temperature,
                max_tokens: params.maxTokens,
                stream: true
            }, (chunk) => {
                fullContent = chunk.full;
                placeholder.querySelector('.message-text').innerHTML = marked.parse(fullContent);
            });
            placeholder.querySelector('.message-text').innerHTML = marked.parse(fullContent);
            placeholder.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
        } catch (e) {
            placeholder.querySelector('.message-text').innerHTML = '❌ Ошибка: ' + e.message;
        }
    });
}

// ===== Audio Tab =====
function initAudio() {
    const modes = document.querySelectorAll('.audio-mode');
    modes.forEach(btn => {
        btn.addEventListener('click', () => {
            modes.forEach(m => m.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.audio-panel').forEach(p => p.classList.remove('active'));
            document.getElementById(btn.dataset.mode + 'Panel').classList.add('active');
        });
    });
    
    // TTS
    document.getElementById('generateAudioBtn').addEventListener('click', async () => {
        const text = document.getElementById('ttsInput').value.trim();
        if (!text) return;
        
        try {
            const blob = await api.generateAudio({
                input: text,
                voice: document.getElementById('ttsVoice').value
            });
            const url = URL.createObjectURL(blob);
            document.getElementById('audioPlayer').src = url;
            document.getElementById('audioPlayerWrapper').style.display = 'block';
        } catch (e) {
            showToast('TTS ошибка: ' + e.message, 'error');
        }
    });
    
    // STT
    const sttUpload = document.getElementById('sttUpload');
    const sttFile = document.getElementById('sttFileInput');
    sttUpload.addEventListener('click', () => sttFile.click());
    sttFile.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        document.getElementById('sttResult').textContent = '⏳ Распознавание...';
        try {
            const text = await api.transcribeAudio(file);
            document.getElementById('sttResult').textContent = text;
        } catch (e) {
            document.getElementById('sttResult').textContent = '❌ Ошибка: ' + e.message;
        }
    });
    
    // Recording
    let mediaRecorder = null;
    let recordedChunks = [];
    const recordBtn = document.getElementById('recordBtn');
    
    recordBtn.addEventListener('click', async () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            recordBtn.classList.remove('recording');
            recordBtn.innerHTML = '<span class="record-icon"></span>Записать';
            return;
        }
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            recordedChunks = [];
            
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) recordedChunks.push(e.data);
            };
            
            mediaRecorder.onstop = async () => {
                const blob = new Blob(recordedChunks, { type: 'audio/webm' });
                document.getElementById('sttResult').textContent = '⏳ Распознавание...';
                try {
                    const text = await api.transcribeAudio(blob);
                    document.getElementById('sttResult').textContent = text;
                } catch (e) {
                    document.getElementById('sttResult').textContent = '❌ Ошибка: ' + e.message;
                }
                stream.getTracks().forEach(t => t.stop());
            };
            
            mediaRecorder.start();
            recordBtn.classList.add('recording');
            recordBtn.innerHTML = '<span class="record-icon"></span>Остановить';
        } catch (e) {
            showToast('Нет доступа к микрофону', 'error');
        }
    });
}

// ===== Compare Tab =====
function initCompare() {
    const sel1 = document.getElementById('compareModel1');
n    const sel2 = document.getElementById('compareModel2');
    
    function populateSelects() {
        const opts = modelManager.models.map(m => `<option value="${m.id}">${m.name || m.id}</option>`).join('');
        sel1.innerHTML = opts;
        sel2.innerHTML = opts;
        if (modelManager.models[0]) sel1.value = modelManager.models[0].id;
        if (modelManager.models[1]) sel2.value = modelManager.models[1].id;
    }
    
    populateSelects();
    
    document.getElementById('sendCompareBtn').addEventListener('click', async () => {
        const text = document.getElementById('compareInput').value.trim();
        if (!text) return;
        
        const m1 = sel1.value;
        const m2 = sel2.value;
        const model1 = modelManager.getModelById(m1);
        const model2 = modelManager.getModelById(m2);
        
        document.getElementById('compareHeader1').textContent = model1?.name || m1;
        document.getElementById('compareHeader2').textContent = model2?.name || m2;
        
        const c1 = document.getElementById('compareMessages1');
        const c2 = document.getElementById('compareMessages2');
        c1.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
        c2.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
        
        const params = await getChatParams();
        const messages = [{ role: 'user', content: text }];
        if (params.systemPrompt) messages.unshift({ role: 'system', content: params.systemPrompt });
        
        const runModel = async (modelId, container) => {
            try {
                let fullContent = '';
                await api.chatCompletion({
                    messages,
                    model: modelId,
                    temperature: params.temperature,
                    max_tokens: params.maxTokens,
                    stream: true
                }, (chunk) => {
                    fullContent = chunk.full;
                    container.innerHTML = marked.parse(fullContent);
                });
                container.innerHTML = marked.parse(fullContent);
                container.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
            } catch (e) {
                container.innerHTML = `<p style="color:var(--danger)">❌ ${e.message}</p>`;
            }
        };
        
        await Promise.all([
            runModel(m1, c1),
            runModel(m2, c2)
        ]);
    });
}
