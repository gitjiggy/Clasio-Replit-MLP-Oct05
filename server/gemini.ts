// Gemini AI service for document analysis and summarization
// Based on blueprint:javascript_gemini

import { GoogleGenerativeAI } from "@google/generative-ai";
import { ObjectStorageService } from "./objectStorage.js";
// Text extraction libraries
import mammoth from "mammoth";
import * as XLSX from "xlsx";

// Import pdf-parse directly
import pdfParse from 'pdf-parse';

async function getWordExtractor() {
  const WordExtractor = await import('word-extractor');
  return WordExtractor.default as new () => { extract(buffer: Buffer): Promise<ExtractedDocument>; };
}

// Type definitions for libraries without built-in types
interface PDFData {
  text: string;
  numpages: number;
  info: any;
  metadata: any;
}

interface ExtractedDocument {
  getBody(): string;
}

// This API key is from Gemini Developer API Key, not vertex AI API Key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const objectStorageService = new ObjectStorageService();

export async function summarizeDocument(text: string): Promise<string> {
    if (!text || text.trim().length === 0) {
        return "No content available to summarize.";
    }

    if (!process.env.GEMINI_API_KEY) {
        return "AI analysis unavailable - API key not configured.";
    }

    const prompt = `Generate a professional, concise 2-3 line description of this document's content and purpose. Write in sophisticated, direct language without starting with "This document" or "The document". Use active voice and specific details. Avoid generic phrases and focus on the document's actual value, function, or key information. Be crisp and authoritative:\n\n${text}`;

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const resultText = response.text();

        return resultText || "Unable to generate summary.";
    } catch (error) {
        console.error("Error summarizing document:", error);
        return "Error generating summary. Please try again.";
    }
}

export async function analyzeDocumentContent(text: string): Promise<{
    keyTopics: string[];
    documentType: string;
    category: string;
    wordCount: number;
    conciseTitle: string;
    categoryConfidence: number;
    documentTypeConfidence: number;
}> {
    if (!text || text.trim().length === 0) {
        return {
            keyTopics: [],
            documentType: "Technical Documentation",
            category: "Personal",
            wordCount: 0,
            conciseTitle: "Empty Document",
            categoryConfidence: 50,
            documentTypeConfidence: 50
        };
    }

    if (!process.env.GEMINI_API_KEY) {
        return {
            keyTopics: ["API key required"],
            documentType: "Technical Documentation",
            category: "Personal",
            wordCount: text.split(/\s+/).length,
            conciseTitle: "Untitled Document",
            categoryConfidence: 0,
            documentTypeConfidence: 0
        };
    }

    const wordCount = text.split(/\s+/).length;

    // Pre-processing: Apply keyword-based rules for better accuracy
    const textLower = text.toLowerCase();
    let keywordCategory = null;
    let keywordDocumentType = null;

    // Education-specific patterns - made more specific to avoid false positives
    if (/(back to school night|syllabus|homework assignment|pta meeting|pto meeting|school night|curriculum guide|parent teacher conference|class schedule|school event announcement|academic calendar|teacher communication|school enrollment|grade report)/i.test(text)) {
        keywordCategory = "Education";
        if (/(back to school|school night|pta|pto|school event|meeting|notice|announcement)/i.test(text)) {
            keywordDocumentType = "Event Notice";
        } else if (/(syllabus|curriculum|homework|academic)/i.test(text)) {
            keywordDocumentType = "Academic Document";
        }
    }

    const prompt = `You are a document classification expert. Analyze the following document and provide a JSON response.

STRICT REQUIREMENTS:
1. Concise Title: Generate a 4-7 word descriptive title that captures the document's essence
2. Key topics: Extract up to 5 most important topics as an array of strings
3. Document type: Must be EXACTLY one of these options (NEVER use "Other"):
   - "Resume"
   - "Cover Letter"
   - "Contract"
   - "Invoice"
   - "Receipt"
   - "Tax Document"
   - "Medical Record"
   - "Insurance Document"
   - "Legal Document"
   - "Immigration Document"
   - "Financial Statement"
   - "Employment Document"
   - "Event Notice"
   - "Academic Document"
   - "Real Estate Document"
   - "Travel Document"
   - "Personal Statement"
   - "Technical Documentation"
   - "Business Report"

4. Category: Must be EXACTLY one of these: "Taxes", "Medical", "Insurance", "Legal", "Immigration", "Financial", "Employment", "Education", "Real Estate", "Travel", "Personal", "Business"

5. Confidence scores: Provide confidence (0.0 to 1.0) for both category and document type classifications

IMPORTANT: If uncertain about classification, choose the CLOSEST matching option. NEVER use "Other" - always pick the best fit from the available options.

EXAMPLES:
- "2022 Fall Back to School Night" → {"conciseTitle": "School Event Notification", "documentType": "Event Notice", "category": "Education", "categoryConfidence": 0.95, "documentTypeConfidence": 0.90}
- "John Smith Resume 2024" → {"conciseTitle": "Professional Resume Document", "documentType": "Resume", "category": "Employment", "categoryConfidence": 0.98, "documentTypeConfidence": 0.99}
- "Stanford Personal Statement Draft" → {"conciseTitle": "College Application Essay", "documentType": "Personal Statement", "category": "Education", "categoryConfidence": 0.92, "documentTypeConfidence": 0.88}

${keywordCategory ? `HINT: Based on content analysis, this appears to be category "${keywordCategory}"` : ''}
${keywordDocumentType ? ` and type "${keywordDocumentType}"` : ''}

Format response as JSON only:
{
  "conciseTitle": "4-7 Word Title",
  "keyTopics": ["topic1", "topic2", "topic3"],
  "documentType": "Document Type",
  "category": "Category",
  "categoryConfidence": 0.95,
  "documentTypeConfidence": 0.90
}

Document content:
${text}`;

    try {
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash-lite",
            generationConfig: {
                temperature: 0,
                maxOutputTokens: 1000,
                responseMimeType: "application/json"
            }
        });

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const rawJson = response.text();

        // Log AI response only in debug mode to avoid exposing sensitive content
        if (process.env.DEBUG_AI === '1') {
            console.debug(`AI Analysis Response: ${rawJson}`);
        }

        if (rawJson) {
            // With responseMimeType: "application/json", the response should be clean JSON
            const data = JSON.parse(rawJson);

            // Post-processing validation: Ensure responses conform to strict taxonomy
            const validDocumentTypes = [\
                "Resume", "Cover Letter", "Contract", "Invoice", "Receipt", "Tax Document",\
                "Medical Record", "Insurance Document", "Legal Document", "Immigration Document",\
                "Financial Statement", "Employment Document", "Event Notice", "Academic Document",\
                "Real Estate Document", "Travel Document", "Personal Statement",\
                "Technical Documentation", "Business Report"\
            ];

            const validCategories = [\
                "Taxes", "Medical", "Insurance", "Legal", "Immigration", "Financial",\
                "Employment", "Education", "Real Estate", "Travel", "Personal", "Business"\
            ];

            // Confidence normalization helper - handles various input formats and clamps to 0-100
            const normalizeConfidence = (value: any): number => {
                let num = Number(value);
                if (!Number.isFinite(num)) num = 0.5;
                if (num <= 1) num *= 100; // Convert 0-1 scale to 0-100
                return Math.max(0, Math.min(100, Math.round(num)));
            };

            // Extract and validate confidence scores
            const categoryConfidence = normalizeConfidence(data.categoryConfidence);
            const documentTypeConfidence = normalizeConfidence(data.documentTypeConfidence);

            // Apply keyword overrides if detected, with fallback logic to prevent "Other"
            let finalDocumentType = validDocumentTypes.includes(data.documentType) ? data.documentType : "Technical Documentation";
            let finalCategory = validCategories.includes(data.category) ? data.category : "Personal";

            // Apply keyword overrides when AI confidence is low (<50) or when classification is invalid
            if (keywordCategory && validCategories.includes(keywordCategory) &&
                (categoryConfidence < 50 || !validCategories.includes(data.category))) {
                finalCategory = keywordCategory;
            }
            if (keywordDocumentType && validDocumentTypes.includes(keywordDocumentType) &&
                (documentTypeConfidence < 50 || !validDocumentTypes.includes(data.documentType))) {
                finalDocumentType = keywordDocumentType;
            }

            // Validate and clean concise title (4-7 words)
            let conciseTitle = data.conciseTitle || "Untitled Document";
            const titleWords = conciseTitle.trim().split(/\s+/);
            if (titleWords.length < 4) {
                conciseTitle = titleWords.concat(["Document", "File", "Content"]).slice(0, 4).join(" ");
            } else if (titleWords.length > 7) {
                conciseTitle = titleWords.slice(0, 7).join(" ");
            }


            return {
                keyTopics: Array.isArray(data.keyTopics) ? data.keyTopics.slice(0, 5) : ["Analysis unavailable"],
                documentType: finalDocumentType,
                category: finalCategory,
                wordCount,
                conciseTitle,
                categoryConfidence,
                documentTypeConfidence
            };
        } else {
            throw new Error("Empty response from model");
        }
    } catch (error) {
        console.error("Error analyzing document content:", error);
        return {
            keyTopics: ["Analysis unavailable"],
            documentType: "Technical Documentation",
            category: "Personal",
            wordCount,
            conciseTitle: "Analysis Failed",
            categoryConfidence: 0,
            documentTypeConfidence: 0
        };
    }
}

// Utility function to sanitize extracted text for PostgreSQL storage
function sanitizeTextForDatabase(text: string): string {
    if (!text) return "";

    return text
        // Remove null bytes and other control characters that cause PostgreSQL issues
        .replace(/\x00/g, '') // Remove null bytes
        .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove other control chars except \t, \n, \r
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        .trim();
}

export async function extractTextFromDocument(filePath: string, mimeType: string, driveAccessToken?: string): Promise<string> {
    try {

        // Handle Google Drive documents
        if (filePath.startsWith('drive:')) {
            const driveFileId = filePath.substring(6); // Remove 'drive:' prefix

            if (!driveAccessToken) {
                return `Google Drive document content extraction requires authentication. Please provide a valid access token.`;
            }

            try {
                // Import DriveService here to avoid circular dependencies
                const { DriveService } = await import('./driveService.js');
                const driveService = new DriveService(driveAccessToken);

                // Handle text files using existing getFileContent method
                if (mimeType === 'application/vnd.google-apps.document' ||
                    mimeType === 'text/plain' || mimeType === 'text/csv' || mimeType === 'text/html') {
                    const fileContent = await driveService.getFileContent(driveFileId);
                    if (fileContent && fileContent.content !== `[Binary file: ${fileContent.name}]`) {
                        return sanitizeTextForDatabase(fileContent.content);
                    }
                    return `Failed to extract text content from Drive file: ${driveFileId}`;
                }

                // Handle binary files (PDFs, Word docs) using new getFileBuffer method
                else if (mimeType === 'application/pdf' ||
                           mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                           mimeType === 'application/msword') {

                    const fileBuffer = await driveService.getFileBuffer(driveFileId);
                    if (!fileBuffer) {
                        return `Failed to download binary file from Drive: ${driveFileId}`;
                    }

                    // Use enhanced extraction functions for binary files (same as object storage path)
                    if (mimeType === 'application/pdf') {
                        return await extractTextFromPDF(fileBuffer.buffer);
                    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                        return await extractTextFromWordDocx(fileBuffer.buffer);
                    } else if (mimeType === 'application/msword') {
                        return await extractTextFromWordDoc(fileBuffer.buffer);
                    }
                } else {
                    return `Unsupported file type for Drive extraction: ${mimeType}`;
                }
            } catch (error) {
                console.error('Error extracting Drive document:', error);
                return `Error extracting Google Drive document: ${error instanceof Error ? error.message : 'Unknown error'}`;
            }
        }

        // Extract text from Object Storage files 
        const fileBuffer = await objectStorageService.getFile(filePath);
        if (!fileBuffer) {
            return `Failed to download file from storage: ${filePath}`;
        }

        switch (mimeType) {
            case 'application/pdf':
                return await extractTextFromPDF(fileBuffer);

            case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                return await extractTextFromWordDocx(fileBuffer);

            case 'application/msword':
                return await extractTextFromWordDoc(fileBuffer);

            case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
            case 'application/vnd.ms-excel':
                return await extractTextFromExcel(fileBuffer);

            case 'text/plain':
            case 'text/csv':
            case 'text/html':
                return sanitizeTextForDatabase(fileBuffer.toString('utf-8'));

            default:
                return `Unsupported file type for text extraction: ${mimeType}`;
        }
    } catch (error) {
        console.error(`Error extracting text from ${filePath}:`, error);
        return `Error extracting text from file: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
}

// Enhanced text extraction functions with improved error handling

async function extractTextFromPDF(buffer: Buffer): Promise<string> {
    try {
        const data = await pdfParse(buffer);
        const extractedText = data.text || '';
        
        if (!extractedText.trim()) {
            return 'This PDF appears to be image-based or has no extractable text content.';
        }
        
        return sanitizeTextForDatabase(extractedText);
    } catch (error) {
        console.error('PDF extraction error:', error);
        return `Error extracting text from PDF: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
}

async function extractTextFromWordDocx(buffer: Buffer): Promise<string> {
    try {
        const result = await mammoth.extractRawText({ buffer });
        
        if (!result.value.trim()) {
            return 'This Word document appears to have no extractable text content.';
        }
        
        return sanitizeTextForDatabase(result.value);
    } catch (error) {
        console.error('Word DOCX extraction error:', error);
        return `Error extracting text from Word document: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
}

async function extractTextFromWordDoc(buffer: Buffer): Promise<string> {
    try {
        const WordExtractor = await getWordExtractor();
        const extractor = new WordExtractor();
        const extracted = await extractor.extract(buffer);
        const text = extracted.getBody();
        
        if (!text.trim()) {
            return 'This Word document appears to have no extractable text content.';
        }
        
        return sanitizeTextForDatabase(text);
    } catch (error) {
        console.error('Word DOC extraction error:', error);
        return `Error extracting text from Word document: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
}

async function extractTextFromExcel(buffer: Buffer): Promise<string> {
    try {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        let allText = '';
        
        // Extract text from all sheets
        workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            const sheetText = XLSX.utils.sheet_to_csv(sheet, { header: 1 });
            allText += `Sheet: ${sheetName}\n${sheetText}\n\n`;
        });
        
        if (!allText.trim()) {
            return 'This Excel file appears to have no extractable text content.';
        }
        
        return sanitizeTextForDatabase(allText);
    } catch (error) {
        console.error('Excel extraction error:', error);
        return `Error extracting text from Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
}

// Conversational response generation for search
export async function processConversationalQuery(query: string): Promise<string> {
    // Process user query to understand intent and extract key information
    // This is a simple implementation - could be enhanced with more sophisticated NLP
    
    const queryLower = query.toLowerCase();
    
    // Extract potential document types and categories from query
    const documentTypes = ["resume", "contract", "invoice", "receipt", "legal", "medical", "tax", "financial"];
    const categories = ["taxes", "medical", "insurance", "legal", "immigration", "financial", "employment"];
    
    // Basic intent recognition
    if (queryLower.includes("show") || queryLower.includes("find") || queryLower.includes("search")) {
        return "search";
    } else if (queryLower.includes("recent") || queryLower.includes("latest")) {
        return "recent";
    } else {
        return "general";
    }
}

export async function generateConversationalResponse(
    documents: any[], 
    query: string, 
    intent: string = "search"
): Promise<string> {
    if (documents.length === 0) {
        return `I couldn't find any documents matching "${query}". Try searching with different keywords, or check if the document might be in a specific folder or have different tags.`;
    }

    // Generate a conversational response based on results
    const count = documents.length;
    
    if (count === 1) {
        const doc = documents[0];
        return `I found 1 document matching "${query}": "${doc.name}"${doc.aiSummary ? `. ${doc.aiSummary}` : ''}`;
    } else {
        const firstDoc = documents[0];
        const others = count - 1;
        return `I found ${count} documents matching "${query}". The most relevant is "${firstDoc.name}"${firstDoc.aiSummary ? ` - ${firstDoc.aiSummary}` : ''}${others > 0 ? ` and ${others} other${others > 1 ? 's' : ''}.` : '.'}`;
    }
}

export function isAmbiguousQuery(query: string): boolean {
    const ambiguousPatterns = [
        /^(show|find|get|search)\s+(me\s+)?(my\s+)?(all\s+)?(the\s+)?documents?\s*$/i,
        /^(what|which)\s+documents?\s+do\s+i\s+have\??$/i,
        /^documents?\s*$/i
    ];
    
    return ambiguousPatterns.some(pattern => pattern.test(query.trim()));
}

// Embedding generation and management functions
export async function generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
        throw new Error('Cannot generate embedding for empty text');
    }

    if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is required for embedding generation');
    }

    try {
        const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
        const result = await model.embedContent(text);
        const embedding = result.embedding;
        
        if (!embedding.values || !Array.isArray(embedding.values) || embedding.values.length === 0) {
            throw new Error('Invalid embedding response from Gemini');
        }

        return embedding.values;
    } catch (error) {
        console.error('Error generating embedding:', error);
        throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export function serializeEmbeddingToJSON(embedding: number[]): string {
    if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error('Invalid embedding array for serialization');
    }
    return JSON.stringify(embedding);
}

export function parseEmbeddingFromJSON(jsonString: string | null): number[] | null {
    if (!jsonString) return null;
    
    try {
        const parsed = JSON.parse(jsonString);
        if (!Array.isArray(parsed) || parsed.length === 0) {
            return null;
        }
        
        // Validate that all elements are numbers
        if (!parsed.every(val => typeof val === 'number' && !isNaN(val))) {
            return null;
        }
        
        return parsed;
    } catch (error) {
        console.error('Error parsing embedding JSON:', error);
        return null;
    }
}

export function calculateCosineSimilarity(embedding1: number[], embedding2: number[]): number {
    if (!embedding1 || !embedding2 || embedding1.length !== embedding2.length) {
        return 0;
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
        dotProduct += embedding1[i] * embedding2[i];
        norm1 += embedding1[i] * embedding1[i];
        norm2 += embedding2[i] * embedding2[i];
    }

    const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
    return magnitude > 0 ? dotProduct / magnitude : 0;
}

// Document relevance analysis function for semantic search
export async function analyzeDocumentRelevance(
    documents: any[], 
    query: string
): Promise<{ 
    relevantDocuments: any[], 
    relatedDocuments: any[], 
    explanations: Map<string, string> 
}> {
    if (!process.env.GEMINI_API_KEY || documents.length === 0) {
        return {
            relevantDocuments: documents,
            relatedDocuments: [],
            explanations: new Map()
        };
    }

    try {
        // Create document summaries for AI analysis
        const docSummaries = documents.map(doc => ({
            id: doc.id,
            name: doc.name,
            summary: doc.aiSummary || 'No summary available',
            category: doc.aiCategory || 'Unknown',
            type: doc.aiDocumentType || 'Unknown'
        }));

        const prompt = `You are a document relevance analyst. Given a user query and a list of documents, determine which documents are DIRECTLY RELEVANT vs TANGENTIALLY RELATED to the query.

Query: "${query}"

Documents:
${docSummaries.map((doc, idx) => `${idx + 1}. ID: ${doc.id}
   Name: ${doc.name}
   Summary: ${doc.summary}
   Category: ${doc.category}
   Type: ${doc.type}`).join('\n\n')}

For each document, determine:
1. RELEVANT: Document directly answers or relates to the query (high confidence)
2. RELATED: Document is tangentially connected but not directly relevant (medium confidence)
3. UNRELATED: Document has no meaningful connection to the query (should be excluded)

Also provide a brief explanation for each document about why it matches (or doesn't match) the query.

Respond in JSON format:
{
  "relevantDocuments": ["doc_id_1", "doc_id_2"],
  "relatedDocuments": ["doc_id_3"],
  "explanations": {
    "doc_id_1": "This document matches because...",
    "doc_id_2": "Relevant because..."
  }
}`;

        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash-lite",
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 2000,
                responseMimeType: "application/json"
            }
        });

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const analysis = JSON.parse(response.text());

        // Map document IDs back to actual documents
        const relevantDocs = documents.filter(doc => 
            analysis.relevantDocuments?.includes(doc.id)
        );
        
        const relatedDocs = documents.filter(doc => 
            analysis.relatedDocuments?.includes(doc.id)
        );

        // Convert explanations object to Map
        const explanations = new Map(Object.entries(analysis.explanations || {}));

        return {
            relevantDocuments: relevantDocs,
            relatedDocuments: relatedDocs,
            explanations
        };

    } catch (error) {
        console.error('Error analyzing document relevance:', error);
        
        // Fallback to simple text matching if AI analysis fails
        const relevantDocs = documents.filter(doc => {
            const searchText = `${doc.name} ${doc.aiSummary || ''} ${doc.aiKeyTopics?.join(' ') || ''}`.toLowerCase();
            return query.toLowerCase().split(' ').some(term => 
                term.length > 2 && searchText.includes(term)
            );
        });

        return {
            relevantDocuments: relevantDocs,
            relatedDocuments: documents.filter(doc => !relevantDocs.includes(doc)),
            explanations: new Map()
        };
    }
}