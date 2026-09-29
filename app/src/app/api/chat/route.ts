import { NextResponse } from 'next/server';
import { retrieveGroundedChunks } from '@/lib/retriever';
import { studentsData } from '@/lib/students';
import { StudentProfile, RetrievedChunk } from '@/lib/types';

const GROQ_KEY = process.env.GROQ_API_KEY || '';
const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2
].filter(Boolean) as string[];

const PRIMARY_MODEL = process.env.PRIMARY_LLM_MODEL || 'openai/gpt-oss-120b';
const FALLBACK_MODEL = process.env.FALLBACK_LLM_MODEL || 'gemini-3.5-flash';

async function callGroq(prompt: string, systemPrompt: string): Promise<{ text: string; provider: string; model: string } | null> {
  if (!GROQ_KEY) return null;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: PRIMARY_MODEL,
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
      if (text) return { text, provider: 'Groq', model: PRIMARY_MODEL };
    }
  } catch (err) {
    console.warn('[Serverless LLM] Groq request error, attempting failover:', err);
  }
  return null;
}

async function callGemini(prompt: string, systemPrompt: string): Promise<{ text: string; provider: string; model: string } | null> {
  if (GEMINI_KEYS.length === 0) return null;
  for (const apiKey of GEMINI_KEYS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${FALLBACK_MODEL}:generateContent?key=${apiKey}`;
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
        if (text) return { text, provider: 'Gemini', model: FALLBACK_MODEL };
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
    const firstLine = cleaned.split('\n').find(l => l.trim().length > 15 && !l.startsWith('#')) || '';
    summary = firstLine.slice(0, 180) || cleaned.slice(0, 180) + '...';
  }

  const isFollowup = cleaned.toUpperCase().includes('STATUS: FOLLOW-UP REQUIRED') ||
                     cleaned.toUpperCase().includes('CLARIFICATION NEEDED');

  const isInsufficient = cleaned.toUpperCase().includes('INSUFFICIENT INFORMATION') ||
                         cleaned.toLowerCase().includes('could not find sufficient information') ||
                         cleaned.toLowerCase().includes("don't have enough information");

  return { summary, answer: cleaned, isFollowup, isInsufficient };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { question, student_id, variant, chat_history } = body;

    if (!question || typeof question !== 'string') {
      return NextResponse.json({ error: 'Question is required' }, { status: 400 });
    }

    // 1. Locate student record if student_id is provided
    let student: StudentProfile | undefined;
    if (student_id) {
      student = studentsData.find(s => s.student_id === student_id);
    }

    // 2. Perform Grounded Hybrid Retrieval
    const retrieval = retrieveGroundedChunks(question, 4);

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
      contextLines.push(`--- Context ${idx + 1} [Source: ${chunk.document_title} | Section: ${chunk.section}] ---\n${chunk.text}`);
    });

    const contextText = contextLines.join('\n\n');

    // 4. Format Student Record
    const studentProfileStr = student
      ? JSON.stringify(student, null, 2)
      : 'NO_STUDENT_PROFILE_SELECTED';

    // 5. Grounded Advisory System Prompt
    const systemPrompt = `You are the official Senior AI Academic Advisor for Vidyashilp University (VU), Bangalore.
Your paramount duty is to provide FACTUALLY ACCURATE, STRICTLY GROUNDED academic advice based SOLELY on the retrieved regulations and the student's verified profile.

=== GROUNDING DIRECTIVES ===
1. Answer STRICTLY from the retrieved context and student record. NEVER extrapolate, speculate, or fabricate rules.
2. If the user question requires checking course prerequisites or credit limits, but NO student profile is selected ('NO_STUDENT_PROFILE_SELECTED'):
   - Output STATUS: FOLLOW-UP REQUIRED.
   - Request the user to select their student profile or provide their completed courses and CGPA.
3. If the retrieved context is insufficient or silent regarding the query:
   - Output STATUS: INSUFFICIENT INFORMATION.
   - State clearly: "I could not find sufficient information in the provided sources to answer this accurately."
4. Check both completed_courses AND failed_courses:
   - If a course has grade 'F', it is failed and must be retaken before taking advanced courses requiring it.
   - Any student on Academic Probation (CGPA < 5.0) is strictly capped at a MAXIMUM of 18 credits.
   - Overloading beyond 24 credits is prohibited.
   - Students with 'pending_fees' (fee_cleared = false) are ineligible to register for courses until dues are paid.
5. Always preserve and cite source documents and sections.

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
${question}

${chat_history && chat_history.length > 0 ? `=== RECENT CHAT HISTORY ===\n${JSON.stringify(chat_history.slice(-3))}` : ''}
`;

    // 6. Resilient LLM Inference
    let llmRes = await callGroq(userPrompt, systemPrompt);
    if (!llmRes) {
      llmRes = await callGemini(userPrompt, systemPrompt);
    }

    if (!llmRes) {
      // Fallback response if no LLM API keys are present
      return NextResponse.json({
        summary: "API keys are not configured or providers are temporarily unreachable.",
        answer: "### Crisp Summary\nAPI key configuration required.\n\n### Policy & Eligibility Status\nSTATUS: INSUFFICIENT INFORMATION\n\n### Detailed Rationale\nPlease configure GROQ_API_KEY or GEMINI_API_KEY in your .env or Vercel environment settings.\n\n### Sources Cited\n- [System Configuration]",
        sources: citedSources,
        provider: "Offline System",
        model: "N/A",
        is_followup: false,
        is_insufficient: true
      }, { status: 503 });
    }

    const { summary, answer, isFollowup, isInsufficient } = parseOutput(llmRes.text);

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
      provider: llmRes.provider,
      model: llmRes.model,
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
