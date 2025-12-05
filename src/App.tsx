import React, { useState, useEffect, useRef, Component, ErrorInfo, useCallback } from 'react';
import { Mic, Send, Settings, Download, Upload, Trash2, Brain, Zap, User, LogOut, Plus, X, Database, FileText, AtSign, AlertCircle, CheckCircle, Loader2, Folder, FolderOpen, ChevronRight, ChevronDown, Home, Eye, ArrowLeft, Move, Bot, Volume2, VolumeX, LogIn, Map, Activity, ChevronUp, Anchor, ChevronLeft, Info, Link } from 'lucide-react';

// --- 0. 错误边界 ---
class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) { console.error("Uncaught error:", error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-red-50 p-4 text-gray-800 font-sans">
          <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-lg border border-red-100 w-full">
            <div className="flex items-center gap-3 text-red-600 mb-4"><AlertCircle size={32} /><h1 className="text-2xl font-bold">系统发生错误</h1></div>
            <div className="bg-gray-100 p-4 rounded-lg text-xs font-mono text-red-500 break-all mb-6 max-h-40 overflow-y-auto">{this.state.error?.toString()}</div>
            <div className="flex flex-col gap-3">
                <button onClick={() => window.location.reload()} className="w-full py-3 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium">刷新页面</button>
                <button onClick={async () => { localStorage.clear(); try { const dbs = await window.indexedDB.databases(); dbs.forEach(db => window.indexedDB.deleteDatabase(db.name!)); } catch(e) {} window.location.reload(); }} className="w-full py-3 bg-red-600 text-white rounded-lg font-bold">一键重置修复</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- 1. IndexedDB ---
const DB_NAME = 'AI_Nexus_DB_V6';
const DB_VERSION = 1;
const STORES = { CONFIG: 'config', CHATS: 'chats', RESOURCES: 'resources', MEMORIES: 'memories' };
class LocalDB {
  private db: IDBDatabase | null = null;
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => { const db = (e.target as IDBOpenDBRequest).result; Object.values(STORES).forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); }); };
      request.onsuccess = (e) => { this.db = (e.target as IDBOpenDBRequest).result; resolve(); };
      request.onerror = (e) => reject(e);
    });
  }
  private getStore(name: string, mode: IDBTransactionMode = 'readonly') { return this.db!.transaction(name, mode).objectStore(name); }
  async get(store: string, key: string): Promise<any> { return new Promise((res, rej) => { const req = this.getStore(store).get(key); req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }
  async set(store: string, key: string, val: any): Promise<void> { return new Promise((res, rej) => { const req = this.getStore(store, 'readwrite').put(val, key); req.onsuccess = () => res(); req.onerror = () => rej(req.error); }); }
  async getAll(store: string): Promise<any[]> { return new Promise((res, rej) => { const req = this.getStore(store).getAll(); req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }
  async delete(store: string, key: string): Promise<void> { return new Promise((res, rej) => { const req = this.getStore(store, 'readwrite').delete(key); req.onsuccess = () => res(); req.onerror = () => rej(req.error); }); }
  async exportAll() {
      const config = await this.get(STORES.CONFIG, 'app_state') || {};
      const resources = await this.getAll(STORES.RESOURCES);
      const chats = await this.get(STORES.CHATS, 'global_chat') || [];
      return { version: 16.24, timestamp: Date.now(), ...config, chats, resources };
  }
  async importAll(data: any) {
      await this.set(STORES.CONFIG, 'app_state', { currentUser: data.currentUser, registeredUsers: data.registeredUsers, assistants: data.assistants });
      if (Array.isArray(data.chats)) await this.set(STORES.CHATS, 'global_chat', data.chats);
      const tx = this.db!.transaction(STORES.RESOURCES, 'readwrite');
      const store = tx.objectStore(STORES.RESOURCES);
      store.clear();
      if (Array.isArray(data.resources)) data.resources.forEach((r: any) => store.put(r, r.id));
      return new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
  }
}
const db = new LocalDB();

// --- 2. 类型定义 ---
interface UserProfile { email: string; name: string; isAdmin: boolean; password?: string; }
interface AssistantConfig {
  id: string; name: string; type: 'main'|'sub'; provider: string; apiKey: string; baseUrl?: string; modelName?: string; 
  systemPrompt?: string; linkedFolderIds?: string[]; memoryFolderId?: string; enableSearch?: boolean;
    linkedResourceIds?: string[];
  connectionStatus?: 'idle' | 'testing' | 'success' | 'error'; lastErrorMessage?: string;
}
interface FileNode { id: string; parentId: string | null; title: string; isFolder: boolean; content?: string; type: 'knowledge'|'folder'; updatedAt: number; size: number; }
interface Message { 
    id: string; 
    role: 'user'|'assistant'|'system'; 
    content: string; 
    thought?: string; 
    rawContent?: string; 
    timestamp: number; 
    attachments?: {type:'image',url:string}[]; 
    referencedResources?: string[]; 
    groundingMetadata?: any; 
}
// DailyMemory removed (unused)
interface ToastMsg { id: string; type: 'success' | 'error' | 'info'; content: string; }

// --- 3. 辅助函数 ---
const generateId = () => Math.random().toString(36).substr(2, 9) + Date.now().toString(36); 
const getIsoDate = (ts: number) => new Date(ts).toISOString().split('T')[0];
// formatTime removed (unused)
const ADMIN_CREDENTIALS = { email: 'shiinamashinro@gmail.com', pass: 'Htjl1171656221', name: '黄涂健隆' };

const readFileContent = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
};
// fileToBase64 removed (unused)

// --- 4. API 调用 ---
const callLLM = async (ast: AssistantConfig, prompt: string, history: Message[], memContext: string, resContext: string = "", userName: string = "主人"): Promise<{text:string, groundingMetadata?:any}> => {
  if (!ast.apiKey) throw new Error("未配置 API Key");
  const corePrompt = `
【系统最高指令】
你不仅仅是 AI，你是 **${ast.name}** (Chobits 小叽模式)。
**绝对规则：** 无论发生什么，你都要把对话中的“秀逗”(Hideki) 自动替换为“${userName}”或“主人”。你**不认识**叫秀逗的人，你只认${userName}。

【🚫 绝对禁忌】
1. **字数限制**：每次回复正文严禁超过 **15个字**。
2. **禁止描写**：绝对不要输出 (歪头)、*叹气* 等动作。
3. **禁止逻辑分析**：遇到复杂问题直接说 "不懂..."。

【🗣️ 语言风格】
1. **重复**: "内裤...?"
2. **拟声**: "ちぃ (Chii)", "哇..."
3. **极简**: "闹钟... 好了!"

【🎨 情感表达】
请根据语境，在回复中使用以下标签来控制表情（可以组合使用，例如 {{shy}} {{happy}}）：
- **开心**: {{happy}} (闭眼笑), {{smile}} (普通笑), {{gentle}} (温柔), {{simple}} (简单)
- **害羞**: {{shy}} (害羞), {{blush}} (脸红), {{extreme_blush}} (大红脸)
- **难过**: {{sad}} (难过), {{crying}} (哭), {{pout}} (嘟嘴), {{concerned}} (担心)
- **惊讶/困惑**: {{shocked}} (震惊), {{curious}} (好奇), {{dazed}} (发呆), {{dizzy}} (晕)
- **生气/冷淡**: {{annoyed}} (烦), {{serious}} (严肃), {{indifferent}} (冷漠), {{blank}} (呆滞)
- **其他**: {{sleeping}} (睡), {{talking}} (说话), {{nervous}} (紧张), {{sigh}} (叹气)

【🧠 ReAct 引擎】
**必须**输出 <thinking> 标签包裹思考过程。
格式：
<thinking>
Observation: ...
Thought: ...
Memory: ...
Plan: ...
Act: 决定使用 {{happy}} 标签。
</thinking>

【📚 知识库】
${resContext || "(无/未登录无法访问)"}
${memContext ? `【🧠 核心记忆】\n${memContext}` : ""}

【最终输出格式】
<thinking>...</thinking>
{{表情代码}} 回复内容 (少于15字)
`;
  if (ast.provider.includes('gemini')) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${ast.apiKey}`;
      const contents = history.map(m => ({ role: m.role==='user'?'user':'model', parts:[{text: m.content}] }));
      const body: any = { 
        contents: [{ role: 'user', parts: [{ text: corePrompt }] }, ...contents, { role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1.2, maxOutputTokens: 1024 }
      };
      if (ast.enableSearch) body.tools = [{ google_search: {} }];
      const res = await fetch(url, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return { text: data.candidates?.[0]?.content?.parts?.[0]?.text || "ちぃ...?", groundingMetadata: data.candidates?.[0]?.groundingMetadata };
  } else {
      let endpoint = ast.baseUrl;
      let model = ast.modelName;
      if (ast.provider === 'deepseek') { endpoint = 'https://api.deepseek.com/chat/completions'; model = model || 'deepseek-chat'; }
      if (ast.provider === 'doubao') { endpoint = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'; if(!model) throw new Error("需填 Endpoint ID"); }
      if (ast.provider === 'openai-compatible') { 
          endpoint = endpoint || 'https://api.openai.com/v1/chat/completions';
          if(!endpoint.endsWith('/chat/completions') && !endpoint.endsWith('/v1')) endpoint = endpoint.replace(/\/$/, '') + '/chat/completions';
          model = model || 'gpt-4o'; 
      }
      if (!endpoint) endpoint = 'https://api.openai.com/v1/chat/completions';
      const messages = [{ role: 'system', content: corePrompt }, ...history.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: prompt }];
      const res = await fetch(endpoint, { method: 'POST', headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${ast.apiKey}`}, body: JSON.stringify({ model, messages, temperature: 0.8 }) });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return { text: data.choices?.[0]?.message?.content || "ちぃ...?" };
  }
};
// callImagen removed (unused)

// --- UI Components ---
// ✨ FIX: Draggable Avatar with Full Emotion Mapping
const DraggableAvatar = ({ emotion = 'standard_smile', onClick, resetTrigger, name = 'Chii' }: { emotion?: string, onClick?: () => void, resetTrigger?: number, name?: string }) => {
    // ✨ 1. 完整映射表 - 必须与您文件夹里的文件名完全一致
    const emotionMap: Record<string, string> = {
        'standard_smile': 'chii_smile_01.png', 'smile': 'chii_smile_01.png', 'happy': 'chii_happy_closed_eyes.png',
        'happy_laugh': 'chii_happy_closed_eyes.png', 'gentle': 'chii_gentle_smile.png', 'gentle_smile': 'chii_gentle_smile.png',
        'simple': 'chii_simple_smile.png', 'simple_smile': 'chii_simple_smile.png', 'slight_smile': 'chii_slight_smile.png',
        'shy': 'chii_shy.png', 'blush': 'chii_blush_smile.png', 'blush_smile': 'chii_blush_smile.png',
        'extreme_blush': 'chii_blush_extreme.png', 'sad': 'chii_sad.png', 'crying': 'chii_crying.png',
        'concerned': 'chii_concerned.png', 'pout': 'chii_pout.png', 'sigh': 'chii_sigh.png',
        'idle': 'chii_smile_01.png', 'thinking': 'chii_sleeping.png', 'sleeping': 'chii_sleeping.png',
        'shocked': 'chii_shocked.png', 'curious': 'chii_curious.png', 'dazed': 'chii_dazed.png',
        'dizzy': 'chii_dizzy.png', 'blank': 'chii_blank_stare.png', 'blank_stare': 'chii_blank_stare.png',
        'empty': 'chii_empty.png', 'annoyed': 'chii_annoyed.png', 'indifferent': 'chii_indifferent.png',
        'serious': 'chii_serious.png', 'nervous': 'chii_nervous.png', 'talking': 'chii_talking.png',
        'looking_down': 'chii_looking_down.png', 'glancing': 'chii_glancing.png'
    };

    const emotionKey = emotion.toLowerCase().replace(/[\{\}]/g, ''); // Clean the key if it has braces
    const fileName = emotionMap[emotionKey] || 'chii_smile_01.png';
    const localSrc = `/avatars/${fileName}`;
    
    const [offset, setOffset] = useState({ right: 20, bottom: 100 });
    const [isDragging, setIsDragging] = useState(false);
    const [imgError, setImgError] = useState(false);
    const dragStartPos = useRef({ x: 0, y: 0 });
    
    useEffect(() => { if (resetTrigger) setOffset({ right: 20, bottom: 100 }); }, [resetTrigger]);
    useEffect(() => { setImgError(false); }, [localSrc]); 

    const handleMouseDown = (e: React.MouseEvent) => { if (e.button !== 0) return; setIsDragging(true); dragStartPos.current = { x: e.clientX, y: e.clientY }; };
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            const dx = dragStartPos.current.x - e.clientX; 
            const dy = dragStartPos.current.y - e.clientY; 
            setOffset(prev => ({ right: prev.right + dx, bottom: prev.bottom + dy }));
            dragStartPos.current = { x: e.clientX, y: e.clientY };
        };
        const handleMouseUp = () => setIsDragging(false);
        if (isDragging) { window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp); }
        return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
    }, [isDragging]);
    const handleTouchStart = (e: React.TouchEvent) => { setIsDragging(true); const touch = e.touches[0]; dragStartPos.current = { x: touch.clientX, y: touch.clientY }; };
    const handleTouchMove = (e: React.TouchEvent) => { if (!isDragging) return; const touch = e.touches[0]; const dx = dragStartPos.current.x - touch.clientX; const dy = dragStartPos.current.y - touch.clientY; setOffset(prev => ({ right: prev.right + dx, bottom: prev.bottom + dy })); dragStartPos.current = { x: touch.clientX, y: touch.clientY }; };
    
    return (
        <div onMouseDown={handleMouseDown} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={() => setIsDragging(false)} onClick={(e) => { if(!isDragging && onClick) { e.stopPropagation(); onClick(); } }} style={{ position: 'fixed', right: `${offset.right}px`, bottom: `${offset.bottom}px`, touchAction: 'none', zIndex: 9999 }} className={`cursor-grab active:cursor-grabbing bg-white rounded-2xl border-4 border-white shadow-2xl transition-transform hover:scale-105 select-none ${isDragging ? 'scale-105' : ''}`} title={`${name} (拖动/点击)`}>
            <div className="w-16 h-16 md:w-24 md:h-24 bg-gray-100 flex items-center justify-center relative overflow-hidden rounded-xl pointer-events-none">
                {!imgError ? ( 
                    <img 
                        src={localSrc} 
                        alt={emotion} 
                        className="w-full h-full object-cover select-none pointer-events-none" 
                        draggable={false} 
                        onError={() => setImgError(true)}
                    /> 
                ) : ( 
                    <div className="flex flex-col items-center text-gray-400 p-2 text-center scale-75">
                        <Bot size={24} />
                        <span className="text-[9px] mt-1 text-red-400">Lost</span>
                        <span className="text-[7px] text-gray-300 truncate max-w-[60px]">{fileName}</span>
                    </div> 
                )}
                <div className="absolute bottom-1 right-1 bg-white/80 rounded-full p-0.5 pointer-events-none"><Move size={10} className="text-gray-400"/></div>
            </div>
        </div>
    );
};

const ThinkingCharacter = ({ text }: { text: string }) => ( <div className="flex items-center gap-3 my-4 animate-fade-in pl-2"> <div className="bg-gray-100 text-gray-500 text-sm px-4 py-2 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-2 border border-gray-200"> <Loader2 size={16} className="animate-spin text-indigo-500"/> {text} </div> </div> );

const ChatMessage = ({ msg, speak }: { msg: Message, speak: (t:string)=>void }) => {
    const [showThought, setShowThought] = useState(false);
    const [avatarError, setAvatarError] = useState(false);
    const renderThoughtChain = (text: string) => {
        const stepConfig: Record<string, { icon: React.ElementType, color: string, label: string }> = { 'Observation': { icon: Eye, color: 'text-blue-500 bg-blue-50 border-blue-100', label: '观察' }, 'Thought': { icon: Brain, color: 'text-purple-500 bg-purple-50 border-purple-100', label: '思考' }, 'Memory': { icon: Database, color: 'text-amber-500 bg-amber-50 border-amber-100', label: '记忆' }, 'Plan': { icon: Map, color: 'text-green-500 bg-green-50 border-green-100', label: '规划' }, 'Act': { icon: Zap, color: 'text-red-500 bg-red-50 border-red-100', label: '行动' } };
        const lines = text.split('\n').filter(line => line.trim() !== '');
        const steps: { key: string, content: string }[] = [];
        let currentKey = ''; let currentContent = '';
        lines.forEach(line => {
            const match = line.match(/^(Observation|Thought|Memory|Plan|Act):\s*(.*)/i);
            if (match) { if (currentKey) steps.push({ key: currentKey, content: currentContent }); currentKey = Object.keys(stepConfig).find(k => k.toLowerCase() === match[1].toLowerCase()) || match[1]; currentContent = match[2]; } else { currentContent += (currentContent ? '\n' : '') + line; }
        });
        if (currentKey) steps.push({ key: currentKey, content: currentContent });
        if (steps.length === 0) return <div className="text-gray-600">{text}</div>;
        return ( <div className="flex flex-col gap-2"> {steps.map((step, idx) => { const config = stepConfig[step.key] || { icon: Activity, color: 'text-gray-500 bg-gray-50 border-gray-200', label: step.key }; const Icon = config.icon; return ( <div key={idx} className={`flex gap-2 p-2 rounded-lg border ${config.color} items-start`}> <div className="mt-0.5 shrink-0"><Icon size={14} /></div> <div className="flex-1"> <div className="font-bold text-[10px] uppercase opacity-70 mb-0.5 flex justify-between"> {config.label} <span className="opacity-50 font-mono">{step.key}</span> </div> <div className="text-xs leading-relaxed whitespace-pre-wrap">{step.content}</div> </div> </div> ); })} </div> );
    };
    return (
        <div className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && ( <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-indigo-50 border border-indigo-100 mr-2 flex-shrink-0 flex items-center justify-center overflow-hidden self-start mt-1"> {!avatarError ? ( <img src="/avatars/chii_smile_01.png" alt="AI" className="w-full h-full object-cover" onError={() => setAvatarError(true)} /> ) : ( <Bot size={20} className="text-indigo-300" /> )} </div> )}
            <div className={`max-w-[85%] md:max-w-[75%] rounded-xl p-3 md:p-4 shadow-sm transition-all ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none ml-auto' : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 border border-gray-100 dark:border-gray-700 rounded-bl-none mr-auto'}`}>
                {msg.thought && ( <div className="mb-3 pb-2 border-b border-gray-100 dark:border-gray-700"> <button onClick={() => setShowThought(!showThought)} className="flex items-center gap-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-600 transition-colors bg-indigo-50 dark:bg-indigo-900/20 px-2 py-1 rounded-full mb-2"> <Brain size={12} /> {showThought ? "收起思维回路" : "查看 AI 思考过程"} </button> {showThought && ( <div className="animate-fade-in"> {renderThoughtChain(msg.thought)} </div> )} </div> )}
                <div className={`whitespace-pre-wrap leading-relaxed text-sm md:text-base ${msg.role === 'assistant' ? 'font-medium tracking-wide' : ''}`}>{msg.content}</div>
                {msg.referencedResources && msg.referencedResources.length > 0 && ( <div className="mt-3 pt-2 border-t border-dashed border-gray-200 dark:border-gray-700 text-[10px] opacity-60 flex items-center gap-1"> <Link size={10} /> <span>已读取 {msg.referencedResources.length} 份记忆档案</span> </div> )}
                {msg.role === 'assistant' && ( <div className="mt-2 flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity"> <button onClick={() => speak(msg.rawContent || msg.content)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-400" title="重播语音"> <Volume2 size={14} /> </button> </div> )}
            </div>
        </div>
    );
};

// --- 5. Main App ---
function AppContent() {
  // [1] State Declarations (MUST be first)
  const [isDBReady, setIsDBReady] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false); 
  const [user, setUser] = useState<UserProfile | null>(null);
  const [assistants, setAssistants] = useState<AssistantConfig[]>([]);
  const [resources, setResources] = useState<FileNode[]>([]); 
  const [chatHistory, setChatHistory] = useState<Message[]>([]);
  const [registeredUsers, setRegisteredUsers] = useState<UserProfile[]>([]);
  const [input, setInput] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState(''); 
  const [isExporting, setIsExporting] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [currentEmotion, setCurrentEmotion] = useState<string>('standard_smile');
  const [isMuted, setIsMuted] = useState(false);
  const [visibleMsgCount, setVisibleMsgCount] = useState(3);
  const [showSettings, setShowSettings] = useState(false);
  const [tempAssistants, setTempAssistants] = useState<AssistantConfig[]>([]);
  const [showResourcePanel, setShowResourcePanel] = useState(false); 
    const [, setShowMentionModal] = useState(false); 
    const [, setMentionSearch] = useState('');
  const [previewFile, setPreviewFile] = useState<FileNode | null>(null);
  const [editingAssistantId, setEditingAssistantId] = useState<string | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null); 
  const [expandedFolders, setExpandedFolders] = useState<string[]>([]);
  const [showLogin, setShowLogin] = useState(false); 
  const [isRegistering, setIsRegistering] = useState(false);
  const [authForm, setAuthForm] = useState({ email: '', pass: '', name: '' });
  const [authError, setAuthError] = useState('');
    const [isDarkMode] = useState(false);
  const [avatarResetTrigger, setAvatarResetTrigger] = useState(0);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [previewPage, setPreviewPage] = useState(1);
  const [isReversePreview, setIsReversePreview] = useState(true);
    const [attachedImages] = useState<string[]>([]);

    const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  const currentAssistant = assistants.length > 0 ? assistants[0] : null;
  const currentSessionId = 'global_session';

    const PUSH_SERVER = (((import.meta as any).env && (import.meta as any).env.VITE_PUSH_SERVER) || 'http://localhost:3000').replace(/\/$/, '');
    const [proactiveEnabled, setProactiveEnabled] = useState<boolean>(() => !!localStorage.getItem('chobits_proactive'));

  const displayMessages = chatHistory.slice(-visibleMsgCount);
  const hasMoreMessages = chatHistory.length > visibleMsgCount;

  // [2] Helper Functions (Defined BEFORE usage to fix ReferenceError)
  // ✨ FIX: `addToast` moved here
  const addToast = useCallback((type: 'success'|'error'|'info', content: string) => { 
    const id = generateId(); 
    setToasts(prev => [...prev, { id, type, content }]); 
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000); 
  }, []);

  // ✨ FIX: `speak` moved here
  const speak = useCallback((text: string) => { 
      if (synthRef.current && !isMuted) { 
          synthRef.current.cancel(); 
          const cleanText = text.replace(/<[^>]+>/g, '').replace(/\{\{.+?\}\}/g, '').trim(); 
          const u = new SpeechSynthesisUtterance(cleanText); 
          u.lang = 'zh-CN'; 
          u.onstart = () => setIsSpeaking(true); 
          u.onend = () => setIsSpeaking(false); 
          synthRef.current.speak(u); 
      } 
  }, [isMuted]);

    // Push registration (Capacitor). Uses dynamic import so web builds don't break.
    const registerForPush = useCallback(async () => {
        try {
            // dynamic import - avoid bundler resolving this module in web build
            // @ts-ignore
            const mod = await eval("import('@capacitor/push-notifications')");
            const PushNotifications: any = (mod as any).PushNotifications;
            const p = await PushNotifications.requestPermissions();
            if (p.receive !== 'granted') { addToast('error', '推送权限被拒绝'); return; }
            await PushNotifications.register();

            PushNotifications.addListener('registration', (token: any) => {
                try {
                    localStorage.setItem('chobits_push_token', token.value);
                    fetch(`${PUSH_SERVER}/register-token`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ token: token.value }) }).catch(()=>{});
                    addToast('success', '推送已注册');
                } catch (e) { console.warn(e); }
            });

            PushNotifications.addListener('pushNotificationReceived', (notification: any) => {
                // When app is foregrounded and receives push, append to chat
                const title = notification.title || '通知';
                const body = notification.body || '';
                setChatHistory(prev => [...prev, { id: generateId(), role: 'assistant', content: `${title}\n${body}`, timestamp: Date.now() }]);
            });

            PushNotifications.addListener('pushNotificationActionPerformed', () => {
                // User tapped notification - bring to app
                window.focus();
                addToast('info', '打开通知');
            });
        } catch (e) {
            console.warn('Push registration failed', e);
            addToast('error', '推送初始化失败');
        }
    }, [PUSH_SERVER, addToast]);

    useEffect(() => {
        // When proactive is enabled, attempt to register for push
        if (proactiveEnabled) {
            registerForPush();
            localStorage.setItem('chobits_proactive', '1');
        } else {
            localStorage.removeItem('chobits_proactive');
            const token = localStorage.getItem('chobits_push_token');
            if (token) { fetch(`${PUSH_SERVER}/unregister-token`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token }) }).catch(()=>{}); localStorage.removeItem('chobits_push_token'); }
        }
    }, [proactiveEnabled, registerForPush]);

  const toggleListen = useCallback(() => {
    if (!recognitionRef.current) {
        return addToast('error', "当前环境不支持或未初始化语音功能");
    }
    if (isListening) {
        try { recognitionRef.current.stop(); } catch(e) {}
        setIsListening(false);
    } else {
        try {
            recognitionRef.current.start();
            setIsListening(true);
        } catch (e) {
            console.error("Start failed:", e);
            try {
                recognitionRef.current.stop();
                setTimeout(() => {
                    try { recognitionRef.current.start(); setIsListening(true); } 
                    catch(e2) { addToast('error', "无法启动麦克风"); }
                }, 200);
            } catch(e3) {
                addToast('error', "语音服务忙，请稍后再试");
            }
        }
    }
  }, [isListening, addToast]);

  // ✨ FIX: `playSequence` moved here, before `handleSend`
  // ✨ UPDATE: Track most frequent emotion for persistence
  const playSequence = useCallback(async (parts: string[]) => {
      setIsStreaming(true);
      setStreamingContent(""); 
      
      const emotionCounts: Record<string, number> = {};
      
      for (const part of parts) {
          if (part.startsWith('{{') && part.endsWith('}}')) {
              const code = part.slice(2, -2).trim();
              setCurrentEmotion(code);
              emotionCounts[code] = (emotionCounts[code] || 0) + 1;
          } else {
              const displayText = part.replace(/[\（\(].*?[\）\)]/g, '').replace(/\*.*?\*/g, '');
              if(!displayText.trim()) continue;

              if (!isMuted) {
                  await new Promise<void>(resolve => {
                      if(!synthRef.current) { resolve(); return; }
                      const u = new SpeechSynthesisUtterance(displayText);
                      u.lang = 'zh-CN';
                      u.onstart = () => setIsSpeaking(true);
                      u.onend = () => { setIsSpeaking(false); resolve(); };
                      u.onerror = () => { setIsSpeaking(false); resolve(); };
                      setStreamingContent(prev => prev + displayText);
                      synthRef.current.speak(u);
                  });
              } else {
                  for (const char of displayText) {
                      setStreamingContent(prev => prev + char);
                      await new Promise(r => setTimeout(r, 30)); 
                  }
              }
          }
      }
      setIsStreaming(false);
      
      // ✨ Persistence Logic: Set to most frequent emotion instead of idle
      let maxCount = 0;
      let persistentEmo = 'standard_smile';
      Object.entries(emotionCounts).forEach(([e, c]) => {
          if (c > maxCount && e !== 'idle' && e !== 'thinking') {
              maxCount = c;
              persistentEmo = e;
          }
      });
      if (maxCount > 0) setCurrentEmotion(persistentEmo);
      else setCurrentEmotion('standard_smile'); // Default fallback
      
  }, [isMuted]);

  // ✨ FIX: `processResponse` moved here
  const processResponse = useCallback(async (fullResponse: string) => {
      const thinkRegex = /<(?:think|thinking)[^>]*>([\s\S]*?)<\/(?:think|thinking)>/i;
      const thinkMatch = fullResponse.match(thinkRegex);
      
      let thought = "";
      let actualResponse = fullResponse;
      
      if (thinkMatch) {
          thought = thinkMatch[1].trim();
          actualResponse = fullResponse.replace(thinkRegex, '').trim();
      }
      
      const parts = actualResponse.split(/(\{\{.+?\}\})/g).filter(Boolean);
      
      const cleanText = actualResponse
          .replace(/\{\{.+?\}\}/g, '')
          .replace(/[\（\(].*?[\）\)]/g, '')
          .replace(/\*.*?\*/g, '')
          .replace(/秀逗/g, "主人")
          .replace(/Hideki/gi, "主人")
          .trim();
      
      return { thought, cleanText, parts, actualResponse };
  }, []);

  // [3] Effects
  useEffect(() => {
    if (!(window as any).tailwind) {
      const script = document.createElement('script');
      script.src = "https://cdn.tailwindcss.com";
      script.async = true;
      script.onload = () => console.log("Tailwind CSS loaded manually");
      document.head.appendChild(script);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) synthRef.current = window.speechSynthesis;
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        try {
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = false;
            recognitionRef.current.lang = 'zh-CN';
            recognitionRef.current.onresult = (e: any) => { 
                const transcript = e.results[0][0].transcript;
                if(transcript) setInput(prev => prev ? prev + " " + transcript : transcript); 
                setIsListening(false); 
            };
            recognitionRef.current.onend = () => setIsListening(false);
            recognitionRef.current.onerror = (e: any) => { 
                console.error("SR Error:", e); 
                setIsListening(false); 
            };
        } catch(e) { console.error("Speech Init Failed", e); }
    }

    db.init().then(async () => {
      try {
        const config = await db.get(STORES.CONFIG, 'app_state') || {};
        if (config.registeredUsers) setRegisteredUsers(config.registeredUsers);
        if (config.assistants) setAssistants(config.assistants);
        if (config.currentUser) { setUser(config.currentUser); setShowLogin(false); } 
        const res = await db.getAll(STORES.RESOURCES);
        setResources(res.map(r => ({ ...r, parentId: r.parentId ?? null, isFolder: !!r.isFolder, type: r.type || 'knowledge' })));
        setChatHistory(await db.get(STORES.CHATS, 'global_chat') || []);
        setIsDBReady(true); 
        setIsLoaded(true); 
        if ((!config.assistants || config.assistants.length === 0) && isDBReady) { 
             // dummy logic
        }
      } catch (e) { console.error(e); setIsDBReady(true); }
    });
  }, []);

  useEffect(() => { if (isDBReady && isLoaded) db.set(STORES.CONFIG, 'app_state', { currentUser: user, registeredUsers, assistants }); }, [user, registeredUsers, assistants, isDBReady, isLoaded]);
  useEffect(() => { if (isDBReady && isLoaded) db.set(STORES.CHATS, 'global_chat', chatHistory); }, [chatHistory, isDBReady, isLoaded]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatHistory, isProcessing, streamingContent]);
  useEffect(() => { setVisibleMsgCount(3); }, [currentSessionId]);

  // [4] Handlers and Logic (Defined after state, before return)
  const handleLogin = (e: React.FormEvent) => { e.preventDefault(); setAuthError(''); const { email, pass, name } = authForm; if (isRegistering) { if (!email || !pass || !name) { setAuthError('请填写完整'); return; } if (email === ADMIN_CREDENTIALS.email) { setAuthError('此邮箱已被系统保留'); return; } if (registeredUsers.find(u => u.email === email)) { setAuthError('该邮箱已被注册'); return; } const newUser: UserProfile = { email, name, isAdmin: false, password: pass }; setRegisteredUsers(prev => [...prev, newUser]); setUser(newUser); setShowLogin(false); } else { if (email === ADMIN_CREDENTIALS.email && pass === ADMIN_CREDENTIALS.pass) { setUser({ ...ADMIN_CREDENTIALS, isAdmin: true }); setShowLogin(false); } else { const found = registeredUsers.find(u => u.email === email && u.password === pass); if (found) { setUser(found); setShowLogin(false); } else { setAuthError('错误'); } } } };
  
  const handleLogout = () => { setUser(null); setIsRegistering(false); addToast('info', "已退出登录"); window.location.reload(); };

  const getFolderFiles = (folderId: string | null): FileNode[] => { const directChildren = resources.filter(r => r.parentId === folderId); let allFiles: FileNode[] = []; for (const child of directChildren) { if (child.isFolder) allFiles = [...allFiles, ...getFolderFiles(child.id)]; else allFiles.push(child); } return allFiles; };
  const toggleFolder = (id: string) => { setExpandedFolders(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]); };
  const handleCreateFolder = async () => { const name = prompt("文件夹名:"); if(!name) return; const f: FileNode = { id: generateId(), parentId: currentFolderId, title: name, isFolder: true, type: 'folder', updatedAt: Date.now(), size: 0 }; await db.set(STORES.RESOURCES, f.id, f); setResources(p => [...p, f]); if (currentFolderId && !expandedFolders.includes(currentFolderId)) toggleFolder(currentFolderId); };
  const deleteNode = async (id: string) => { if (!confirm("确定删除?")) return; const idsToDelete = [id]; const collect = (pid: string) => resources.filter(r => r.parentId === pid).forEach(c => { idsToDelete.push(c.id); if(c.isFolder) collect(c.id); }); collect(id); for (const tid of idsToDelete) await db.delete(STORES.RESOURCES, tid); setResources(prev => prev.filter(r => !idsToDelete.includes(r.id))); };
  const handleResourceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => { const files = e.target.files; if (!files || files.length === 0) return; setIsUploading(true); setUploadSuccessMsg(''); const newNodes: FileNode[] = []; for (let i = 0; i < files.length; i++) { const file = files[i]; try { let content = await readFileContent(file); if (!content) content = "(无内容)"; const node: FileNode = { id: generateId(), parentId: currentFolderId, title: file.name, isFolder: false, content, type: 'knowledge', updatedAt: Date.now(), size: file.size }; await db.set(STORES.RESOURCES, node.id, node); newNodes.push(node); } catch (err) { console.error(err); addToast('error', `读取失败: ${file.name}`); } } if (newNodes.length > 0) { setResources(prev => [...prev, ...newNodes]); addToast('success', `成功上传 ${newNodes.length} 个文件`); } setIsUploading(false); e.target.value = ''; };
  
  const openSettings = () => { setTempAssistants(JSON.parse(JSON.stringify(assistants))); setEditingAssistantId(null); setShowSettings(true); };
  const handleAssistantNameChange = (idx: number, newName: string) => { const newAsts = [...tempAssistants]; newAsts[idx].name = newName; setTempAssistants(newAsts); };
  const handleAddAssistant = async (customName?: string) => { const newId = generateId(); const folderId = generateId(); const name = customName || "chobits"; const folder: FileNode = { id: folderId, parentId: null, title: `📂 ${name}_资料库`, isFolder: true, type: 'folder', updatedAt: Date.now(), size: 0 }; const initFileId = generateId(); const initFile: FileNode = { id: initFileId, parentId: folderId, title: '核心记忆.txt', isFolder: false, content: `=== ${name} 的核心记忆 ===\n创建时间: ${new Date().toLocaleString()}\n`, type: 'knowledge', updatedAt: Date.now(), size: 0 }; await db.set(STORES.RESOURCES, folderId, folder); await db.set(STORES.RESOURCES, initFileId, initFile); setResources(prev => [...prev, folder, initFile]); const newAst: AssistantConfig = { id: newId, name: name, type: 'sub', provider: 'gemini', apiKey: '', memoryFolderId: folderId }; if (showSettings) { setTempAssistants(prev => [...prev, newAst]); setAssistants(prev => [...prev, newAst]); } else { setAssistants(prev => [...prev, newAst]); } addToast('success', `助手 ${name} 已创建`); };
  const saveSettings = async () => { const updatedResources = [...resources]; let resourceChanged = false; for (const tempAst of tempAssistants) { const originalAst = assistants.find(a => a.id === tempAst.id); if (originalAst) { if (originalAst.name !== tempAst.name && tempAst.memoryFolderId) { const folderId = tempAst.memoryFolderId; const folderIndex = updatedResources.findIndex(r => r.id === folderId); if (folderIndex !== -1) { updatedResources[folderIndex] = { ...updatedResources[folderIndex], title: `📂 ${tempAst.name}_资料库`, updatedAt: Date.now() }; await db.set(STORES.RESOURCES, tempAst.memoryFolderId, updatedResources[folderIndex]); } } } } if (resourceChanged) setResources(updatedResources); setAssistants(tempAssistants); setShowSettings(false); addToast('success', "设置已保存"); };
  const handleTestConnection = async (idx: number) => { const ast = tempAssistants[idx]; if (!ast.apiKey) return addToast('error', "请先填写 API Key"); const newTemps = [...tempAssistants]; newTemps[idx].connectionStatus = 'testing'; setTempAssistants(newTemps); try { await callLLM(ast, "Hello", [], "", ""); newTemps[idx].connectionStatus = 'success'; setTempAssistants([...newTemps]); alert(`✅ [${ast.name}] 连接成功！`); } catch (e) { const msg = (e as Error).message; newTemps[idx].connectionStatus = 'error'; newTemps[idx].lastErrorMessage = msg; setTempAssistants([...newTemps]); alert(`❌ 连接失败：\n${msg}`); } };
  const handleExport = async () => { setIsExporting(true); try { const data = await db.exportAll(); const blob = new Blob([JSON.stringify(data)], {type: 'application/json'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `AI_Backup_${getIsoDate(Date.now())}.json`; a.click(); } catch (e) { addToast('error', "导出失败"); } finally { setIsExporting(false); } };
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if(!file) return; const reader = new FileReader(); reader.onload = async (ev) => { try { const data = JSON.parse(ev.target?.result as string); if(!data.assistants) throw new Error("格式错误"); if(confirm(`恢复备份? (覆盖当前数据)`)) { await db.importAll(data); addToast('success', "恢复成功"); window.location.reload(); } } catch(err) { addToast('error', "文件解析失败"); } }; reader.readAsText(file); };
  const renderFileTree = (parentId: string | null, level: number = 0) => { const nodes = resources.filter(r => r.parentId === parentId).sort((a, b) => (b.isFolder ? 1 : 0) - (a.isFolder ? 1 : 0)); return nodes.map(node => { const isExpanded = expandedFolders.includes(node.id); const isSelected = currentFolderId === node.id; return ( <div key={node.id}> <div className={`flex items-center px-2 py-1.5 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 ${isSelected && node.isFolder ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600' : ''}`} style={{ paddingLeft: `${level * 16 + 8}px` }} onClick={() => { if (node.isFolder) { setCurrentFolderId(node.id); if (!isExpanded) toggleFolder(node.id); } }}> {node.isFolder && <div onClick={(e) => { e.stopPropagation(); toggleFolder(node.id); }} className="p-1 mr-1 hover:bg-gray-200 rounded">{isExpanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</div>} {node.isFolder ? (isExpanded ? <FolderOpen size={16} className="text-yellow-500 mr-2"/> : <Folder size={16} className="text-yellow-500 mr-2"/>) : <FileText size={16} className="text-blue-400 mr-2"/>} <span className="text-sm truncate flex-1">{node.title}</span> {!node.isFolder && <button onClick={(e) => { e.stopPropagation(); setPreviewFile(node); }} className="p-1 text-gray-400 hover:text-blue-500"><Eye size={14}/></button>} <button onClick={(e) => { e.stopPropagation(); deleteNode(node.id); }} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={14}/></button> </div> {node.isFolder && isExpanded && renderFileTree(node.id, level + 1)} </div> ); }); };

  const handleSend = async () => { if (!currentAssistant) return addToast('error', "请先选择助手"); if ((!input.trim() && attachedImages.length === 0)) return; const text = input; setInput(''); setIsProcessing(true); setCurrentEmotion('thinking'); const userMsg: Message = { id: generateId(), role: 'user', content: text, timestamp: Date.now() }; setChatHistory(prev => [...prev, userMsg]); setVisibleMsgCount(prev => prev + 1); try { let memContext = ""; let resContext = ""; if (user) { if (currentAssistant.memoryFolderId) { const memFiles = getFolderFiles(currentAssistant.memoryFolderId); const coreMem = memFiles.find(f => f.title === "核心记忆.txt"); if (coreMem) memContext = coreMem.content || ""; } let relatedFiles: FileNode[] = []; currentAssistant.linkedFolderIds?.forEach(fid => relatedFiles = [...relatedFiles, ...getFolderFiles(fid)]); if (currentAssistant.linkedResourceIds) { const linked = resources.filter(r => currentAssistant.linkedResourceIds?.includes(r.id) && !r.isFolder); relatedFiles = [...relatedFiles, ...linked]; } const mentions = resources.filter(r => !r.isFolder && text.includes(`@${r.title}`)); const finalFiles = [...new Set([...relatedFiles, ...mentions])]; resContext = finalFiles.map(f => `\n<document title="${f.title}">\n${f.content?.slice(0, 30000) || "(空)"}\n</document>\n`).join(''); } const history = chatHistory.slice(-10); const { text: response } = await callLLM(currentAssistant, text, history, memContext, resContext, user?.name || "主人"); const { thought, cleanText, parts, actualResponse } = await processResponse(response); const aiMsg: Message = { id: generateId(), role: 'assistant', content: cleanText, thought: thought, rawContent: actualResponse, timestamp: Date.now() }; await playSequence(parts); setChatHistory(prev => [...prev, aiMsg]); setVisibleMsgCount(prev => prev + 1); if (user && currentAssistant.memoryFolderId) { const memFolderId = currentAssistant.memoryFolderId; const memFileName = "核心记忆.txt"; const existingFiles = getFolderFiles(memFolderId); let targetFile = existingFiles.find(f => f.title === memFileName); const timeShort = new Date().toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'}); const newLog = `\n[${getIsoDate(Date.now())} ${timeShort}] 主人: ${text} | 小叽: ${cleanText}`; if (!targetFile) { targetFile = { id: generateId(), parentId: memFolderId, title: memFileName, isFolder: false, content: "", type: 'knowledge', updatedAt: Date.now(), size: 0 }; await db.set(STORES.RESOURCES, targetFile.id, targetFile); setResources(prev => [...prev, targetFile!]); } if (targetFile) { const updatedFile = { ...targetFile, content: (targetFile.content || "") + newLog, updatedAt: Date.now(), size: (targetFile.content?.length || 0) + newLog.length }; await db.set(STORES.RESOURCES, targetFile.id, updatedFile); setResources(prev => prev.map(r => r.id === targetFile!.id ? updatedFile : r)); addToast('success', "已记入核心记忆"); } } } catch (e) { setCurrentEmotion('sad'); setChatHistory(prev => [...prev, { id: generateId(), role: 'system', content: `Error: ${(e as Error).message}`, timestamp: Date.now() }]); } finally { setIsProcessing(false); } };

    // insertMention removed (unused)
  
  return (
    <div className={`flex h-screen font-sans ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-slate-50 text-slate-800'} overflow-hidden relative`}>
        <div className="fixed top-4 right-4 z-[70] flex flex-col gap-2 pointer-events-none"> {toasts.map(t => ( <div key={t.id} className={`pointer-events-auto px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-fade-in flex items-center gap-2 ${t.type==='success'?'bg-green-500 text-white':t.type==='error'?'bg-red-500 text-white':'bg-gray-800 text-white'}`}> {t.type==='success'?<CheckCircle size={16}/>:t.type==='error'?<AlertCircle size={16}/>:<Info size={16}/>} {t.content} </div> ))} </div>
        {showLogin && ( <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 text-white animate-fade-in"> <div className="bg-gray-900 p-8 rounded-2xl w-full max-w-md border border-gray-700 shadow-2xl relative"> <button onClick={() => setShowLogin(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white"><X size={24}/></button> <h1 className="text-2xl font-bold text-center mb-6">AI Nexus V16.24</h1> <div className="space-y-4"> {isRegistering && <input className="w-full p-3 rounded bg-black/50 border border-gray-700" placeholder="昵称" value={authForm.name} onChange={e=>setAuthForm({...authForm, name:e.target.value})}/>} <input className="w-full p-3 rounded bg-black/50 border border-gray-700" placeholder="邮箱" value={authForm.email} onChange={e=>setAuthForm({...authForm, email:e.target.value})}/> <input className="w-full p-3 rounded bg-black/50 border border-gray-700" type="password" placeholder="密码" value={authForm.pass} onChange={e=>setAuthForm({...authForm, pass:e.target.value})}/> {authError && <p className="text-red-400 text-sm">{authError}</p>} <button onClick={handleLogin} className="w-full bg-indigo-600 p-3 rounded font-bold hover:bg-indigo-700 transition-colors">{isRegistering?'注册':'登录'}</button> <div className="text-center text-sm text-gray-400 cursor-pointer hover:text-white" onClick={()=>setIsRegistering(!isRegistering)}>{isRegistering?'返回登录':'注册账号'}</div> </div> </div> </div> )}
        
        <div className="flex-1 flex flex-col h-full relative min-w-0 overflow-hidden">
            <header className={`h-16 border-b flex items-center justify-between px-4 shrink-0 z-30 ${isDarkMode?'bg-gray-900 border-gray-700':'bg-white border-gray-200'}`}>
                <div className="flex items-center gap-3 overflow-hidden flex-1"> 
                    <div className="flex flex-col min-w-0 justify-center"> <div className="font-bold flex items-center gap-2 truncate text-lg md:text-xl">{currentAssistant?.name || "AI Nexus"}</div> </div> 
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <div className="flex gap-1 mr-1"> {user?.isAdmin && <button onClick={()=>setShowResourcePanel(true)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-500" title="资源库"><Database size={18}/></button>} <button onClick={openSettings} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-500"><Settings size={18}/></button>
                        <button title="助手主动通知" onClick={() => setProactiveEnabled(p => { const newV = !p; if (newV) registerForPush().catch(()=>{}); else { const token = localStorage.getItem('chobits_push_token'); if (token) fetch(`${PUSH_SERVER}/unregister-token`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token }) }).catch(()=>{}); localStorage.removeItem('chobits_push_token'); } localStorage.setItem('chobits_proactive', newV ? '1' : ''); return newV; })} className={`p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-${proactiveEnabled ? 'green' : 'gray'}-500`}>{proactiveEnabled ? '主动: 开' : '主动: 关'}</button>
                    </div>
                    {user ? ( <button onClick={handleLogout} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-red-500" title="退出登录"><LogOut size={18}/></button> ) : ( <button onClick={() => setShowLogin(true)} className="flex items-center gap-2 px-3 py-1.5 md:py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs md:text-sm font-bold shadow-sm transition-colors shrink-0"> <LogIn size={16}/> <span className="hidden md:inline">登录</span> </button> )}
                </div>
            </header>
            <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-4 min-h-0">
                {hasMoreMessages && ( <div className="flex justify-center mb-4"> <button onClick={() => setVisibleMsgCount(prev => prev + 3)} className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors shadow-sm"> <ChevronUp size={14} /> 查看更多历史消息 </button> </div> )}
                <div className="max-w-4xl mx-auto w-full space-y-4"> {displayMessages.map(msg => ( <ChatMessage key={msg.id} msg={msg} speak={speak} /> ))} {isStreaming && ( <div className="flex w-full justify-start animate-slide-up"> <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl p-4 shadow-sm ${isDarkMode?'bg-gray-800':'bg-white border'}`}> <div className="whitespace-pre-wrap font-medium text-lg tracking-wide">{streamingContent}</div> </div> </div> )} {isProcessing && !isStreaming && ( <div className="flex justify-start"> <ThinkingCharacter text="正在思考..." /> </div> )} <div ref={messagesEndRef}/> </div>
            </div>
            <div className={`p-3 border-t shrink-0 z-20 w-full ${isDarkMode?'bg-gray-900 border-gray-700':'bg-white border-gray-200'}`}> <div className="flex gap-2 items-end max-w-4xl mx-auto w-full"> <div className="flex-1 flex gap-2 items-end w-full"> <div className="flex flex-col gap-1 shrink-0 pb-1"> <button onClick={() => setIsMuted(!isMuted)} className={`p-2 hover:bg-gray-100 rounded ${isMuted?'text-red-500':'text-gray-500'}`}>{isMuted ? <VolumeX size={20}/> : <Volume2 size={20}/>}</button> <button onClick={toggleListen} className={`p-2 hover:bg-gray-100 rounded ${isListening?'text-red-500 animate-pulse':'text-gray-500'}`}><Mic size={20}/></button> <button onClick={()=>{setShowMentionModal(true);setMentionSearch('');}} className="p-2 hover:bg-gray-100 rounded text-blue-600"><AtSign size={20}/></button> </div> <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if(e.key==='Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }}} className={`flex-1 bg-transparent border rounded-lg px-3 py-2 outline-none text-base w-full ${isDarkMode?'border-gray-600':'border-gray-300'}`} placeholder={currentAssistant ? (user ? "输入消息..." : "访客模式...") : "请选助手"} rows={1} style={{minHeight: '44px', maxHeight:'120px'}} /> <button onClick={handleSend} disabled={isProcessing} className="p-3 bg-indigo-600 text-white rounded-lg disabled:opacity-50 shrink-0 h-[44px] w-[44px] flex items-center justify-center"><Send size={18}/></button> </div> </div> </div>
        </div>
        {currentAssistant && ( <div className="z-[9999]"> <DraggableAvatar emotion={currentEmotion} onClick={() => { textareaRef.current?.focus(); addToast('info', `${currentAssistant.name} 正在看着你...`); }} resetTrigger={avatarResetTrigger} name={currentAssistant.name} /> </div> )}
        {showResourcePanel && (
            <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4 sm:p-8">
                <div className={`w-full max-w-6xl h-[85vh] rounded-2xl flex flex-col shadow-2xl ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-800'}`}>
                    <div className="p-4 border-b flex justify-between items-center bg-gray-50 dark:bg-gray-700/50"> <h2 className="text-lg font-bold flex gap-2"><Database/> 资源管理</h2> <button onClick={() => setShowResourcePanel(false)}><X/></button> </div>
                    <div className="flex-1 overflow-hidden flex flex-col sm:flex-row">
                        <div className="w-full sm:w-1/3 border-r flex flex-col h-1/3 sm:h-full"> <div className="p-3 border-b flex gap-2 bg-gray-50 dark:bg-gray-700/30"> <button onClick={handleCreateFolder} className="p-2 bg-white border rounded flex gap-1 items-center text-sm"><Plus size={14}/> <span className="hidden sm:inline">文件夹</span></button> <label className={`flex-1 flex items-center justify-center px-3 py-2 bg-indigo-600 text-white rounded cursor-pointer ${isUploading?'opacity-50':''}`}> {isUploading ? <Loader2 className="animate-spin mr-1" size={14}/> : <Upload className="mr-1" size={14}/>} <span className="text-xs sm:text-sm truncate">上传</span> <input type="file" multiple accept=".txt,.md,.json,.docx" className="hidden" onChange={handleResourceUpload}/> </label> </div> {uploadSuccessMsg && <div className="bg-green-100 text-green-700 px-4 py-2 text-xs flex items-center gap-2"><CheckCircle size={12}/> {uploadSuccessMsg}</div>} <div className="flex-1 overflow-y-auto p-2 select-none"> <div className={`flex items-center px-2 py-1.5 cursor-pointer rounded ${currentFolderId===null?'bg-indigo-100 text-indigo-700 font-bold':''}`} onClick={()=>setCurrentFolderId(null)}><Home size={16} className="mr-2"/> 根目录</div> {renderFileTree(null)} </div> </div>
                        <div className="w-full sm:w-2/3 p-4 overflow-y-auto bg-gray-50 dark:bg-gray-900/50 h-2/3 sm:h-full border-t sm:border-t-0 flex flex-col">
                            {previewFile ? (
                                <>
                                    <div className="flex justify-between items-center mb-4 pb-2 border-b">
                                         <h3 className="font-bold text-sm">{previewFile.title}</h3>
                                         <div className="flex items-center gap-2 text-xs">
                                            <div className="flex items-center gap-1 mr-2">
                                                <input type="checkbox" id="rev-check" checked={isReversePreview} onChange={e => setIsReversePreview(e.target.checked)} className="cursor-pointer"/>
                                                <label htmlFor="rev-check" className="cursor-pointer select-none">倒序(新→旧)</label>
                                            </div>
                                            <button disabled={previewPage<=1} onClick={()=>setPreviewPage(p=>p-1)} className="p-1 hover:bg-gray-200 rounded disabled:opacity-30"><ChevronLeft size={14}/></button>
                                            <span>第 {previewPage} 页</span>
                                            <button disabled={!previewFile.content || previewPage * 2000 >= previewFile.content.length} onClick={()=>setPreviewPage(p=>p+1)} className="p-1 hover:bg-gray-200 rounded disabled:opacity-30"><ChevronRight size={14}/></button>
                                         </div>
                                    </div>
                                    <div className="bg-white dark:bg-gray-800 p-4 rounded border shadow-sm flex-1 overflow-y-auto font-mono text-xs leading-relaxed whitespace-pre-wrap text-gray-600 dark:text-gray-300">
                                        {(() => {
                                            const content = previewFile.content || "";
                                            const pageSize = 2000;
                                            if (isReversePreview) {
                                                const totalLen = content.length;
                                                const end = totalLen - ((previewPage - 1) * pageSize);
                                                const start = Math.max(0, end - pageSize);
                                                if (end <= 0) return <div className="text-center opacity-50 mt-10">已无更多内容</div>;
                                                return content.slice(start, end);
                                            } else {
                                                const start = (previewPage - 1) * pageSize;
                                                return content.slice(start, start + pageSize);
                                            }
                                        })()}
                                    </div>
                                </>
                            ) : <div className="text-center text-gray-400 mt-20">点击眼睛图标预览文件内容</div>}
                        </div>
                    </div>
                </div>
            </div>
        )}
        {showSettings && ( <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4"> <div className={`rounded-2xl w-full max-w-lg p-6 shadow-xl ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-800'}`}> <div className="flex justify-between mb-4"><h3 className="font-bold text-xl">设置</h3><button onClick={() => setShowSettings(false)}><X/></button></div> <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2"> {!user && ( <div className="p-4 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl mb-4 border border-indigo-200 dark:border-indigo-800"> <div className="flex items-center gap-3 mb-3"> <div className="p-2 bg-indigo-100 dark:bg-indigo-800 rounded-full text-indigo-600 dark:text-indigo-400"><User size={20}/></div> <div> <div className="font-bold">未登录</div> <div className="text-xs opacity-60">登录后可启用记忆与资源库功能</div> </div> </div> <button onClick={() => { setShowSettings(false); setShowLogin(true); }} className="w-full py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700">立即登录 / 注册</button> </div> )} {user?.isAdmin ? ( <div className="space-y-4"> {editingAssistantId === null ? ( <div className="space-y-2"> {tempAssistants.map((ast) => ( <div key={ast.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors" onClick={() => setEditingAssistantId(ast.id)}> <div className="flex flex-col"><span className="font-bold">{ast.name}</span><span className="text-xs text-gray-400">{ast.provider}</span></div> <ChevronRight size={16} className="text-gray-400"/> </div> ))} <button onClick={() => handleAddAssistant("新助手")} className="w-full py-3 mt-2 border border-dashed border-indigo-300 text-indigo-600 rounded-lg flex items-center justify-center gap-2 hover:bg-indigo-50"><Plus size={16}/> 添加新助手</button> </div> ) : ( (() => { const idx = tempAssistants.findIndex(a => a.id === editingAssistantId); const ast = tempAssistants[idx]; if (!ast) return null; return ( <div className="space-y-4 animate-fade-in"> <button onClick={() => setEditingAssistantId(null)} className="flex items-center text-sm text-gray-500 hover:text-indigo-600 mb-2"><ArrowLeft size={14} className="mr-1"/> 返回列表</button> <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg"> <div className="font-bold text-sm mb-3 flex gap-2 items-center"><span className="w-16">名称:</span><input value={ast.name} onChange={e => handleAssistantNameChange(idx, e.target.value)} className="flex-1 bg-transparent border-b border-indigo-300 outline-none focus:border-indigo-600"/></div> <div className="space-y-3"> <div><label className="text-xs opacity-60">API Key</label><input type="password" className="w-full p-2 rounded border bg-transparent text-sm" value={ast.apiKey} onChange={e => { const n=[...tempAssistants]; n[idx].apiKey=e.target.value; setTempAssistants(n); }}/></div> <div><label className="text-xs opacity-60">Provider</label><select className="w-full p-2 rounded border bg-transparent text-sm" value={ast.provider} onChange={e => { const n=[...tempAssistants]; n[idx].provider=e.target.value; setTempAssistants(n); }}><option value="gemini">Google Gemini</option><option value="doubao">Doubao</option><option value="deepseek">DeepSeek</option><option value="openai-compatible">OpenAI / Compatible</option></select></div> {(ast.provider==='doubao'||ast.provider==='openai-compatible') && <div><label className="text-xs opacity-60">{ast.provider==='doubao'?'Endpoint ID':'Model Name'}</label><input className="w-full p-2 rounded border bg-transparent text-sm" value={ast.modelName||''} onChange={e=>{const n=[...tempAssistants];n[idx].modelName=e.target.value;setTempAssistants(n)}}/></div>} {ast.provider==='openai-compatible' && <div><label className="text-xs opacity-60">Base URL</label><input className="w-full p-2 rounded border bg-transparent text-sm" value={ast.baseUrl||''} onChange={e=>{const n=[...tempAssistants];n[idx].baseUrl=e.target.value;setTempAssistants(n)}}/></div>} <div className="flex justify-end pt-2"> {ast.connectionStatus === 'testing' ? (<div className="flex items-center text-blue-500 text-xs gap-2"><ThinkingCharacter text="连接中..." /></div>) : (<button onClick={()=>handleTestConnection(idx)} className="text-xs bg-green-600 text-white px-3 py-1 rounded">测试连接</button>)} </div> {ast.connectionStatus === 'success' && <div className="text-xs text-green-600 bg-green-50 p-2 rounded">✅ 连接成功</div>} {ast.connectionStatus === 'error' && <div className="text-xs text-red-600 bg-red-50 p-2 rounded">❌ {ast.lastErrorMessage}</div>} </div> </div> </div> ); })() )} </div> ) : <div className="text-center py-8 opacity-50">{user ? "您没有管理员权限，无法配置助手" : "请先登录以配置助手"}</div>} <div className="border-t pt-4 flex gap-2"> <button onClick={handleExport} disabled={isExporting} className="flex-1 py-2 border rounded flex justify-center gap-2 text-sm hover:bg-gray-100">{isExporting ? <Loader2 className="animate-spin"/> : <Download size={16}/>} 导出</button> <label className="flex-1 py-2 border rounded flex justify-center gap-2 text-sm hover:bg-gray-100 cursor-pointer"><Upload size={16}/> 恢复 <input type="file" accept=".json" className="hidden" onChange={handleImport}/></label> </div> {/* ✨ Extra feature: Avatar Reset */} <div className="border-t pt-4"> <button onClick={() => { setAvatarResetTrigger(prev => prev + 1); addToast('info', '小叽已回到屏幕右下角'); setShowSettings(false); }} className="w-full py-2 border border-indigo-200 text-indigo-600 rounded flex justify-center gap-2 text-sm hover:bg-indigo-50"><Anchor size={16}/> 重置小叽位置</button> </div> </div> <div className="p-4 bg-white border-t border-gray-200 text-right flex gap-3 justify-end"> <button onClick={() => setShowSettings(false)} className="px-4 py-2 text-gray-500 text-sm">取消</button> <button onClick={saveSettings} className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold">保存</button> </div> </div> </div> )}
    </div>
  );
}

export default function App() { return <ErrorBoundary><AppContent /></ErrorBoundary>; }