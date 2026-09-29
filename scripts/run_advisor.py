"""
CLI and Standalone Runner for Vidyashilp University Improved RAG Advisor.
Executes queries locally using ImprovedHybridRetriever and Resilient LLM Inference.
"""

import os
import sys
import json
import requests
from dotenv import load_dotenv

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Ensure root of rag-improved is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from retrieval.hybrid_retriever import ImprovedHybridRetriever

# Load environment variables
load_dotenv()

GROQ_KEY = os.getenv("GROQ_API_KEY", "")
GEMINI_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GEMINI_API_KEY_1", "")
PRIMARY_MODEL = os.getenv("PRIMARY_LLM_MODEL", "openai/gpt-oss-120b")
FALLBACK_MODEL = os.getenv("FALLBACK_LLM_MODEL", "gemini-3.5-flash")

GEMINI_KEYS = [k for k in [
    os.getenv("GEMINI_API_KEY"),
    os.getenv("GEMINI_API_KEY_1"),
    os.getenv("GEMINI_API_KEY_2")
] if k]

STUDENTS_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "student_profiles", "students.json")

class StandaloneRAGAdvisor:
    def __init__(self):
        self.retriever = ImprovedHybridRetriever()
        self.students = self._load_students()

    def _load_students(self):
        if os.path.exists(STUDENTS_PATH):
            with open(STUDENTS_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                return {s["student_id"]: s for s in data}
        return {}

    def call_groq(self, prompt, system_prompt):
        if not GROQ_KEY:
            return None
        try:
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {GROQ_KEY}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": PRIMARY_MODEL,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.05,
                "max_tokens": 1024
            }
            resp = requests.post(url, headers=headers, json=payload, timeout=12)
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "text": data["choices"][0]["message"]["content"],
                    "provider": "Groq",
                    "model": PRIMARY_MODEL
                }
            elif resp.status_code == 429:
                import time
                time.sleep(2.5)
                resp_retry = requests.post(url, headers=headers, json=payload, timeout=12)
                if resp_retry.status_code == 200:
                    data = resp_retry.json()
                    return {
                        "text": data["choices"][0]["message"]["content"],
                        "provider": "Groq",
                        "model": PRIMARY_MODEL
                    }
            else:
                print(f"[Warning] Groq status {resp.status_code}: {resp.text[:120]}")
        except Exception as e:
            print(f"[Warning] Groq call failed: {e}")
        return None

    def call_gemini(self, prompt, system_prompt):
        if not GEMINI_KEYS:
            return None
        import time
        for key in GEMINI_KEYS:
            for attempt in range(2):
                try:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{FALLBACK_MODEL}:generateContent?key={key}"
                    full_prompt = f"{system_prompt}\n\nUser Query:\n{prompt}"
                    headers = {"Content-Type": "application/json"}
                    payload = {
                        "contents": [{"parts": [{"text": full_prompt}]}],
                        "generationConfig": {
                            "temperature": 0.05,
                            "maxOutputTokens": 1024
                        }
                    }
                    resp = requests.post(url, headers=headers, json=payload, timeout=12)
                    if resp.status_code == 200:
                        data = resp.json()
                        return {
                            "text": data["candidates"][0]["content"]["parts"][0]["text"],
                            "provider": "Gemini",
                            "model": FALLBACK_MODEL
                        }
                    elif resp.status_code in [429, 503]:
                        time.sleep(2.0)
                        continue
                    else:
                        print(f"[Warning] Gemini ({key[:8]}...) status {resp.status_code}: {resp.text[:120]}")
                        break
                except Exception as e:
                    print(f"[Warning] Gemini call failed: {e}")
                    time.sleep(1.0)
        return None

    def answer_question(self, question, student_id=None):
        student = self.students.get(student_id) if student_id else None
        
        # 1. Retrieve Chunks
        retrieval = self.retriever.retrieve(question, top_k=4)

        if retrieval["is_out_of_domain"]:
            return {
                "summary": "I could not find sufficient information in the provided sources to answer this accurately.",
                "answer": (
                    "### Crisp Summary\n"
                    "I could not find sufficient information in the provided sources to answer this accurately.\n\n"
                    "### Policy & Eligibility Status\n"
                    "STATUS: INSUFFICIENT INFORMATION\n\n"
                    "### Detailed Rationale\n"
                    "- The topic requested is not covered in the official Vidyashilp University Student Handbook or SOP.\n"
                    "- Under strict grounding directives, the advisor cannot extrapolate or assume unverified campus policies.\n\n"
                    "### Recommended Next Steps\n"
                    "- Please contact University Administration or Campus Life directly for auxiliary non-academic inquiries.\n\n"
                    "### Sources Cited\n"
                    "- [Vidyashilp University Academic Regulations - Policy Boundary]"
                ),
                "sources": ["Vidyashilp University Academic Regulations (Out-of-Domain Guardrail)"],
                "provider": "Deterministic Guardrail",
                "model": "Grounding-Filter",
                "is_followup": False,
                "is_insufficient": True,
                "retrieved_chunks": []
            }

        context_lines = []
        cited_sources = []
        for idx, chunk in enumerate(retrieval["chunks"]):
            tag = f"{chunk['source']} - {chunk['section']}"
            if tag not in cited_sources:
                cited_sources.append(tag)
            context_lines.append(f"--- Context {idx+1} [{chunk['document_title']} | {chunk['section']}] ---\n{chunk['text']}")

        context_str = "\n\n".join(context_lines)
        student_str = json.dumps(student, indent=2) if student else "NO_STUDENT_PROFILE_SELECTED"

        system_prompt = (
            "You are the official Senior AI Academic Advisor for Vidyashilp University (VU), Bangalore.\n"
            "Your paramount duty is to provide FACTUALLY ACCURATE, STRICTLY GROUNDED academic advice based SOLELY on the retrieved regulations and the student's verified profile.\n\n"
            "=== GROUNDING DIRECTIVES ===\n"
            "1. Answer STRICTLY from the retrieved context and student record. NEVER extrapolate, speculate, or fabricate rules.\n"
            "2. If the user question requires checking course prerequisites or credit limits, but NO student profile is selected ('NO_STUDENT_PROFILE_SELECTED'):\n"
            "   - Output STATUS: FOLLOW-UP REQUIRED.\n"
            "   - Request the user to select their student profile or provide their completed courses and CGPA.\n"
            "3. If the retrieved context is insufficient or silent regarding the query:\n"
            "   - Output STATUS: INSUFFICIENT INFORMATION.\n"
            "   - State clearly: 'I could not find sufficient information in the provided sources to answer this accurately.'\n"
            "4. Check both completed_courses AND failed_courses:\n"
            "   - If a course has grade 'F', it is failed and must be retaken before taking advanced courses requiring it.\n"
            "   - Any student on Academic Probation (CGPA < 5.0) is strictly capped at a MAXIMUM of 18 credits.\n"
            "   - Overloading beyond 24 credits is prohibited.\n"
            "   - Students with 'pending_fees' (fee_cleared = false) are ineligible to register for courses until dues are paid.\n"
            "5. Always preserve and cite source documents and sections.\n\n"
            "=== REQUIRED OUTPUT STRUCTURE ===\n"
            "### Crisp Summary\n"
            "[1-2 direct sentences stating the core answer or decision without markdown asterisks]\n\n"
            "### Policy & Eligibility Status\n"
            "[ELIGIBLE / NOT ELIGIBLE / GENERAL REGULATION POLICY / STATUS: INSUFFICIENT INFORMATION / STATUS: FOLLOW-UP REQUIRED]\n\n"
            "### Detailed Rationale\n"
            "- [Point-by-point evidence citing exact course codes, credits, CGPA, and regulation clauses from the context]\n\n"
            "### Recommended Next Steps\n"
            "- [Concrete actionable advice for the student]\n\n"
            "### Sources Cited\n"
            "- [Exact Document Name - Section Title]"
        )

        user_prompt = (
            f"=== RETRIEVED ACADEMIC CONTEXT ===\n{context_str}\n\n"
            f"=== STUDENT RECORD ===\n{student_str}\n\n"
            f"=== STUDENT QUESTION ===\n{question}\n"
        )

        llm_res = self.call_groq(user_prompt, system_prompt)
        if not llm_res:
            llm_res = self.call_gemini(user_prompt, system_prompt)

        if not llm_res:
            return {
                "summary": "LLM API keys not configured or services unreachable.",
                "answer": "Error: Unable to connect to LLM providers.",
                "sources": cited_sources,
                "provider": "Offline",
                "model": "None",
                "is_followup": False,
                "is_insufficient": True
            }

        def sanitize_unicode(text):
            if not text:
                return ""
            replacements = {
                '\u2011': '-', '\u2010': '-', '\u2012': '-', '\u2013': '-', '\u2014': '-',
                '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"',
                '\u202f': ' ', '\xa0': ' ', '\u200b': ''
            }
            for old, new in replacements.items():
                text = text.replace(old, new)
            return text

        raw_text = sanitize_unicode(llm_res["text"])
        summary = ""
        if "### Crisp Summary" in raw_text:
            summary = raw_text.split("### Crisp Summary")[1].split("###")[0].strip().replace("*", "")
        if not summary:
            summary = raw_text[:160] + "..."

        is_followup = "STATUS: FOLLOW-UP REQUIRED" in raw_text.upper() or "CLARIFICATION NEEDED" in raw_text.upper()
        is_insufficient = (
            "STATUS: INSUFFICIENT INFORMATION" in raw_text.upper() or
            "could not find sufficient information" in raw_text.lower() or
            "don't have enough information" in raw_text.lower()
        )

        return {
            "summary": summary,
            "answer": raw_text,
            "sources": cited_sources,
            "provider": llm_res["provider"],
            "model": llm_res["model"],
            "is_followup": is_followup,
            "is_insufficient": is_insufficient,
            "retrieved_chunks": retrieval["chunks"]
        }

if __name__ == "__main__":
    advisor = StandaloneRAGAdvisor()
    test_q = sys.argv[1] if len(sys.argv) > 1 else "Can I register for AI401 Advanced Machine Learning next semester?"
    test_sid = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2].strip() and sys.argv[2].lower() != "none" else None
    print(f"Testing Question: {test_q} (Student: {test_sid or 'None'})")
    res = advisor.answer_question(test_q, student_id=test_sid)
    print("\n--- CRISP SUMMARY ---")
    print(res["summary"])
    print("\n--- FULL ANSWER ---")
    print(res["answer"])
    print("\n--- SOURCES CITED ---")
    for s in res["sources"]:
        print(f"  * {s}")
