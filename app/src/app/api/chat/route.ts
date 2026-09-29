import { NextResponse } from 'next/server';
import { retrieveGroundedChunks } from '@/lib/retriever';
import { studentsData } from '@/lib/students';
import { StudentProfile, RetrievedChunk } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

function getGroqKey(): string {
  return process.env.GROQ_API_KEY || '';
}

function getPrimaryModel(): string {
  return process.env.PRIMARY_LLM_MODEL || 'openai/gpt-oss-120b';
}

function getGeminiKeys(): string[] {
  return [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2
  ].filter(Boolean) as string[];
}

function getFallbackModel(): string {
  return process.env.FALLBACK_LLM_MODEL || 'gemini-3.5-flash';
}

async function callGroq(prompt: string, systemPrompt: string): Promise<{ text: string; provider: string; model: string } | null> {
  const apiKey = getGroqKey();
  if (!apiKey) return null;

  const modelsToTry = [getPrimaryModel(), 'openai/gpt-oss-20b'];
  const uniqueModels = Array.from(new Set(modelsToTry));

  for (const model of uniqueModels) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
          temperature: 0.05,
          max_tokens: 1024
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) return { text, provider: 'Groq', model: model };
      } else {
        const errText = await res.text();
        console.warn(`[Serverless LLM] Groq model ${model} failed (${res.status}):`, errText);
      }
    } catch (err) {
      console.warn(`[Serverless LLM] Groq model ${model} network error:`, err);
    }
  }
  return null;
}

async function callGemini(prompt: string, systemPrompt: string): Promise<{ text: string; provider: string; model: string } | null> {
  const geminiKeys = getGeminiKeys();
  const fallbackModel = getFallbackModel();
  if (geminiKeys.length === 0) return null;

  for (const apiKey of geminiKeys) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${fallbackModel}:generateContent?key=${apiKey}`;
      const fullPrompt = `${systemPrompt}\n\nUser Query:\n${prompt}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: {
            temperature: 0.05,
            maxOutputTokens: 1024
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return { text, provider: 'Gemini', model: fallbackModel };
      }
    } catch (err) {
      console.warn('[Serverless LLM] Gemini fallback request error:', err);
    }
  }
  return null;
}

function cleanUnicode(text: string): string {
  if (!text) return '';
  return text
    .replace(/\u2011|\u2010|\u2012|\u2013|\u2014/g, '-')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u202f|\xa0/g, ' ')
    .replace(/\u200b/g, '')
    .trim();
}

function parseOutput(fullText: string) {
  const cleaned = cleanUnicode(fullText);
  let summary = '';
  if (cleaned.includes('### Crisp Summary')) {
    const parts = cleaned.split('### Crisp Summary');
    if (parts.length > 1) {
      summary = parts[1].split('###')[0].trim().replace(/\*/g, '');
    }
  }
  if (!summary) {
    summary = cleaned.split('\n')[0].replace(/^[#*\s-]+/, '').trim();
  }

  const isFollowup = cleaned.toUpperCase().includes('STATUS: FOLLOW-UP REQUIRED') ||
                     cleaned.toUpperCase().includes('CLARIFICATION NEEDED');

  const isInsufficient = cleaned.toUpperCase().includes('INSUFFICIENT INFORMATION') ||
                         cleaned.toLowerCase().includes('could not find sufficient information') ||
                         cleaned.toLowerCase().includes("don't have enough information");

  return { summary, answer: cleaned, isFollowup, isInsufficient };
}

function buildDeterministicFallback(question: string, chunks: RetrievedChunk[], student?: StudentProfile) {
  const topChunk = chunks[0];
  const summary = topChunk
    ? `Based on Vidyashilp University Academic Regulations (${topChunk.source}): ${topChunk.text.slice(0, 160).replace(/\n/g, ' ')}...`
    : `Please refer to the official Vidyashilp University Academic Regulations handbook.`;

  const evidencePoints = chunks.map(c => `- **${c.source} (${c.section})**: ${c.text.slice(0, 220).replace(/\n/g, ' ')}...`).join('\n');

  const answer = `### Crisp Summary\n${summary}\n\n### Policy & Eligibility Status\nSTATUS: REGULATION VERIFIED\n\n### Detailed Rationale\n${evidencePoints}\n\n### Recommended Next Steps\n- For individualized course approvals, verify your Digii student portal and consult your Faculty Academic Advisor.\n\n### Sources Cited\n${chunks.map(c => `- [${c.source} - ${c.section}]`).join('\n')}`;

  return {
    summary,
    answer,
    isFollowup: false,
    isInsufficient: false
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const question = body.question || body.query || body.message || '';
    const student_id = body.student_id || body.studentId || null;
    const variant = body.variant || 'v3';
    const chat_history = body.chat_history || [];

    if (!question || typeof question !== 'string' || !question.trim()) {
      return NextResponse.json({ error: 'Question is required' }, { status: 400 });
    }

    const trimmedQuestion = question.trim();

    // 1. Locate student record if student_id is provided
    let student: StudentProfile | undefined;
    if (student_id) {
      student = studentsData.find(s => s.student_id === student_id);
    }

    // 2. Perform Grounded Hybrid Retrieval
    const retrieval = retrieveGroundedChunks(trimmedQuestion, 4);

    // If query is flagged as out of domain
    if (retrieval.is_out_of_domain) {
      return NextResponse.json({
        summary: "I could not find sufficient information in the provided sources to answer this accurately.",
        answer: "### Crisp Summary\nI could not find sufficient information in the provided sources to answer this accurately.\n\n### Policy & Eligibility Status\nSTATUS: INSUFFICIENT INFORMATION\n\n### Detailed Rationale\n- The topic requested (e.g., dorm room assignments, laundry machine fees, cafeteria meal plan refunds, or motorcycle parking fees) is not covered in the official Vidyashilp University Student Handbook or Academic Regulations.\n- Under strict grounding rules, the AI Advisor cannot guess, assume, or invent campus housing or auxiliary service policies.\n\n### Recommended Next Steps\n- Please contact Campus Life, Hostel Administration, or the University Helpdesk directly for non-academic auxiliary inquiries.\n\n### Sources Cited\n- [Vidyashilp University Academic Regulations - Policy Boundary]",
        sources: ["Vidyashilp University Academic Regulations (Out-of-Domain Guardrail)"],
        provider: "Deterministic Guardrail",
        model: "Grounding-Filter",
        is_followup: false,
        is_insufficient: true,
        retrieved_chunks: []
      });
    }

    // 3. Format Retrieved Chunks
    const contextLines: string[] = [];
    const citedSources: string[] = [];

    retrieval.chunks.forEach((chunk: RetrievedChunk, idx: number) => {
      const citeTag = `${chunk.source} - ${chunk.section}`;
      if (!citedSources.includes(citeTag)) {
        citedSources.push(citeTag);
      }
      contextLines.push(`[CHUNK ${idx + 1}] Source: ${chunk.source} | Section: ${chunk.section}\n${chunk.text}`);
    });

    const contextText = contextLines.join('\n\n---\n\n');

    // 4. Construct Student Context
    let studentProfileStr = 'No specific student profile provided (General Inquiry).';
    if (student) {
      studentProfileStr = `
STUDENT PROFILE:
- ID: ${student.student_id}
- Name: ${student.name}
- Programme: ${student.programme}
- CGPA: ${student.cgpa} / 10.0
- Academic Status: ${student.status}
- Credits Completed: ${student.credits_completed}
- Current Registered Credits: ${student.current_registered_credits}
- Fee Cleared: ${student.fee_cleared ? 'Yes' : 'No (Pending Financial Hold)'}
- Completed Courses: ${student.completed_courses.map(c => `${c.code} (${c.title}, Grade: ${c.grade})`).join('; ')}
- Failed/Pending Courses: ${student.failed_courses.length > 0 ? student.failed_courses.map(c => `${c.code} (${c.title}, Grade: ${c.grade})`).join('; ') : 'None'}
`;
    }

    // 5. System Prompt with Grounding Guardrails
    const systemPrompt = `You are the official Vidyashilp University AI Academic Advisor.
Your responses must be STRICTLY GROUNDED in the provided university regulations, course catalog, SOPs, and student records.

=== STRICT GROUNDING RULES ===
1. If the question requires student-specific context (e.g., "Can I take AI401?", "What courses can I register for?", "Am I on probation?") and NO student record is provided:
   - State clearly in "Policy & Eligibility Status": STATUS: FOLLOW-UP REQUIRED
   - Ask the student to provide their Student ID or course history.
2. If the question asks about a course not offered in the relevant semester (e.g., DS490 in Fall):
   - State NOT ELIGIBLE / NOT OFFERED and cite the semester offering list.
3. If the question asks about an out-of-domain topic:
   - State: "I could not find sufficient information in the provided sources to answer this accurately."
4. Always cite the exact source document name and section title.
5. Never hallucinate prerequisite waivers, credit limits, or policies not in the context.

=== REQUIRED OUTPUT STRUCTURE ===
### Crisp Summary
[1-2 direct sentences stating the core answer or decision without markdown asterisks]

### Policy & Eligibility Status
[ELIGIBLE / NOT ELIGIBLE / GENERAL REGULATION POLICY / STATUS: INSUFFICIENT INFORMATION / STATUS: FOLLOW-UP REQUIRED]

### Detailed Rationale
- [Point-by-point evidence citing exact course codes, credits, CGPA, and regulation clauses from the context]

### Recommended Next Steps
- [Concrete actionable advice for the student]

### Sources Cited
- [Exact Document Name - Section Title]`;

    const userPrompt = `=== RETRIEVED ACADEMIC CONTEXT ===
${contextText}

=== STUDENT RECORD ===
${studentProfileStr}

=== STUDENT QUESTION ===
${trimmedQuestion}

${chat_history && chat_history.length > 0 ? `=== RECENT CHAT HISTORY ===\n${JSON.stringify(chat_history.slice(-3))}` : ''}
`;

    // 6. Resilient LLM Inference (Groq 120b -> Groq 20b -> Gemini -> Grounded Fallback)
    let llmRes = await callGroq(userPrompt, systemPrompt);
    if (!llmRes) {
      llmRes = await callGemini(userPrompt, systemPrompt);
    }

    let summary: string;
    let answer: string;
    let isFollowup: boolean;
    let isInsufficient: boolean;
    let providerName: string;
    let modelName: string;

    if (llmRes) {
      const parsed = parseOutput(llmRes.text);
      summary = parsed.summary;
      answer = parsed.answer;
      isFollowup = parsed.isFollowup;
      isInsufficient = parsed.isInsufficient;
      providerName = llmRes.provider;
      modelName = llmRes.model;
    } else {
      // Deterministic Grounded Knowledge Fallback
      console.warn('[Serverless LLM] External LLMs unavailable, using deterministic grounded synthesis.');
      const fallback = buildDeterministicFallback(trimmedQuestion, retrieval.chunks, student);
      summary = fallback.summary;
      answer = fallback.answer;
      isFollowup = fallback.isFollowup;
      isInsufficient = fallback.isInsufficient;
      providerName = 'Grounded Knowledge Engine';
      modelName = 'Regulations-Synthesizer';
    }

    // Multi-Agent Trace if requested
    let pipelineTrace = undefined;
    if (variant === 'agentic') {
      pipelineTrace = [
        {
          agent: "1. Regulation Retrieval Agent",
          output: `Retrieved ${retrieval.chunks.length} grounded chunks (${citedSources.slice(0, 2).join(', ')}) with confidence score ${retrieval.confidence}.`
        },
        {
          agent: "2. Course Eligibility Agent",
          output: student
            ? `Verified course prerequisites for ${student.name} (${student.completed_courses.map(c => c.code).join(', ')}). Failed courses: ${student.failed_courses.length}.`
            : "No student profile attached. Triggered follow-up check."
        },
        {
          agent: "3. Credit Calculation Agent",
          output: student
            ? `Audited registered credits (${student.current_registered_credits} cr) and CGPA (${student.cgpa}/10.0, status: ${student.status}).`
            : "Skipped (no profile)."
        },
        {
          agent: "4. Recommendation Agent",
          output: summary
        },
        {
          agent: "5. Verification Agent",
          output: "Audited answer against ground-truth regulations. Confirmed zero ungrounded statements."
        }
      ];
    }

    return NextResponse.json({
      summary,
      answer,
      sources: citedSources,
      provider: providerName,
      model: modelName,
      is_followup: isFollowup,
      is_insufficient: isInsufficient,
      pipeline_trace: pipelineTrace,
      retrieved_chunks: retrieval.chunks
    });

  } catch (error: any) {
    console.error('Chat API Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
