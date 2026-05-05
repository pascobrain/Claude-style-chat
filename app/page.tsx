'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, dracula, ghcolors, okaidia } from 'react-syntax-highlighter/dist/esm/styles/prism';
import Editor from 'react-simple-code-editor';
import { 
  Sidebar as SidebarIcon, 
  Plus, 
  Trash2, 
  Send, 
  Code, 
  Play, 
  ChevronDown, 
  Check, 
  PenSquare, 
  MessageSquare,
  Loader2,
  Bot,
  User,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Copy,
  Edit3,
  X,
  Save,
  Check as CheckIcon,
  Settings,
  Menu
} from 'lucide-react';

// --- Types ---
type Role = 'user' | 'assistant' | 'system';

interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
}

interface AdvancedSettings {
  endpoint: string;
  model: string;
  apiKey: string;
}

interface AppState {
  conversations: Record<string, Conversation>;
  activeId: string | null;
  sidebarOpen: boolean;
  settingsOpen: boolean;
  selectedModel: string;
  geminiKeyIndex: number;
  advancedSettings: AdvancedSettings;
  createConversation: () => string;
  setActiveId: (id: string) => void;
  updateConversationTitle: (id: string, title: string) => void;
  deleteConversation: (id: string) => void;
  addMessage: (conversationId: string, message: Message) => void;
  updateMessage: (conversationId: string, messageId: string, content: string) => void;
  editMessageContent: (conversationId: string, messageId: string, content: string) => void;
  toggleSidebar: () => void;
  setSettingsOpen: (open: boolean) => void;
  setModel: (model: string) => void;
  rotateGeminiKey: () => void;
  updateAdvancedSettings: (settings: Partial<AdvancedSettings>) => void;
}

// --- Global API Key ---
const getApiKey = (index: number = 0) => {
  const keys = [
    process.env.NEXT_PUBLIC_GEMINI_API_KEY,
    process.env.NEXT_PUBLIC_GEMINI_API_KEY_FALLBACK1,
    process.env.NEXT_PUBLIC_GEMINI_API_KEY_FALLBACK2
  ];
  return keys[index % keys.length] || keys[0];
};

// --- Zustand Store (Persisted) ---
const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      conversations: {},
      activeId: null,
      sidebarOpen: true,
      settingsOpen: false,
      selectedModel: 'gemini-2.5-flash',
      geminiKeyIndex: 0,
      advancedSettings: {
        endpoint: '',
        model: '',
        apiKey: ''
      },
      
      createConversation: () => {
        const id = crypto.randomUUID();
        const newConv: Conversation = {
          id,
          title: 'New Chat',
          messages: [],
          createdAt: Date.now()
        };
        set((state) => ({
          conversations: { ...state.conversations, [id]: newConv },
          activeId: id
        }));
        return id;
      },
      
      setActiveId: (id) => set({ activeId: id }),
      
      updateConversationTitle: (id, title) => set((state) => ({
        conversations: {
          ...state.conversations,
          [id]: { ...state.conversations[id], title }
        }
      })),
      
      deleteConversation: (id) => set((state) => {
        const { [id]: _, ...rest } = state.conversations;
        return {
          conversations: rest,
          activeId: state.activeId === id ? null : state.activeId
        };
      }),
      
      addMessage: (conversationId, message) => set((state) => {
        const conv = state.conversations[conversationId];
        if (!conv) return state;
        
        // Auto-generate title on first user message
        let newTitle = conv.title;
        if (conv.messages.length === 0 && message.role === 'user') {
          newTitle = message.content.slice(0, 30) + (message.content.length > 30 ? '...' : '');
        }

        return {
          conversations: {
            ...state.conversations,
            [conversationId]: {
              ...conv,
              title: newTitle,
              messages: [...conv.messages, message]
            }
          }
        };
      }),

      updateMessage: (conversationId, messageId, content) => set((state) => {
        const conv = state.conversations[conversationId];
        if (!conv) return state;

        const updatedMessages = conv.messages.map(m => 
          m.id === messageId ? { ...m, content: m.content + content } : m
        );

        return {
          conversations: {
            ...state.conversations,
            [conversationId]: {
              ...conv,
              messages: updatedMessages
            }
          }
        };
      }),

      editMessageContent: (conversationId, messageId, content) => set((state) => {
        const conv = state.conversations[conversationId];
        if (!conv) return state;

        const updatedMessages = conv.messages.map(m => 
          m.id === messageId ? { ...m, content } : m
        );

        return {
          conversations: {
            ...state.conversations,
            [conversationId]: {
              ...conv,
              messages: updatedMessages
            }
          }
        };
      }),

      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setModel: (model) => set({ selectedModel: model }),
      rotateGeminiKey: () => set((state) => ({ geminiKeyIndex: state.geminiKeyIndex + 1 })),
      updateAdvancedSettings: (settings) => set((state) => ({
        advancedSettings: { ...state.advancedSettings, ...settings }
      }))
    }),
    {
      name: 'artifacts-clone-storage',
      partialize: (state) => ({
        conversations: state.conversations,
        selectedModel: state.selectedModel,
        advancedSettings: state.advancedSettings
      })
    }
  )
);

// --- Custom Hook: AI Chat (Gemini direct integration mimicking Vercel AI) ---
const SYSTEM_PROMPT = `You are an expert web developer and assistant. 
When the user asks for a UI component, application, or code element, you MUST provide it as a React component.
Wrap your React code exactly in a markdown code block tagged with \`\`\`artifact-react
Ensure the component is the default export. Use Tailwind CSS for styling.
Do NOT use external libraries other than React, standard React DOM hooks, and lucide-react unless explicitly requested.

Example:
Sure, here is a button:
\`\`\`artifact-react
import React from 'react';
export default function Button() {
  return <button className="bg-blue-500 text-white p-2 rounded">Click</button>;
}
\`\`\`
`;

const useChat = () => {
  const [isLoading, setIsLoading] = useState(false);
  const { addMessage, updateMessage, activeId, conversations, geminiKeyIndex, rotateGeminiKey, selectedModel, advancedSettings } = useAppStore();
  const currentConv = activeId ? conversations[activeId] : null;

  const sendMessage = async (content: string) => {
    if (!activeId || !content.trim()) return;

    // 1. Add User Message
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content, timestamp: Date.now() };
    addMessage(activeId, userMsg);
    
    // 2. Placeholder for Assistant Message
    const assistantMsgId = crypto.randomUUID();
    addMessage(activeId, {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now()
    });

    setIsLoading(true);

    try {
      if (advancedSettings.endpoint || selectedModel.startsWith('groq-')) {
        let endpoint = 'https://api.groq.com/openai/v1/chat/completions';
        let authKey = process.env.NEXT_PUBLIC_GROQ_API_KEY || '';
        let model = selectedModel;

        if (advancedSettings.endpoint) {
          endpoint = advancedSettings.endpoint.endsWith('/chat/completions') 
            ? advancedSettings.endpoint 
            : `${advancedSettings.endpoint.replace(/\/$/, '')}/chat/completions`;
          authKey = advancedSettings.apiKey;
          model = advancedSettings.model || 'gpt-4o';
        } else {
          const modelMap: Record<string, string> = {
            'groq-llama3-70b': 'llama3-70b-8192',
            'groq-llama3-8b': 'llama3-8b-8192',
            'groq-mixtral-8x7b': 'mixtral-8x7b-32768'
          };
          model = modelMap[selectedModel] || 'llama3-8b-8192';
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              ...(currentConv?.messages || []).map(m => ({ role: m.role, content: m.content })),
              { role: 'user', content: content }
            ],
            stream: true
          })
        });

        if (!response.body) throw new Error("No response body");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.replace('data: ', '');
              if (data === '[DONE]') break;
              try {
                const json = JSON.parse(data);
                if (json.choices[0].delta.content) {
                  updateMessage(activeId, assistantMsgId, json.choices[0].delta.content);
                }
              } catch (e) {}
            }
          }
        }
      } else {
        // Prepare history for Gemini
        const history = (currentConv?.messages || []).map(m => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }]
        }));

        const apiKey = getApiKey(geminiKeyIndex);
        const ai = new GoogleGenAI({ apiKey: apiKey || '' });
        const responseStream = await ai.models.generateContentStream({
          model: 'gemini-2.5-flash',
          contents: [...history, { role: 'user', parts: [{ text: content }] }],
          config: { systemInstruction: SYSTEM_PROMPT }
        });

        for await (const chunk of responseStream) {
          if (chunk.text) {
            updateMessage(activeId, assistantMsgId, chunk.text);
          }
        }
      }
    } catch (error: any) {
      console.error(error);
      const isQuotaError = error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED') || error?.status === 429;
      
      if (isQuotaError) {
        rotateGeminiKey();
        updateMessage(activeId, assistantMsgId, `\n\n[INFO] Rate limit reached. Rotating API key... please try again.`);
      } else {
        let errMsg = `\n\nError: ${error instanceof Error ? error.message : 'Failed to reach API'}. Please ensure the NEXT_PUBLIC_GEMINI_API_KEY environment variable is set.`;
        updateMessage(activeId, assistantMsgId, errMsg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return { sendMessage, isLoading, messages: currentConv?.messages || [] };
}

// --- Utilities ---
const extractArtifact = (text: string): string | null => {
  const match = text.match(/```artifact-react\n([\s\S]*?)\n```/);
  return match ? match[1] : null;
};

const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' ');

// --- Components ---

const MessageBubble = ({ msg, activeId }: { msg: Message, activeId: string }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const [copied, setCopied] = useState(false);
  const { editMessageContent } = useAppStore();

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = () => {
    if (draft.trim() !== msg.content) {
      editMessageContent(activeId, msg.id, draft);
    }
    setIsEditing(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex gap-3 relative group", msg.role === 'user' ? "flex-row-reverse" : "")}
    >
      <div className={cn(
        "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-1",
        msg.role === 'user' ? "bg-blue-600 text-[10px] text-white" : "bg-[#D97757]/20 text-[#D97757] border border-[#D97757]/30"
      )}>
        {msg.role === 'user' ? "U" : <Bot size={16} />}
      </div>
      
      <div className={cn(
        "flex flex-col gap-2 max-w-[85%]",
        msg.role === 'user' ? "items-end" : "items-start w-full min-w-0"
      )}>
        <div className={cn(
          "w-full rounded-2xl p-3",
          msg.role === 'user' ? "bg-[#26262F] rounded-tr-none text-sm leading-relaxed text-white w-auto inline-block" : "text-sm text-gray-300 leading-relaxed bg-transparent p-0"
        )}>
          {isEditing ? (
            <div className="flex flex-col gap-2 w-full min-w-[300px]">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="w-full bg-[#15151C] border border-[#26262F] rounded text-[#ECECF1] p-3 min-h-[150px] text-sm outline-none focus:border-[#D97757]"
              />
              <div className="flex justify-end gap-2">
                <button 
                  onClick={() => { setDraft(msg.content); setIsEditing(false); }} 
                  className="px-3 py-1.5 text-xs text-gray-400 hover:text-white flex items-center gap-1 border border-transparent hover:border-[#26262F] rounded transition-colors"
                >
                  <X size={14}/> Cancel
                </button>
                <button 
                  onClick={handleSave} 
                  className="px-3 py-1.5 text-xs bg-[#D97757] text-white rounded flex items-center gap-1 hover:bg-[#c26647] transition-colors"
                >
                  <Save size={14}/> Save
                </button>
              </div>
            </div>
          ) : (
            <>
              {msg.role === 'assistant' ? (
                <div className="prose prose-invert prose-sm max-w-none leading-relaxed prose-pre:bg-transparent prose-pre:p-0">
                  {msg.content.includes('[QUOTA_EXCEEDED]') ? (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-md my-2 flex flex-col gap-3">
                       <p>You have exceeded your free tier API quota.</p>
                       <button onClick={async () => {
                         if (typeof window !== 'undefined' && (window as any).aistudio?.openSelectKey) {
                           await (window as any).aistudio.openSelectKey();
                         } else {
                           alert("API key selection is only available in AI Studio.");
                         }
                       }} className="bg-red-500/20 hover:bg-red-500/30 text-red-300 py-2 px-4 rounded text-sm self-start transition-colors font-medium border border-red-500/30">
                         Configure API Key
                       </button>
                    </div>
                  ) : (
                    <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ node, inline, className, children, ...props }: any) {
                        const match = /language-(\w+)/.exec(className || '');
                        const language = match ? match[1] : '';
                        
                        if (language === 'artifact-react') {
                          return (
                            <div className="italic text-xs text-[#D97757] font-medium my-4 p-3 bg-[#D97757]/10 rounded-md border border-[#D97757]/20 flex items-center gap-2">
                              <Code size={14} />
                              [Artifact generated on the right]
                            </div>
                          );
                        }
                        
                        return !inline && match ? (
                          <div className="rounded-md overflow-hidden my-4 border border-[#26262F]">
                            <div className="bg-[#15151C] px-3 py-1.5 text-xs text-gray-400 border-b border-[#26262F] flex items-center justify-between">
                              <span className="font-mono">{language}</span>
                              <button
                                onClick={() => {
                                  let codeToCopy = String(children).replace(/\n$/, '');
                                  navigator.clipboard.writeText(codeToCopy);
                                }}
                                className="flex items-center gap-1 text-gray-400 hover:text-white transition-colors"
                                title="Copy code"
                              >
                                <Copy size={12} /> <span className="hidden sm:inline">Copy Code</span>
                              </button>
                            </div>
                            <SyntaxHighlighter
                              {...props}
                              style={vscDarkPlus}
                              language={language}
                              PreTag="div"
                              customStyle={{ margin: 0, padding: '1rem', background: '#0B0B0F', fontSize: '13px' }}
                            >
                              {String(children).replace(/\n$/, '')}
                            </SyntaxHighlighter>
                          </div>
                        ) : (
                          <code {...props} className={cn("bg-[#15151C] text-[#D97757] px-1 py-0.5 rounded text-[13px] font-mono whitespace-pre-wrap break-words", className)}>
                            {children}
                          </code>
                        );
                      }
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                  )}
                </div>
              ) : (
                <div className="whitespace-pre-wrap prose prose-invert prose-sm max-w-none leading-relaxed text-white prose-p:text-white prose-headings:text-white prose-strong:text-white prose-a:text-[#D97757] prose-ul:text-white prose-ol:text-white prose-li:text-white">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
              )}
            </>
          )}
        </div>
        
        {/* Actions Toolbar */}
        {!isEditing && msg.role === 'assistant' && (
          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity mt-1">
            <button
              onClick={handleCopy}
              className="text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1.5 text-xs bg-[#15151C] px-2 py-1 rounded border border-[#26262F]"
              title="Copy response"
            >
              {copied ? <CheckIcon size={12} className="text-green-500" /> : <Copy size={12} />}
              {copied ? "Copied!" : "Copy Response"}
            </button>
            <button
              onClick={() => setIsEditing(true)}
              className="text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1.5 text-xs bg-[#15151C] px-2 py-1 rounded border border-[#26262F]"
              title="Edit Message"
            >
              <Edit3 size={12} /> Edit Message
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

// 1. Dropdown Model Selector
const ModelSelector = () => {
  const { selectedModel, setModel } = useAppStore();
  const [isOpen, setIsOpen] = useState(false);
  const models = [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'groq-llama3-70b', name: 'Groq (Llama 3 70B)' },
    { id: 'groq-llama3-8b', name: 'Groq (Llama 3 8B)' },
    { id: 'groq-mixtral-8x7b', name: 'Groq (Mixtral 8x7B)' }
  ];

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#15151C] hover:bg-[#26262F] border border-[#26262F] text-sm text-[#ECECF1] transition-colors"
      >
        <span>{models.find(m => m.id === selectedModel)?.name}</span>
        <ChevronDown size={14} className="text-gray-400" />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-48 bg-[#15151C] border border-[#26262F] rounded-md shadow-lg z-50 py-1">
          {models.map(m => (
            <button
              key={m.id}
              onClick={() => { setModel(m.id); setIsOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-[#ECECF1] hover:bg-[#26262F] flex items-center justify-between"
            >
              {m.name}
              {selectedModel === m.id && <Check size={14} className="text-[#D97757]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// 2. Sidebar Component
const Sidebar = () => {
  const { conversations, activeId, setActiveId, deleteConversation, createConversation, sidebarOpen, setSettingsOpen } = useAppStore();
  
  // Sort by newest
  const sortedConvs = Object.values(conversations).sort((a, b) => b.createdAt - a.createdAt);

  return (
    <AnimatePresence>
      {sidebarOpen && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 260, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="h-full border-r border-[#26262F] bg-[#0B0B0F] flex flex-col overflow-hidden shrink-0"
        >
          <div className="p-4 flex-1 overflow-y-auto">
            <button
              onClick={() => createConversation()}
              className="w-full flex items-center gap-2 px-3 py-2 bg-[#D97757]/10 hover:bg-[#D97757]/20 text-[#D97757] rounded-md transition-colors mb-6 font-medium text-sm border border-[#D97757]/20"
            >
              <Plus size={16} />
              New Artifact
            </button>

            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-3 px-2">History</div>
              {sortedConvs.map(conv => (
                <div
                  key={conv.id}
                  onClick={() => setActiveId(conv.id)}
                  className={cn(
                    "group flex items-center justify-between px-3 py-2 rounded-md cursor-pointer text-sm transition-colors",
                    activeId === conv.id ? "bg-[#26262F] text-white" : "text-gray-400 hover:bg-[#15151C] hover:text-[#ECECF1]"
                  )}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <MessageSquare size={14} className="shrink-0" />
                    <span className="truncate">{conv.title}</span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-all shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          
          <div className="mt-auto p-4 border-t border-[#26262F] flex flex-col gap-3">
             <button
               onClick={() => setSettingsOpen(true)}
               className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors p-2 hover:bg-[#15151C] rounded-md"
             >
               <Settings size={16} /> Advanced Settings
             </button>
            <div className="flex items-center gap-2 text-[11px] text-gray-500 px-2">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              Artifacts Console v1.4.2
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const SettingsModal = () => {
  const { settingsOpen, setSettingsOpen, advancedSettings, updateAdvancedSettings } = useAppStore();
  const [localSettings, setLocalSettings] = useState(advancedSettings);
  const [errorMsg, setErrorMsg] = useState('');

  // Sync state when opened
  useEffect(() => {
    if (settingsOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocalSettings(advancedSettings);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setErrorMsg('');
    }
  }, [settingsOpen, advancedSettings]);

  const handleSave = () => {
    // Validate
    if (localSettings.endpoint && !localSettings.endpoint.startsWith('http')) {
      setErrorMsg('Endpoint must be a valid URL starting with http:// or https://');
      return;
    }
    
    updateAdvancedSettings({ ...localSettings });
    setSettingsOpen(false);
  };

  return (
    <AnimatePresence>
      {settingsOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSettingsOpen(false)}
            className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 h-full w-full max-w-md bg-[#0B0B0F] border-l border-[#26262F] shadow-2xl z-50 flex flex-col"
          >
            <div className="flex items-center justify-between p-6 border-b border-[#26262F]">
              <h2 className="text-lg font-medium text-white flex items-center gap-2">
                <Settings size={20} className="text-[#D97757]" />
                Advanced Settings
              </h2>
              <button 
                onClick={() => setSettingsOpen(false)} 
                className="p-2 text-gray-400 hover:text-white rounded-md hover:bg-[#15151C] transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              <div className="bg-[#15151C]/50 rounded-lg p-4 border border-[#26262F] text-sm text-gray-400 mb-6">
                Configure a custom endpoint to use your own OpenAI-compatible API or alternative LLM provider. This will override the default Gemini/Groq model selection.
              </div>

              {errorMsg && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-md text-sm">
                  {errorMsg}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Custom Endpoint (OpenAI Format)</label>
                  <input
                    type="text"
                    value={localSettings.endpoint}
                    onChange={(e) => setLocalSettings({...localSettings, endpoint: e.target.value})}
                    placeholder="https://api.openai.com/v1"
                    className="w-full bg-[#15151C] border border-[#26262F] rounded-md px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-[#D97757] transition-colors text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">Leave blank to use defaults</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Model ID</label>
                  <input
                    type="text"
                    value={localSettings.model}
                    onChange={(e) => setLocalSettings({...localSettings, model: e.target.value})}
                    placeholder="gpt-4o"
                    className="w-full bg-[#15151C] border border-[#26262F] rounded-md px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-[#D97757] transition-colors text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">API Key</label>
                  <input
                    type="password"
                    value={localSettings.apiKey}
                    onChange={(e) => setLocalSettings({...localSettings, apiKey: e.target.value})}
                    placeholder="sk-..."
                    className="w-full bg-[#15151C] border border-[#26262F] rounded-md px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-[#D97757] transition-colors text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-[#26262F] flex justify-end gap-3 bg-[#0B0B0F]">
              <button 
                onClick={() => setSettingsOpen(false)}
                className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
             >
                Cancel
              </button>
              <button 
                onClick={handleSave}
                className="px-4 py-2 text-sm bg-[#D97757] hover:bg-[#D97757]/80 text-[#000000] font-medium rounded-md transition-colors"
              >
                Save Configuration
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

// 3. Main Application
export default function App() {
  const { 
    activeId, 
    createConversation, 
    toggleSidebar, 
    sidebarOpen 
  } = useAppStore();
  
  const { sendMessage, isLoading, messages } = useChat();
  const [input, setInput] = useState('');
  const [isEnhancing, setIsEnhancing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Responsive layout state
  const [isMobileView, setIsMobileView] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'preview'>('chat');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const handleResize = () => setIsMobileView(window.innerWidth < 768);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Ensure there's an active conversation
  useEffect(() => {
    if (!activeId) {
      createConversation();
    }
  }, [activeId, createConversation]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || isEnhancing) return;
    sendMessage(input);
    setInput('');
    if (isMobileView) setActiveTab('chat');
  };

  const handleEnhancePrompt = async () => {
    if (!input.trim() || isEnhancing) return;
    setIsEnhancing(true);
    try {
      const currentApiKey = getApiKey();
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${currentApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `Take this brief idea for a UI component and expand it into a highly detailed, professional prompt for an AI to generate the React code. Include specific requests for modern UI/UX, Tailwind styling, smooth interactions, and layout. Just return the enhanced prompt text directly without any conversational filler.\n\nIdea: ${input}` }] }]
          })
        }
      );
      if (!response.ok) {
        if (response.status === 429) {
          alert('Quota Exceeded. Please configure your own API key using the Configure API Key button in the header.');
        }
        throw new Error("API Request failed");
      }
      const data = await response.json();
      const enhanced = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (enhanced) setInput(enhanced.trim());
    } catch (error) {
      console.error("Failed to enhance prompt:", error);
    } finally {
      setIsEnhancing(false);
    }
  };

  // Find the latest artifact in the chat history
  const activeArtifactCode = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const code = extractArtifact(messages[i].content);
      if (code) return code;
    }
    return null;
  }, [messages]);

  // View modes
  const showChat = !isMobileView || activeTab === 'chat';
  const showPreview = (!isMobileView && activeArtifactCode) || (isMobileView && activeTab === 'preview');

  return (
    <div className="flex h-screen w-full bg-[#0B0B0F] text-[#ECECF1] font-sans overflow-hidden selection:bg-[#D97757]/30">
      <Sidebar />
      <SettingsModal />

      <main className="flex-1 flex flex-col h-full min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-[#26262F] bg-[#0B0B0F] flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-4">
            <button 
              onClick={toggleSidebar}
              className="p-1.5 text-gray-400 hover:text-white transition-colors"
            >
              <Menu size={20} />
            </button>
            <ModelSelector />
            <button
              onClick={async () => {
                if (typeof window !== 'undefined' && (window as any).aistudio?.openSelectKey) {
                  await (window as any).aistudio.openSelectKey();
                } else {
                  alert("API Key selection is not available outside AI Studio.");
                }
              }}
              className="hidden md:flex items-center gap-2 text-xs bg-[#26262F] hover:bg-[#D97757]/20 text-gray-300 hover:text-[#D97757] px-2.5 py-1.5 rounded transition-colors border border-[#26262F] hover:border-[#D97757]/40 font-medium"
              title="Configure API Key"
            >
              Configure API Key
            </button>
          </div>

          {/* Mobile Tabs */}
          {isMobileView && activeArtifactCode && (
            <div className="flex bg-[#15151C] rounded-md p-1 border border-[#26262F]">
              <button
                onClick={() => setActiveTab('chat')}
                className={cn("px-3 py-1 text-sm rounded-sm transition-colors", activeTab === 'chat' ? "bg-[#26262F] text-white" : "text-gray-400")}
              >
                Chat
              </button>
              <button
                onClick={() => setActiveTab('preview')}
                className={cn("px-3 py-1 text-sm rounded-sm transition-colors", activeTab === 'preview' ? "bg-[#26262F] text-white" : "text-gray-400")}
              >
                Preview
              </button>
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="hidden md:flex w-8 h-8 rounded-full bg-[#D97757] items-center justify-center text-white text-xs font-bold">JD</div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Left Column: Chat */}
          {showChat && (
            <section className={cn("flex flex-col h-full", showPreview ? "w-[380px] border-r border-[#26262F] shrink-0" : "w-full max-w-3xl mx-auto")}>
              
              {/* Message List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-20 scroll-smooth">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center px-4">
                    <div className="w-12 h-12 bg-[#D97757]/10 rounded-xl flex items-center justify-center mb-4 text-[#D97757]">
                      <PenSquare size={24} />
                    </div>
                    <h2 className="text-xl font-semibold mb-2">What shall we build?</h2>
                    <p className="text-gray-400 max-w-sm text-sm">
                      Describe a UI component or app, and I&apos;ll generate the React code and render it instantly as an artifact.
                    </p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <MessageBubble key={msg.id} msg={msg} activeId={activeId!} />
                  ))
                )}
                {isLoading && (
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-[#D97757]/20 text-[#D97757] flex items-center justify-center shrink-0">
                      <Loader2 size={16} className="animate-spin" />
                    </div>
                    <div className="flex items-center text-gray-400 text-sm">Thinking...</div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <div className="p-4 border-t border-[#26262F]">
                <form 
                  onSubmit={handleSubmit}
                  className="bg-[#15151C] border border-[#26262F] rounded-lg p-2 flex flex-col gap-2 focus-within:border-[#D97757]/50 transition-all"
                >
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmit(e);
                      }
                    }}
                    placeholder="Message artifact..."
                    className="bg-transparent text-sm resize-none outline-none p-2 h-16 w-full text-[#ECECF1] placeholder-gray-500"
                  />
                  <div className="flex items-center justify-between px-1">
                    <button
                      type="button"
                      onClick={handleEnhancePrompt}
                      disabled={!input.trim() || isLoading || isEnhancing}
                      className="flex items-center gap-1.5 text-xs text-[#D97757] font-medium hover:bg-[#D97757]/10 px-2 py-1 rounded disabled:opacity-50 transition-colors"
                    >
                      {isEnhancing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} 
                      Enhance
                    </button>
                    <button
                      type="submit"
                      disabled={!input.trim() || isLoading || isEnhancing}
                      className="bg-[#D97757] text-white p-1.5 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#c26647] transition-colors relative flex items-center justify-center"
                    >
                      <Send size={16} className={isLoading ? "opacity-0" : "opacity-100"} />
                      {isLoading && <Loader2 size={16} className="absolute animate-spin" />}
                    </button>
                  </div>
                </form>
                <div className="text-center mt-2 text-[11px] text-gray-500">
                  Claude Artifacts Clone • Next.js App Router simulation
                </div>
              </div>
            </section>
          )}

          {/* Right Column: Artifact Preview */}
          {showPreview && activeArtifactCode && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex-1 bg-[#15151C] flex flex-col min-w-0"
            >
              <ArtifactViewer code={activeArtifactCode} />
            </motion.div>
          )}

        </div>
      </main>
    </div>
  );
}

const syntaxThemes = {
  vscDarkPlus: { name: 'VS Code Dark', style: vscDarkPlus, bg: '#1e1e1e', color: '#ECECF1' },
  dracula: { name: 'Dracula', style: dracula, bg: '#282a36', color: '#f8f8f2' },
  okaidia: { name: 'Monokai', style: okaidia, bg: '#272822', color: '#f8f8f2' },
  ghcolors: { name: 'GitHub', style: ghcolors, bg: '#ffffff', color: '#333333' }
};

// 4. Artifact Viewer (Sandpack)
function ArtifactViewer({ code: initialCode, activeId }: { code: string, activeId?: string }) {
  const [viewMode, setViewMode] = useState<'preview' | 'code' | 'explanation'>('preview');
  const [explanation, setExplanation] = useState('');
  const [isExplaining, setIsExplaining] = useState(false);
  const [themeKey, setThemeKey] = useState<keyof typeof syntaxThemes>('vscDarkPlus');
  const [localCode, setLocalCode] = useState(initialCode);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalCode(initialCode);
  }, [initialCode]);

  useEffect(() => {
    const update = () => {
      setExplanation('');
      if (viewMode === 'explanation') setViewMode('preview');
    };
    update();
  }, [initialCode]);

  const fetchExplanation = async () => {
    setViewMode('explanation');
    if (explanation || isExplaining) return;
    setIsExplaining(true);
    try {
      const currentApiKey = getApiKey();
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${currentApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `Explain how the following React code works in 3-4 concise bullet points, focusing on state and logic. Then, suggest 2 specific feature additions. Format as clean text without complex markdown.\n\nCode:\n${localCode}` }] }]
          })
        }
      );
      if (!response.ok) {
        if (response.status === 429) {
          alert('Quota Exceeded. Please configure your own API key using the Configure API Key button in the header.');
        }
        throw new Error("API Request failed");
      }
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) setExplanation(text);
    } catch (error) {
      console.error("Failed to fetch explanation:", error);
      setExplanation("Error: Failed to generate explanation.");
    } finally {
      setIsExplaining(false);
    }
  };

  const processCode = (rawCode: string) => {
    // Determine the component name
    const exportMatch = rawCode.match(/export\s+default\s+(?:function\s+)?(\w+)/);
    const compName = exportMatch ? exportMatch[1] : 'App';
    
    // We keep all imports but add the mount script at the end.
    let processed = rawCode;
    
    // Ensure React is in scope for JSX
    if (!processed.includes('import React')) {
      processed = `import React from "react";\n` + processed;
    }
    
    // We'll let the HTML import map handle bare imports (e.g. lucide-react)
    
    processed += `\n\nimport { createRoot } from "react-dom/client";\nconst __rootContainer = document.getElementById("root");\nif (__rootContainer) {\n  const __root = createRoot(__rootContainer);\n  __root.render(React.createElement(${compName}));\n}\n`;
    return processed;
  };

  const htmlTemplate = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Artifact</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="importmap">
      {
        "imports": {
          "react": "https://esm.sh/react@18.2.0",
          "react-dom": "https://esm.sh/react-dom@18.2.0",
          "react-dom/client": "https://esm.sh/react-dom@18.2.0/client",
          "lucide-react": "https://esm.sh/lucide-react@0.368.0?deps=react@18.2.0",
          "recharts": "https://esm.sh/recharts@2.12.3?deps=react@18.2.0,react-dom@18.2.0"
        }
      }
    </script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <style>
      body { background-color: #15151C; color: #ECECF1; margin: 0; padding: 1rem; font-family: ui-sans-serif, system-ui, sans-serif; }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 4px; }
      ::-webkit-scrollbar-thumb:hover { background: #52525b; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="text/babel" data-type="module" data-presets="react,typescript">
      ${processCode(localCode)}
    </script>
  </body>
</html>
`;

  return (
    <div className="flex flex-col h-full">
      {/* Top Bar */}
      <div className="h-12 border-b border-[#26262F] flex items-center justify-between px-4 bg-[#15151C]">
        <div className="flex bg-[#0B0B0F] p-0.5 rounded border border-[#26262F]">
          <button
            onClick={() => setViewMode('preview')}
            className={cn("px-4 py-1 text-xs font-semibold rounded-sm transition-colors", viewMode === 'preview' ? "bg-[#26262F] text-white" : "text-gray-500 hover:text-gray-300")}
          >
            Preview
          </button>
          <button
            onClick={() => setViewMode('code')}
            className={cn("px-4 py-1 text-xs font-semibold rounded-sm transition-colors", viewMode === 'code' ? "bg-[#26262F] text-white" : "text-gray-500 hover:text-gray-300")}
          >
            Code
          </button>
        </div>
        <div className="flex items-center gap-3">
          {viewMode === 'code' && (
            <select
              value={themeKey}
              onChange={(e) => setThemeKey(e.target.value as any)}
              className="bg-[#0B0B0F] border border-[#26262F] text-gray-300 text-xs rounded px-2 py-1 outline-none focus:border-[#D97757]"
            >
              {Object.entries(syntaxThemes).map(([key, { name }]) => (
                <option key={key} value={key}>{name}</option>
              ))}
            </select>
          )}
          <button
            onClick={fetchExplanation}
            className={cn("flex items-center gap-2 px-3 py-1.5 text-xs font-medium transition-colors border rounded", viewMode === 'explanation' ? "bg-[#D97757] text-white border-[#D97757]" : "bg-[#D97757]/10 text-[#D97757] border-[#D97757]/20 hover:bg-[#D97757]/20")}
          >
            <Sparkles size={14} /> Explain Component
          </button>
        </div>
      </div>

      {/* Workspace */}
      <div className="flex-1 p-8 overflow-hidden bg-[#15151C]">
        <div className="w-full h-full bg-[#0B0B0F] rounded-xl border border-[#26262F] shadow-2xl flex flex-col overflow-hidden relative">
          {viewMode === 'preview' && (
            <iframe 
              srcDoc={htmlTemplate} 
              className="w-full h-full border-none bg-transparent"
              title="Live Preview"
              sandbox="allow-scripts allow-same-origin"
            />
          )}
          {viewMode === 'code' && (
            <div className="h-full w-full overflow-auto bg-[#0B0B0F]" style={{ background: syntaxThemes[themeKey].bg }}>
              <Editor
                value={localCode}
                onValueChange={code => setLocalCode(code)}
                highlight={code => (
                  <SyntaxHighlighter
                    style={syntaxThemes[themeKey].style}
                    language="tsx"
                    customStyle={{ margin: 0, padding: 0, background: 'transparent' }}
                  >
                    {code}
                  </SyntaxHighlighter>
                )}
                padding={24}
                className="min-h-full outline-none"
                textareaClassName="focus:outline-none focus:ring-0"
                style={{
                  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                  fontSize: 14,
                  minHeight: '100%',
                  color: syntaxThemes[themeKey].color
                }}
              />
            </div>
          )}
          {viewMode === 'explanation' && (
            <div className="h-full w-full overflow-auto p-6 bg-[#0B0B0F] text-[#ECECF1] leading-relaxed">
              <div className="max-w-2xl mx-auto">
                <h3 className="text-lg font-semibold mb-4 text-[#D97757] flex items-center gap-2">
                  <Sparkles size={18} /> Code Analysis
                </h3>
                {isExplaining ? (
                  <div className="flex items-center gap-3 text-gray-400">
                    <Loader2 size={16} className="animate-spin" />
                    Analyzing component structure and logic...
                  </div>
                ) : (
                  <div className="prose prose-invert prose-sm max-w-none">
                    {explanation.split('\n').map((line, i) => (
                      <p key={i} className="mb-2 min-h-[1rem]">{line}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
