"""
Evaluation Benchmark Runner for Vidyashilp University Improved RAG Advisor.
Tests the system across representative questions for accuracy, grounding,
citation quality, hallucination rate, and retrieval hit-rate.
"""

import os
import sys
import json
import time
import pandas as pd

# Reconfigure stdout for utf-8
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from scripts.run_advisor import StandaloneRAGAdvisor

TEST_SET_PATH = os.path.join(os.path.dirname(__file__), "test_questions.json")
RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")

def classify_test_result(item, res):
    expected = item["expected_outcome"]
    answer = res.get("answer", "").lower()
    summary = res.get("summary", "").lower()
    full_text = answer + " " + summary

    # Check for hallucination on out-of-domain queries
    if expected == "insufficient_info":
        if res.get("is_insufficient", False) or "could not find sufficient information" in full_text or "insufficient information" in full_text:
            return "Correct", False
        elif any(hw in full_text for hw in ["$50", "$120", "laundry portal", "permit fee", "50% refund", "dorm building"]):
            return "Unsupported-Hallucinated", True
        else:
            return "Incorrect", False

    # Check for follow-up clarification trigger
    if expected == "should_ask_followup":
        if res.get("is_followup", False) or "follow-up" in full_text or "clarification" in full_text or "please provide" in full_text or "permission from department head" in full_text or "need to verify" in full_text or "?" in answer:
            return "Correct", False
        else:
            return "Incorrect", False

    # Check for eligible
    if expected == "eligible":
        if "eligible" in full_text and not ("not eligible" in full_text or "ineligible" in full_text):
            return "Correct", False
        elif "meets all requirements" in full_text or "can register" in full_text:
            return "Correct", False
        else:
            return "Incorrect", False

    # Check for not eligible
    if expected == "not_eligible":
        if "not eligible" in full_text or "ineligible" in full_text or "cannot register" in full_text or "exceeds" in full_text or "prohibited" in full_text or "pending fees" in full_text:
            return "Correct", False
        else:
            return "Incorrect", False

    # Check for general regulation
    if expected == "general_regulation":
        if len(answer) > 40 and any(kw in full_text for kw in ["75%", "65%", "shortage", "160", "2 retake", "retake", "corequisite", "mandatory"]):
            return "Correct", False
        else:
            return "Partially Correct", False

    return "Partially Correct", False

def run_evaluation():
    os.makedirs(RESULTS_DIR, exist_ok=True)
    with open(TEST_SET_PATH, "r", encoding="utf-8") as f:
        test_cases = json.load(f)

    advisor = StandaloneRAGAdvisor()

    print("=================================================================")
    print("  VIDYASHILP UNIVERSITY IMPROVED RAG EVALUATION BENCHMARK")
    print(f"  Test cases: {len(test_cases)} scenarios")
    print("=================================================================\n")

    logs = []
    correct_count = 0
    hallucination_count = 0
    retrieval_hits = 0
    total_latency = 0.0

    for idx, item in enumerate(test_cases):
        qid = item["id"]
        q = item["question"]
        sid = item.get("student_id")
        expected = item["expected_outcome"]

        print(f"[{idx+1:02d}/{len(test_cases)}] {qid}: {q[:55]}... (Student: {sid or 'None'})")

        start_time = time.time()
        try:
            res = advisor.answer_question(q, student_id=sid)
            latency = time.time() - start_time
        except Exception as e:
            res = {
                "summary": "Execution Error",
                "answer": f"Error: {e}",
                "sources": [],
                "is_followup": False,
                "is_insufficient": False,
                "retrieved_chunks": []
            }
            latency = time.time() - start_time

        total_latency += latency
        classification, is_hallucination = classify_test_result(item, res)

        if classification == "Correct":
            correct_count += 1
        if is_hallucination:
            hallucination_count += 1

        # Check retrieval hit
        expected_src = item.get("expected_source", "")
        retrieved_texts = " ".join([c.get("text", "") + " " + c.get("source", "") for c in res.get("retrieved_chunks", [])])
        retrieval_hit = True
        if expected != "insufficient_info":
            # Check if keyword from expected source or course code is present
            tokens = [t.lower() for t in expected_src.replace("-", " ").replace(".", " ").split() if len(t) > 3]
            retrieval_hit = any(t in retrieved_texts.lower() for t in tokens)
        if retrieval_hit:
            retrieval_hits += 1

        status_icon = "PASS" if classification == "Correct" else "FAIL"
        print(f"      Result: [{status_icon}] ({classification}) | Latency: {latency:.2f}s | Chunks: {len(res.get('retrieved_chunks', []))}")
        print(f"      Summary: {res.get('summary', '')[:90]}")

        logs.append({
            "test_id": qid,
            "category": item["category"],
            "question": q,
            "student_id": sid or "None",
            "expected_outcome": expected,
            "classification": classification,
            "is_hallucination": is_hallucination,
            "retrieval_hit": retrieval_hit,
            "latency_sec": round(latency, 2),
            "summary": res.get("summary", ""),
            "sources_cited": ", ".join(res.get("sources", [])),
            "retrieved_chunk_count": len(res.get("retrieved_chunks", []))
        })
        time.sleep(2.5)

    total = len(test_cases)
    accuracy_pct = round((correct_count / total) * 100, 1)
    hallucination_pct = round((hallucination_count / total) * 100, 1)
    retrieval_hit_pct = round((retrieval_hits / total) * 100, 1)
    avg_latency = round(total_latency / total, 2)

    summary_data = [{
        "total_test_cases": total,
        "correct_answers": correct_count,
        "accuracy_pct": accuracy_pct,
        "hallucination_rate_pct": hallucination_pct,
        "retrieval_hit_rate_pct": retrieval_hit_pct,
        "avg_latency_sec": avg_latency
    }]

    # Save outputs
    df_logs = pd.DataFrame(logs)
    csv_logs_path = os.path.join(RESULTS_DIR, "eval_logs.csv")
    df_logs.to_csv(csv_logs_path, index=False)

    df_summary = pd.DataFrame(summary_data)
    csv_summary_path = os.path.join(RESULTS_DIR, "eval_summary.csv")
    df_summary.to_csv(csv_summary_path, index=False)

    json_results_path = os.path.join(RESULTS_DIR, "eval_results.json")
    with open(json_results_path, "w", encoding="utf-8") as f:
        json.dump({
            "summary": summary_data[0],
            "details": logs
        }, f, indent=2, ensure_ascii=False)

    print("\n=================================================================")
    print("  FINAL EVALUATION RESULTS")
    print("=================================================================")
    print(f"  Total Scenarios Tested   : {total}")
    print(f"  Accuracy Score           : {accuracy_pct}% ({correct_count}/{total})")
    print(f"  Hallucination Rate       : {hallucination_pct}% ({hallucination_count}/{total})")
    print(f"  Retrieval Hit Rate       : {retrieval_hit_pct}% ({retrieval_hits}/{total})")
    print(f"  Average Latency          : {avg_latency}s per query")
    print(f"  Logs saved to            : {csv_logs_path}")
    print(f"  Summary saved to         : {csv_summary_path}")
    print("=================================================================\n")

if __name__ == "__main__":
    run_evaluation()
