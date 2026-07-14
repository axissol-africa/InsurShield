import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { motion, AnimatePresence } from 'framer-motion';

const SUPPORT_BOT_RESPONSES = [
  "Hello! I'm here to help. What can I assist you with today?",
  "I understand. Let me look into that for you.",
  "Thank you for providing those details. Our team will review and respond shortly.",
  "I've escalated this to a specialist who will assist you within 1 hour.",
  "Is there anything else I can help you with?",
];

let botResponseIndex = 0;
const getNextBotResponse = () => {
  const response = SUPPORT_BOT_RESPONSES[botResponseIndex % SUPPORT_BOT_RESPONSES.length];
  botResponseIndex++;
  return response;
};

export default function ChatWidget() {
  const { chatMessages, chatOpen, unreadCount, addChatMessage, setChatOpen, clearUnread } = useStore();
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (chatOpen && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
    if (chatOpen) clearUnread();
  }, [chatMessages, chatOpen]);

  // Initialize with welcome message if first open
  useEffect(() => {
    if (chatOpen && chatMessages.length === 0) {
      setTimeout(() => {
        addChatMessage({
          senderType: 'support',
          message: "Hi there! 👋 Welcome to InsurShield Support. How can I help you today?",
        });
      }, 500);
    }
  }, [chatOpen]);

  const handleSend = () => {
    if (!inputValue.trim()) return;

    addChatMessage({ senderType: 'customer', message: inputValue.trim() });
    setInputValue('');
    setIsTyping(true);

    // Simulate support agent typing response
    setTimeout(() => {
      setIsTyping(false);
      addChatMessage({
        senderType: 'support',
        message: getNextBotResponse(),
      });
    }, 1500 + Math.random() * 1000);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Chat Panel */}
      <AnimatePresence>
        {chatOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed bottom-24 right-4 md:right-6 z-50 w-[340px] bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col"
            style={{ height: '480px' }}
          >
            {/* Header */}
            <div className="bg-primary p-4 flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                  <span className="material-symbols-outlined text-white">support_agent</span>
                </div>
                <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-400 rounded-full border-2 border-primary" />
              </div>
              <div className="flex-1">
                <p className="text-white font-bold text-[14px]">InsurShield Support</p>
                <p className="text-white/70 text-[11px]">Typically replies within minutes</p>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-white/80 hover:text-white transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
              {chatMessages.map(msg => (
                <div key={msg.id} className={`flex ${msg.senderType === 'customer' ? 'justify-end' : 'justify-start'}`}>
                  {msg.senderType === 'support' && (
                    <div className="w-7 h-7 bg-primary rounded-full flex items-center justify-center mr-2 flex-shrink-0 mt-1">
                      <span className="material-symbols-outlined text-white text-[14px]">support_agent</span>
                    </div>
                  )}
                  <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-[13px] ${msg.senderType === 'customer' ? 'bg-primary text-white rounded-br-sm' : 'bg-white text-on-surface shadow-sm rounded-bl-sm'}`}>
                    <p>{msg.message}</p>
                    <p className={`text-[10px] mt-1 ${msg.senderType === 'customer' ? 'text-white/60' : 'text-secondary'}`}>
                      {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="material-symbols-outlined text-white text-[14px]">support_agent</span>
                  </div>
                  <div className="bg-white shadow-sm px-4 py-2.5 rounded-2xl rounded-bl-sm flex gap-1 items-center">
                    {[0, 1, 2].map(i => (
                      <motion.div key={i} className="w-2 h-2 bg-primary/40 rounded-full" animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.15 }} />
                    ))}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Replies */}
            {chatMessages.length <= 1 && (
              <div className="px-3 py-2 bg-white border-t border-gray-100">
                <div className="flex flex-wrap gap-2">
                  {['File a claim', 'Policy info', 'Premium query', 'Talk to human'].map(q => (
                    <button key={q} onClick={() => { addChatMessage({ senderType: 'customer', message: q }); setIsTyping(true); setTimeout(() => { setIsTyping(false); addChatMessage({ senderType: 'support', message: getNextBotResponse() }); }, 1500); }} className="text-[11px] font-semibold text-primary border border-primary/30 px-3 py-1 rounded-full hover:bg-primary/5 transition-colors">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input */}
            <div className="p-3 bg-white border-t border-gray-100 flex gap-2">
              <input
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                className="flex-1 bg-surface-container-low border border-outline-variant rounded-xl px-3 py-2 text-[13px] focus:ring-2 focus:ring-primary outline-none"
              />
              <button onClick={handleSend} disabled={!inputValue.trim()} className="bg-primary text-white px-3 py-2 rounded-xl hover:bg-primary-container transition-colors disabled:opacity-50">
                <span className="material-symbols-outlined text-[18px]">send</span>
              </button>
            </div>

            {/* WhatsApp Ready Note */}
            <div className="px-3 pb-2 bg-white flex items-center justify-center gap-1">
              <span className="material-symbols-outlined text-gray-400 text-[12px]">lock</span>
              <p className="text-[10px] text-gray-400">Secured · WhatsApp integration ready</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Chat Button */}
      <motion.button
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setChatOpen(!chatOpen)}
        className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-50 w-14 h-14 bg-primary rounded-full shadow-lg hover:shadow-xl flex items-center justify-center transition-shadow"
      >
        <AnimatePresence mode="wait">
          {chatOpen ? (
            <motion.span key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} className="material-symbols-outlined text-white text-2xl">close</motion.span>
          ) : (
            <motion.span key="open" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} className="material-symbols-outlined text-white text-2xl">chat</motion.span>
          )}
        </AnimatePresence>
        {unreadCount > 0 && !chatOpen && (
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
            <span className="text-white text-[10px] font-extrabold">{unreadCount}</span>
          </motion.div>
        )}
      </motion.button>
    </>
  );
}
