"""
Chunking and Indexing Script for Vidyashilp University RAG System
Generates high-precision, semantic chunks with preserved table headers,
hierarchical breadcrumbs, and rich metadata.
"""

import os
import re
import json
import glob

SOURCE_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "source")
CHUNKS_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "chunks")
APP_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "app", "src", "data")

def extract_course_codes(text):
    return sorted(list(set(re.findall(r'\b[A-Z]{2,4}\d{3}[A-Z]?\b', text))))

def chunk_course_catalogue(filepath):
    chunks = []
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    # Split on ### course headers
    course_blocks = re.split(r'\n(?=###\s+[A-Z]{2,4}\d{3})', content)
    for block in course_blocks:
        block = block.strip()
        if not block:
            continue
        first_line = block.splitlines()[0]
        if first_line.startswith("###"):
            title = first_line.replace("#", "").strip()
            codes = extract_course_codes(block)
            breadcrumb = f"[Course Catalogue > {title}]"
            chunks.append({
                "source_file": "course_catalogue.md",
                "document_title": "University Course Catalogue (2026-2027)",
                "section": title,
                "course_codes": codes,
                "keywords": codes + [w.lower() for w in title.split() if len(w) > 3],
                "text": f"{breadcrumb}\n{block}"
            })
        elif "##" in block:
            # Sub-headers like 'Computer Science Courses' or 'Minor Courses'
            pass
    return chunks

def chunk_semester_offerings(filepath):
    chunks = []
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    sections = re.split(r'\n(?=##\s+)', content)
    for sec in sections:
        sec = sec.strip()
        if not sec:
            continue
        first_line = sec.splitlines()[0]
        title = first_line.replace("#", "").strip()
        codes = extract_course_codes(sec)
        breadcrumb = f"[Semester Course Offerings > {title}]"
        chunks.append({
            "source_file": "semester_offering.md",
            "document_title": "Semester Course Offering Schedule (2026-2027)",
            "section": title,
            "course_codes": codes,
            "keywords": ["offering", "semester", "schedule", "fall", "spring", "not offered"] + codes,
            "text": f"{breadcrumb}\n{sec}"
        })
    return chunks

def chunk_minor_courses(filepath):
    chunks = []
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    sheets = re.split(r'\n(?=##\s+Sheet:\s+)', content)
    for sheet in sheets:
        sheet = sheet.strip()
        if not sheet or not sheet.startswith("## Sheet:"):
            continue
        lines = sheet.splitlines()
        sheet_title = lines[0].replace("#", "").strip()
        
        # Find table header
        table_header = None
        data_rows = []
        for l in lines[1:]:
            if "|" in l:
                if table_header is None and "---" not in l and ("Course Code" in l or "Course Title" in l):
                    table_header = l
                elif "---" in l:
                    continue
                elif table_header:
                    if any(cell.strip() for cell in l.split("|")[1:-1]):
                        data_rows.append(l)

        if not data_rows or not table_header:
            chunks.append({
                "source_file": "minor_courses.md",
                "document_title": "Minor Courses for BTech Students",
                "section": sheet_title,
                "course_codes": extract_course_codes(sheet),
                "keywords": ["minor", sheet_title.lower()],
                "text": f"[{sheet_title}]\n{sheet}"
            })
            continue

        # Group data rows by batches (up to 6 rows per chunk) with table header preserved!
        batch_size = 6
        for i in range(0, len(data_rows), batch_size):
            row_group = data_rows[i:i+batch_size]
            table_text = (
                f"{table_header}\n"
                f"| {' | '.join(['---'] * (len(table_header.split('|')) - 2))} |\n"
                + "\n".join(row_group)
            )
            codes = extract_course_codes(table_text)
            breadcrumb = f"[Minor Offerings > {sheet_title} (Part {i//batch_size + 1})]"
            chunks.append({
                "source_file": "minor_courses.md",
                "document_title": "Minor Courses for BTech Students",
                "section": sheet_title,
                "course_codes": codes,
                "keywords": ["minor", sheet_title.lower(), "law", "design", "psychology", "economics"] + codes,
                "text": f"{breadcrumb}\n{table_text}"
            })
    return chunks

def chunk_sop_document(filepath):
    chunks = []
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    # Split by section headers
    sections = re.split(r'\n(?=##\s+\d+\.)', content)
    for sec in sections:
        sec = sec.strip()
        if not sec:
            continue
        first_line = sec.splitlines()[0]
        title = first_line.replace("#", "").strip() if first_line.startswith("#") else "General SOP Policy"
        codes = extract_course_codes(sec)
        breadcrumb = f"[SOP Current Semester > {title}]"
        
        # If section is excessively long, split by sub-bullets
        if len(sec) > 1200:
            subsections = re.split(r'\n(?=•\s+|###\s+)', sec)
            for sidx, sub in enumerate(subsections):
                sub = sub.strip()
                if not sub:
                    continue
                chunks.append({
                    "source_file": "sop_current_semester.md",
                    "document_title": "Standard Operating Procedure (SOP) - Students (Sept 2026)",
                    "section": f"{title} (Part {sidx+1})",
                    "course_codes": extract_course_codes(sub),
                    "keywords": ["sop", "registration", "fee", "digii", "add drop", "deadline", "attendance"],
                    "text": f"{breadcrumb}\n{sub}"
                })
        else:
            chunks.append({
                "source_file": "sop_current_semester.md",
                "document_title": "Standard Operating Procedure (SOP) - Students (Sept 2026)",
                "section": title,
                "course_codes": codes,
                "keywords": ["sop", "registration", "fee", "dues", "digii", "add drop", "deadline", "attendance"],
                "text": f"{breadcrumb}\n{sec}"
            })
    return chunks

def chunk_student_handbook(filepath):
    chunks = []
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    # Handle summary sections first
    sections = re.split(r'\n(?=##\s+\d+\.|\n(?=<!-- Page \d+ -->))', content)
    for sec in sections:
        sec = sec.strip()
        if not sec:
            continue
        first_line = sec.splitlines()[0]
        
        # Check if it's an important regulatory section
        title = first_line.replace("#", "").strip() if first_line.startswith("#") else "Academic Regulations & Policies"
        if len(sec) < 60:
            continue
            
        codes = extract_course_codes(sec)
        breadcrumb = f"[Student Handbook > {title}]"
        
        if len(sec) > 1400:
            paragraphs = sec.split("\n\n")
            sub_buf = ""
            sub_idx = 1
            for p in paragraphs:
                if len(sub_buf) + len(p) < 1000:
                    sub_buf += p + "\n\n"
                else:
                    if sub_buf.strip():
                        chunks.append({
                            "source_file": "student_handbook.md",
                            "document_title": "University Academic Regulations & Student Handbook (August 2026)",
                            "section": f"{title} (Part {sub_idx})",
                            "course_codes": extract_course_codes(sub_buf),
                            "keywords": ["handbook", "regulations", "credits", "probation", "retake", "attendance", "cgpa"],
                            "text": f"{breadcrumb}\n{sub_buf.strip()}"
                        })
                        sub_idx += 1
                    sub_buf = p + "\n\n"
            if sub_buf.strip():
                chunks.append({
                    "source_file": "student_handbook.md",
                    "document_title": "University Academic Regulations & Student Handbook (August 2026)",
                    "section": f"{title} (Part {sub_idx})",
                    "course_codes": extract_course_codes(sub_buf),
                    "keywords": ["handbook", "regulations", "credits", "probation", "retake", "attendance", "cgpa"],
                    "text": f"{breadcrumb}\n{sub_buf.strip()}"
                })
        else:
            chunks.append({
                "source_file": "student_handbook.md",
                "document_title": "University Academic Regulations & Student Handbook (August 2026)",
                "section": title,
                "course_codes": codes,
                "keywords": ["handbook", "regulations", "credits", "probation", "retake", "attendance", "cgpa", "scholarship"],
                "text": f"{breadcrumb}\n{sec}"
            })
    return chunks

def chunk_university_faq(filepath):
    chunks = []
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    qa_blocks = re.split(r'\n(?=###\s+Q\d+:)', content)
    buffer_qa = []
    buffer_len = 0
    cat_title = "General University FAQs"

    for b in qa_blocks:
        b = b.strip()
        if not b:
            continue
        if b.startswith("## "):
            cat_title = b.splitlines()[0].replace("#", "").strip()
            continue
        
        buffer_qa.append(b)
        buffer_len += len(b)
        if buffer_len >= 600 or len(buffer_qa) >= 3:
            combined_text = "\n\n".join(buffer_qa)
            chunks.append({
                "source_file": "university_faq_dataset.md",
                "document_title": "Vidyashilp University Comprehensive Q&A Dataset",
                "section": cat_title,
                "course_codes": extract_course_codes(combined_text),
                "keywords": ["faq", "university", cat_title.lower(), "policy", "regulations"],
                "text": f"[FAQ > {cat_title}]\n{combined_text}"
            })
            buffer_qa = []
            buffer_len = 0

    if buffer_qa:
        combined_text = "\n\n".join(buffer_qa)
        chunks.append({
            "source_file": "university_faq_dataset.md",
            "document_title": "Vidyashilp University Comprehensive Q&A Dataset",
            "section": cat_title,
            "course_codes": extract_course_codes(combined_text),
            "keywords": ["faq", "university", cat_title.lower(), "policy", "regulations"],
            "text": f"[FAQ > {cat_title}]\n{combined_text}"
        })

    return chunks

def run_chunking_pipeline():
    os.makedirs(CHUNKS_DIR, exist_ok=True)
    os.makedirs(APP_DATA_DIR, exist_ok=True)

    all_chunks = []
    
    # 1. Course Catalogue
    cat_path = os.path.join(SOURCE_DIR, "course_catalogue.md")
    if os.path.exists(cat_path):
        all_chunks.extend(chunk_course_catalogue(cat_path))

    # 2. Semester Offerings
    offering_path = os.path.join(SOURCE_DIR, "semester_offering.md")
    if os.path.exists(offering_path):
        all_chunks.extend(chunk_semester_offerings(offering_path))

    # 3. Minor Courses
    minor_path = os.path.join(SOURCE_DIR, "minor_courses.md")
    if os.path.exists(minor_path):
        all_chunks.extend(chunk_minor_courses(minor_path))

    # 4. SOP Document
    sop_path = os.path.join(SOURCE_DIR, "sop_current_semester.md")
    if os.path.exists(sop_path):
        all_chunks.extend(chunk_sop_document(sop_path))

    # 5. Student Handbook
    handbook_path = os.path.join(SOURCE_DIR, "student_handbook.md")
    if os.path.exists(handbook_path):
        all_chunks.extend(chunk_student_handbook(handbook_path))

    # 6. University FAQ
    faq_path = os.path.join(SOURCE_DIR, "university_faq_dataset.md")
    if os.path.exists(faq_path):
        all_chunks.extend(chunk_university_faq(faq_path))

    # Assign persistent chunk IDs and compute stats
    for idx, c in enumerate(all_chunks):
        c["chunk_id"] = f"chunk_{idx+1:04d}"
        c["char_count"] = len(c["text"])
        c["estimated_tokens"] = round(len(c["text"]) / 4)

    output_path = os.path.join(CHUNKS_DIR, "improved_chunks.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_chunks, f, indent=2, ensure_ascii=False)

    # Also copy to frontend app data directory for seamless Vercel deployment
    app_output_path = os.path.join(APP_DATA_DIR, "chunks.json")
    with open(app_output_path, "w", encoding="utf-8") as f:
        json.dump(all_chunks, f, indent=2, ensure_ascii=False)

    print(f"Successfully generated {len(all_chunks)} improved chunks.")
    print(f"Saved to:")
    print(f"  - {output_path}")
    print(f"  - {app_output_path}")

    # Display quality statistics
    lengths = [c["char_count"] for c in all_chunks]
    print(f"Chunk Quality Statistics:")
    print(f"  - Total chunks: {len(all_chunks)}")
    print(f"  - Min length: {min(lengths)} characters")
    print(f"  - Max length: {max(lengths)} characters")
    print(f"  - Avg length: {round(sum(lengths)/len(lengths), 1)} characters")
    print(f"  - Chunks with course codes: {sum(1 for c in all_chunks if c['course_codes'])}")

if __name__ == "__main__":
    run_chunking_pipeline()
