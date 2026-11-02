// ===== OpenRouter API Client =====
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

class OpenRouterAPI {
    constructor() {
        this.apiKey = '';
        this.loadKey();
    }

    async loadKey() {
        this.apiKey = await storage.getSetting('apiKey', '');
    }

    setKey(key) {
        this.apiKey = key;
        storage.setSetting('apiKey', key);
    }

    getHeaders() {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': window.location.href,
            'X-Title': 'OpenRouter AI Hub'
        };
    }

    async fetchModels() {
        if (!this.apiKey) return [];
        try {
            const res = await fetch(`${OPENROUTER_BASE}/models`, { headers: this.getHeaders() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.data || [];
        } catch (e) {
            console.error('Failed to fetch models:', e);
            return [];
        }
    }

    async chatCompletion(options, onChunk, onError) {
        const { messages, model, temperature = 0.7, top_p = 1, max_tokens = 4096, stream = true, tools, tool_choice } = options;
        
        if (!this.apiKey) {
            onError?.(new Error('API ключ не установлен. Перейдите в настройки.'));
            return;
        }

        const body = {
            model,
            messages,
            temperature,
            top_p,
            max_tokens,
            stream
        };

        if (tools && tools.length > 0) {
            body.tools = tools;
            body.tool_choice = tool_choice || 'auto';
        }

        try {
            const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error?.message || `HTTP ${res.status}`);
            }

            if (!stream) {
                const data = await res.json();
                return data.choices?.[0]?.message;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullContent = '';
            let toolCalls = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const data = trimmed.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta;
                        if (!delta) continue;

                        if (delta.content) {
                            fullContent += delta.content;
                            onChunk?.({ type: 'content', data: delta.content, full: fullContent });
                        }

                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                const existing = toolCalls[tc.index];
                                if (existing) {
                                    existing.function.arguments += tc.function.arguments || '';
                                } else {
                                    toolCalls[tc.index] = {
                                        id: tc.id,
                                        type: 'function',
                                        function: {
                                            name: tc.function.name,
                                            arguments: tc.function.arguments || ''
                                        }
                                    };
                                }
                            }
                            onChunk?.({ type: 'tool_calls', data: toolCalls });
                        }
                    } catch (e) {
                        // ignore parse errors
                    }
                }
            }

            return { content: fullContent, tool_calls: toolCalls.filter(Boolean) };
        } catch (e) {
            onError?.(e);
            throw e;
        }
    }

    async generateImage(options) {
        // OpenRouter doesn't directly support image generation in chat completions
        // This would need a specific image model endpoint
        // For now, we'll use multimodal chat with image URLs
        return null;
    }

    async generateAudio(options) {
        // TTS via OpenRouter if supported by model
        const { model = 'openai/tts-1', input, voice = 'alloy' } = options;
        if (!this.apiKey) throw new Error('API ключ не установлен');
        
        try {
            const res = await fetch(`${OPENROUTER_BASE}/audio/speech`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ model, input, voice })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.blob();
        } catch (e) {
            console.error('TTS failed:', e);
            throw e;
        }
    }

    async transcribeAudio(audioBlob, model = 'openai/whisper-1') {
        if (!this.apiKey) throw new Error('API ключ не установлен');
        
        const formData = new FormData();
        formData.append('file', audioBlob, 'audio.webm');
        formData.append('model', model);

        try {
            const res = await fetch(`${OPENROUTER_BASE}/audio/transcriptions`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.apiKey}` },
                body: formData
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.text;
        } catch (e) {
            console.error('STT failed:', e);
            throw e;
        }
    }
}

const api = new OpenRouterAPI();
