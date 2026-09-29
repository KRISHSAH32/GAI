'use client';

import React, { useState, useEffect } from 'react';
import { StudentProfile, RetrievedChunk } from '@/lib/types';

interface Message {
  role: 'user' | 'assistant';
  summary?: string;
  content: string;
  sources?: string[];
  provider?: string;
  model?: string;
  is_followup?: boolean;
  is_insufficient?: boolean;
  pipeline_trace?: any[];
  retrieved_chunks?: RetrievedChunk[];
}

export default function Home() {
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string>('SYN-0001');
  const [variant, setVariant] = useState<string>('v3');
  const [openDetailsIndex, setOpenDetailsIndex] = useState<number | null>(null);
  const [openChunksIndex, setOpenChunksIndex] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      summary: 'Welcome to Vidyashilp University AI Academic Advisor (Improved RAG)!',
      content: 'Hello! I am your AI Academic Advisor for Vidyashilp University. All my answers are strictly grounded in official university regulations, course catalogues, and verified student records. Select a student profile or ask any question regarding course registration, prerequisite rules, credit load limits, or retake regulations.',
      provider: 'System',
      model: 'Grounded-RAG'
    }
  ]);
  const [inputQuery, setInputQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    fetch('/api/students')
      .then(res => res.json())
      .then(data => setStudents(data))
      .catch(err => console.log('Error loading students:', err));
  }, []);

  const handleSendMessage = async (customQuery?: string) => {
    const q = customQuery || inputQuery;
    if (!q.trim()) return;

    const userMsg: Message = { role: 'user', content: q };
    setMessages(prev => [...prev, userMsg]);
    if (!customQuery) setInputQuery('');
    setLoading(true);

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          student_id: selectedStudentId === 'none' ? null : selectedStudentId,
          variant: variant,
          chat_history: messages.map(m => ({ role: m.role, content: m.content }))
        })
      });

      if (!resp.ok) {
        let errMsg = 'API request failed';
        try {
          const errData = await resp.json();
          errMsg = errData.summary || errData.answer || errData.detail || errData.error || errMsg;
        } catch (_) {}
        throw new Error(errMsg);
      }

      const data = await resp.json();
      const assistantMsg: Message = {
        role: 'assistant',
        summary: data.summary || 'Summary unavailable.',
        content: data.answer,
        sources: data.sources || [],
        provider: data.provider || 'Groq',
        model: data.model || 'openai/gpt-oss-120b',
        is_followup: data.is_followup,
        is_insufficient: data.is_insufficient,
        pipeline_trace: data.pipeline_trace,
        retrieved_chunks: data.retrieved_chunks || []
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `⚠️ Error: ${err.message || 'Could not connect to advisory service.'}` }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const toggleDetails = (idx: number) => {
    setOpenDetailsIndex(openDetailsIndex === idx ? null : idx);
  };

  const toggleChunks = (idx: number) => {
    setOpenChunksIndex(openChunksIndex === idx ? null : idx);
  };

  const currentStudent = students.find(s => s.student_id === selectedStudentId);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Header Bar */}
      <header className="border-b border-slate-200 bg-white px-6 py-3.5 flex items-center justify-between sticky top-0 z-50 shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white font-black text-lg shadow-sm">
            VU
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 leading-tight">
              Vidyashilp University
            </h1>
            <p className="text-xs text-slate-500 font-medium">
              AI Academic Advisor (Improved RAG Engine)
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
          <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
          <span>Verified Grounded Engine (Vercel Serverless)</span>
        </div>
      </header>

      {/* Main Content Layout */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Left Sidebar */}
        <aside className="lg:col-span-1 space-y-5">
          {/* Student Selector */}
          <div className="light-panel p-5 rounded-2xl space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Student Profile Selector
            </h2>
            <select
              value={selectedStudentId}
              onChange={e => setSelectedStudentId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="none">-- General Query (No Student Selected) --</option>
              {students.map(s => (
                <option key={s.student_id} value={s.student_id}>
                  {s.student_id}: {s.name} ({s.programme})
                </option>
              ))}
            </select>

            {currentStudent ? (
              <div className="bg-slate-50/80 p-3.5 rounded-xl space-y-2 text-xs border border-slate-200">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Name:</span>
                  <span className="font-bold text-slate-900">{currentStudent.name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">CGPA:</span>
                  <span className="font-bold text-emerald-700">{currentStudent.cgpa} / 10.0</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Credits Done:</span>
                  <span className="font-semibold text-blue-700">{currentStudent.credits_completed} cr</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Fee Status:</span>
                  <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                    currentStudent.fee_cleared ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                  }`}>
                    {currentStudent.fee_cleared ? 'CLEARED' : 'PENDING'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Academic Status:</span>
                  <span className={`font-bold capitalize px-1.5 py-0.5 rounded text-[10px] ${
                    currentStudent.status === 'academic_probation'
                      ? 'bg-rose-100 text-rose-800 border border-rose-200'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}>
                    {currentStudent.status.replace('_', ' ')}
                  </span>
                </div>
                {currentStudent.failed_courses && currentStudent.failed_courses.length > 0 && (
                  <div className="pt-1 border-t border-slate-200 text-rose-700 font-semibold">
                    Failed Courses: {currentStudent.failed_courses.map(c => c.code).join(', ')} (Must retake)
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                No student profile attached. Queries requiring student course history will ask for clarification.
              </p>
            )}
          </div>

          {/* Engine Selector */}
          <div className="light-panel p-5 rounded-2xl space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Advisor Engine Mode
            </h2>
            <select
              value={variant}
              onChange={e => setVariant(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="v3">✨ Grounded RAG + CoT (Recommended)</option>
              <option value="agentic">🤖 Multi-Agent Guardrail Trace</option>
            </select>
          </div>

          {/* Sample Prompts */}
          <div className="light-panel p-5 rounded-2xl space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Representative Test Queries
            </h2>
            <div className="space-y-2">
              <button
                onClick={() => handleSendMessage('Can I register for AI401 Advanced Machine Learning next semester?')}
                className="w-full text-left bg-slate-50 hover:bg-slate-100 p-2.5 rounded-xl text-xs font-medium text-slate-700 border border-slate-200 transition"
              >
                1. Check AI401 Prerequisites
              </button>
              <button
                onClick={() => handleSendMessage('Can I take CS305 Deep Learning Systems in Spring 2027?')}
                className="w-full text-left bg-slate-50 hover:bg-slate-100 p-2.5 rounded-xl text-xs font-medium text-slate-700 border border-slate-200 transition"
              >
                2. Check Seasonal Course Offering
              </button>
              <button
                onClick={() => handleSendMessage('What happens if my attendance in a course drops to 60%?')}
                className="w-full text-left bg-slate-50 hover:bg-slate-100 p-2.5 rounded-xl text-xs font-medium text-slate-700 border border-slate-200 transition"
              >
                3. Attendance Shortage Policy
              </button>
              <button
                onClick={() => handleSendMessage('What is the exact dorm room assignment procedure and laundry machine fee?')}
                className="w-full text-left bg-slate-50 hover:bg-slate-100 p-2.5 rounded-xl text-xs font-medium text-slate-700 border border-slate-200 transition"
              >
                4. Out-of-Domain Guardrail Test
              </button>
              <button
                onClick={() => handleSendMessage('Can I declare a minor in Law while having a 2.05 GPA?')}
                className="w-full text-left bg-slate-50 hover:bg-slate-100 p-2.5 rounded-xl text-xs font-medium text-slate-700 border border-slate-200 transition"
              >
                5. Law Minor Eligibility
              </button>
            </div>
          </div>
        </aside>

        {/* Right Chat Interface */}
        <section className="lg:col-span-3">
          <div className="light-panel rounded-2xl flex flex-col h-[750px] shadow-sm">
            {/* Chat Messages */}
            <div className="flex-1 p-6 overflow-y-auto space-y-6 custom-scrollbar bg-slate-50/50">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-3xl rounded-2xl p-4 text-sm leading-relaxed space-y-3 ${
                      m.role === 'user'
                        ? 'bg-blue-600 text-white rounded-br-none shadow-sm font-medium'
                        : 'bg-white text-slate-800 border border-slate-200 rounded-bl-none shadow-sm'
                    }`}
                  >
                    {/* User Query */}
                    {m.role === 'user' && (
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    )}

                    {/* Assistant Message */}
                    {m.role === 'assistant' && (
                      <div className="space-y-3">
                        {/* Crisp Direct Summary Box */}
                        {m.summary && (
                          <div className="bg-blue-50/90 border border-blue-200 p-3.5 rounded-xl text-slate-900 text-sm font-semibold shadow-2xs">
                            <span className="text-blue-700 font-bold block mb-1 text-xs uppercase tracking-wider">
                              💡 Crisp Advisor Summary
                            </span>
                            <p className="leading-snug">{m.summary}</p>
                          </div>
                        )}

                        {/* Expandable Step-by-Step Rationale Accordion */}
                        <div>
                          <button
                            onClick={() => toggleDetails(idx)}
                            className="flex items-center space-x-1.5 text-xs font-bold text-slate-600 hover:text-blue-700 transition py-1 focus:outline-none"
                          >
                            <span>{openDetailsIndex === idx ? '▲ Hide Step-by-Step Rationale' : '▼ View Full Step-by-Step Rationale'}</span>
                          </button>

                          {openDetailsIndex === idx && (
                            <div className="mt-2 bg-slate-50 border border-slate-200 p-3.5 rounded-xl text-xs text-slate-700 space-y-2 whitespace-pre-wrap leading-relaxed font-sans">
                              {m.content}
                            </div>
                          )}
                        </div>

                        {/* Retrieved Evidence Chunks Accordion */}
                        {m.retrieved_chunks && m.retrieved_chunks.length > 0 && (
                          <div>
                            <button
                              onClick={() => toggleChunks(idx)}
                              className="flex items-center space-x-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-900 transition py-1 focus:outline-none"
                            >
                              <span>{openChunksIndex === idx ? '▲ Hide Retrieved Evidence' : `▼ View Grounded Source Evidence (${m.retrieved_chunks.length} chunks)`}</span>
                            </button>

                            {openChunksIndex === idx && (
                              <div className="mt-2 space-y-2">
                                {m.retrieved_chunks.map((chk, cidx) => (
                                  <div key={cidx} className="bg-emerald-50/60 border border-emerald-200 p-3 rounded-xl text-xs space-y-1">
                                    <div className="flex justify-between items-center text-[11px] font-bold text-emerald-900">
                                      <span>[{chk.source}] {chk.section}</span>
                                      <span className="bg-emerald-200 px-1.5 py-0.5 rounded text-emerald-800">Score: {chk.score}</span>
                                    </div>
                                    <p className="text-slate-700 whitespace-pre-wrap">{chk.text}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Multi-Agent Trace */}
                        {m.pipeline_trace && (
                          <div className="bg-purple-50/80 p-3 rounded-xl border border-purple-200 text-xs space-y-1.5 mt-2">
                            <p className="font-bold text-purple-900">🤖 Multi-Agent Execution Trace:</p>
                            {m.pipeline_trace.map((t: any, tidx: number) => (
                              <div key={tidx} className="text-purple-800 pl-2 border-l-2 border-purple-400">
                                <strong className="text-purple-950">{t.agent}:</strong> {t.output}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Follow-up question indicator */}
                        {m.is_followup && (
                          <div className="bg-amber-50 border border-amber-200 p-2.5 rounded-xl text-amber-800 text-xs flex items-center space-x-2 font-medium">
                            <span>❓</span>
                            <span><strong>Clarification Needed:</strong> Please select a student profile or specify your completed courses to verify prerequisites.</span>
                          </div>
                        )}

                        {/* Insufficient information guardrail badge */}
                        {m.is_insufficient && (
                          <div className="bg-rose-50 border border-rose-200 p-2.5 rounded-xl text-rose-800 text-xs flex items-center space-x-2 font-medium">
                            <span>🛡️</span>
                            <span><strong>Grounding Policy:</strong> Factually withheld — query topic is outside official university academic regulations.</span>
                          </div>
                        )}

                        {/* Cited Sources */}
                        {m.sources && m.sources.length > 0 && (
                          <div className="pt-2 border-t border-slate-100 text-xs text-slate-500 flex flex-wrap gap-1.5">
                            <span className="font-semibold text-slate-700">Sources Cited:</span>
                            {m.sources.map((src, sidx) => (
                              <span key={sidx} className="bg-slate-100 border border-slate-200 px-2 py-0.5 rounded text-blue-700 font-mono text-[11px]">
                                {src}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {m.provider && (
                    <span className="text-[10px] text-slate-400 mt-1 px-2 font-medium">
                      Engine: {m.provider} ({m.model})
                    </span>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex items-center space-x-2 text-xs text-slate-600 bg-white p-3.5 rounded-xl w-fit border border-slate-200 shadow-sm">
                  <div className="w-2.5 h-2.5 bg-blue-600 rounded-full animate-ping"></div>
                  <span className="font-medium">Retrieving regulations & auditing student record...</span>
                </div>
              )}
            </div>

            {/* Chat Input Bar */}
            <div className="p-4 border-t border-slate-200 bg-white rounded-b-2xl">
              <form
                onSubmit={e => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="flex space-x-3"
              >
                <input
                  type="text"
                  value={inputQuery}
                  onChange={e => setInputQuery(e.target.value)}
                  placeholder="Ask regarding course prerequisites, credit limits, retake rules, or attendance policies..."
                  className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-xl text-sm transition shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  Send
                </button>
              </form>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
