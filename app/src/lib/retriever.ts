import { KnowledgeChunk, RetrievedChunk, RetrievalResult } from './types';
import chunksData from '../data/chunks.json';

const chunks: KnowledgeChunk[] = chunksData as KnowledgeChunk[];

const POLICY_KEYWORD_MAP: Record<string, string[]> = {
  attendance: ['attendance', 'attendence', '75%', '65%', 'shortage', 'medical certificate', 'condonation'],
  probation: ['probation', 'academic probation', 'cgpa', 'gpa', '18 credits', 'suspension'],
  retake: ['retake', 'failed', 'attempt', 'grade f', 'f grade', 'core course retake'],
  add_drop: ['add/drop', 'add drop', '14 days', '2 weeks', 'calendar days', 'drop a course'],
  fee: ['fee', 'dues', 'tuition', 'hostel fee', 'clearance', 'pending fees', 'unpaid'],
  credit_limit: ['credit limit', '24 credits', 'overload', 'maximum credits', '160 credits', 'graduation'],
  minor: ['minor', 'law minor', 'design minor', 'psychology', 'economics', 'finance', 'lawe', 'lawm', 'cdes'],
  capstone: ['capstone', 'ds490', 'senior capstone', '100 credits'],
  speed_limit: ['speed limit', 'vehicle', 'motor vehicle', '20 km/h', 'driving'],
  scholarship: ['scholarship', 'merit scholarship', 'need-based', 'concession', 'sports excellence']
};

const OUT_OF_DOMAIN_PATTERNS = [
  /\bdorm\b/i,
  /\blaundry\b/i,
  /\bhostel room assignment\b/i,
  /\bparking permit fee\b/i,
  /\bmotorbike\b/i,
  /\bcafeteria meal plan\b/i,
  /\bmeal plan refund\b/i,
  /\bmess food\b/i
];

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-zA-Z0-9_\-\.\%]+/g) || [];
}

function extractCourseCodes(text: string): string[] {
  const matches = text.toUpperCase().match(/\b[A-Z]{2,4}\d{3}[A-Z]?\b/g);
  return matches ? Array.from(new Set(matches)).sort() : [];
}

// In-Memory BM25 Implementation
class BM25 {
  private k1: number;
  private b: number;
  private corpusSize: number;
  private docLengths: number[];
  private avgdl: number;
  private docFreqs: Map<string, number>;
  private idf: Map<string, number>;
  private docTermFreqs: Map<string, number>[];

  constructor(corpusTokens: string[][], k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.corpusSize = corpusTokens.length;
    this.docLengths = corpusTokens.map(d => d.length);
    this.avgdl = this.docLengths.reduce((a, c) => a + c, 0) / (this.corpusSize || 1);
    this.docFreqs = new Map();
    this.idf = new Map();
    this.docTermFreqs = [];

    for (const tokens of corpusTokens) {
      const tfMap = new Map<string, number>();
      for (const t of tokens) {
        tfMap.set(t, (tfMap.get(t) || 0) + 1);
      }
      this.docTermFreqs.push(tfMap);
      tfMap.forEach((_, term) => {
        this.docFreqs.set(term, (this.docFreqs.get(term) || 0) + 1);
      });
    }

    this.docFreqs.forEach((freq, term) => {
      this.idf.set(term, Math.log(1 + (this.corpusSize - freq + 0.5) / (freq + 0.5)));
    });
  }

  public getScores(queryTokens: string[]): number[] {
    const scores = new Array(this.corpusSize).fill(0);
    for (const token of queryTokens) {
      const idfVal = this.idf.get(token);
      if (!idfVal) continue;
      for (let i = 0; i < this.corpusSize; i++) {
        const tf = this.docTermFreqs[i].get(token) || 0;
        if (tf > 0) {
          const docLen = this.docLengths[i];
          const denom = tf + this.k1 * (1 - this.b + this.b * (docLen / (this.avgdl || 1)));
          scores[i] += idfVal * (tf * (this.k1 + 1)) / denom;
        }
      }
    }
    return scores;
  }
}

// Initialize BM25 corpus once at module load
const corpusTokens: string[][] = chunks.map(c =>
  tokenize(`${c.text} ${c.section} ${c.course_codes.join(' ')}`)
);
const bm25Engine = new BM25(corpusTokens);

export function isOutOfDomain(query: string): boolean {
  return OUT_OF_DOMAIN_PATTERNS.some(pattern => pattern.test(query));
}

export function retrieveGroundedChunks(query: string, topK = 4): RetrievalResult {
  if (isOutOfDomain(query)) {
    return {
      chunks: [],
      is_out_of_domain: true,
      confidence: 0.0,
      matched_policies: [],
      detected_courses: [],
      message: 'Query belongs to an out-of-domain category not covered in university regulations.'
    };
  }

  const qLower = query.toLowerCase();
  const qTokens = tokenize(query);
  const detectedCodes = extractCourseCodes(query);

  const matchedPolicies: string[] = [];
  for (const [policy, keywords] of Object.entries(POLICY_KEYWORD_MAP)) {
    if (keywords.some(kw => qLower.includes(kw))) {
      matchedPolicies.push(policy);
    }
  }

  const bm25Scores = bm25Engine.getScores(qTokens);
  const maxBm25 = Math.max(...bm25Scores, 1.0);

  const candidates: { chunk: KnowledgeChunk; score: number }[] = [];

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    const chunkLower = chunk.text.toLowerCase();
    const baseBm25 = bm25Scores[idx] / maxBm25;
    let score = baseBm25 * 1.5;

    // 1. Exact Course Code Boost
    for (const code of detectedCodes) {
      if (chunk.course_codes.includes(code)) {
        score += 5.0;
      } else if (chunk.text.includes(code)) {
        score += 3.0;
      }
    }

    // 2. Policy Keyword Boost
    for (const policy of matchedPolicies) {
      const kws = POLICY_KEYWORD_MAP[policy];
      const matchCount = kws.filter(kw => chunkLower.includes(kw)).length;
      if (matchCount > 0) {
        score += Math.min(matchCount * 0.8, 2.5);
      }
    }

    // 3. Seasonal course offering handling
    if (qLower.includes('not offered') && chunkLower.includes('not offered')) {
      score += 3.0;
    }
    if (qLower.includes('spring') && chunkLower.includes('spring')) {
      score += 0.8;
    }
    if (qLower.includes('fall') && chunkLower.includes('fall')) {
      score += 0.8;
    }

    // 4. Capstone query handling
    if (qLower.includes('capstone') || qLower.includes('ds490')) {
      if (chunk.course_codes.includes('DS490') || chunkLower.includes('capstone')) {
        score += 4.0;
      }
    }

    // 5. Minor courses handling
    if (qLower.includes('minor') && chunk.source_file.includes('minor')) {
      score += 2.0;
    }

    if (score > 0.15) {
      candidates.push({ chunk, score: Math.round(score * 1000) / 1000 });
    }
  }

  // Sort descending by score
  candidates.sort((a, b) => b.score - a.score);

  // Deduplicate and diversify
  const selectedChunks: RetrievedChunk[] = [];
  const seenSections = new Set<string>();

  for (const cand of candidates) {
    const c = cand.chunk;
    const secKey = `${c.source_file}:${c.section.slice(0, 25)}`;
    if (!seenSections.has(secKey)) {
      seenSections.add(secKey);
      selectedChunks.push({
        chunk_id: c.chunk_id,
        source: c.source_file,
        document_title: c.document_title,
        section: c.section,
        course_codes: c.course_codes,
        text: c.text,
        score: cand.score
      });
    }
    if (selectedChunks.length >= topK) break;
  }

  const confidence = selectedChunks.length > 0
    ? Math.min(Math.round((selectedChunks[0].score / 5.0) * 100) / 100, 1.0)
    : 0.0;

  return {
    chunks: selectedChunks,
    is_out_of_domain: false,
    confidence,
    matched_policies: matchedPolicies,
    detected_courses: detectedCodes
  };
}
