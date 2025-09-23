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
            const validDocumentTypes = [
                "Resume", "Cover Letter", "Contract", "Invoice", "Receipt", "Tax Document",
                "Medical Record", "Insurance Document", "Legal Document", "Immigration Document",
                "Financial Statement", "Employment Document", "Event Notice", "Academic Document",
                "Real Estate Document", "Travel Document", "Personal Statement", 
                "Technical Documentation", "Business Report"
            ];
            
            const validCategories = [
                "Taxes", "Medical", "Insurance", "Legal", "Immigration", "Financial",
                "Employment", "Education", "Real Estate", "Travel", "Personal", "Business"
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
        
        // Extract the object path from the file path
        // File paths are stored as object storage paths like "/objects/uploads/..."
        // Ensure the path always starts with /objects/ for proper object storage access
        const objectPath = filePath.startsWith('/objects/') ? filePath : `/objects/${filePath}`;
        
        // Get the file buffer from object storage
        const fileBuffer = await objectStorageService.getObjectBuffer(objectPath);
        
        // For text files, convert buffer to string
        if (mimeType === 'text/plain' || mimeType === 'text/csv') {
            return sanitizeTextForDatabase(fileBuffer.toString('utf-8'));
        }
        
        // For PDF files
        if (mimeType === 'application/pdf') {
            return await extractTextFromPDF(fileBuffer);
        }
        
        // For Word documents (.docx)
        if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            return await extractTextFromWordDocx(fileBuffer);
        }
        
        // For legacy Word documents (.doc)
        if (mimeType === 'application/msword') {
            return await extractTextFromWordDoc(fileBuffer);
        }
        
        // For Excel files
        if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
            mimeType === 'application/vnd.ms-excel') {
            return await extractTextFromExcel(fileBuffer);
        }
        
        // For images, use Gemini's vision capabilities to extract text
        if (mimeType.startsWith('image/')) {
            return await extractTextFromImageBuffer(fileBuffer, mimeType);
        }
        
        // For unsupported file types, return a message
        return `Text extraction from ${mimeType} files is not yet supported. Currently supporting PDF, Word (.doc/.docx), Excel (.xls/.xlsx), text files, and images.`;
        
    } catch (error) {
        console.error("Error extracting text from document:", error);
        return "Error extracting text from document. Please ensure the file is accessible and try again.";
    }
}

// PDF text extraction using pdf-parse with comprehensive error handling
async function extractTextFromPDF(buffer: Buffer): Promise<string> {
    try {
        
        // Check if buffer is valid and not empty
        if (!buffer || buffer.length === 0) {
            console.error("PDF buffer is empty or invalid");
            return "Error: PDF file is empty or corrupted.";
        }
        
        // Check for minimum PDF size (PDFs smaller than 100 bytes are likely corrupted)
        if (buffer.length < 100) {
            console.error("PDF too small - likely corrupted during download");
            return "Error: PDF file appears to be corrupted or incomplete.";
        }
        
        // Verify PDF header
        const pdfHeader = buffer.toString('ascii', 0, 4);
        if (pdfHeader !== '%PDF') {
            console.error("Invalid PDF header (expected %PDF)");
            return "Error: File does not appear to be a valid PDF.";
        }
        
        
        const data = await pdfParse(buffer);
        const text = data.text?.trim();
        
        if (!text || text.length === 0) {
            // If no text found, try OCR using Gemini vision as fallback
            try {
                const ocrText = await extractTextFromImageBuffer(buffer, 'application/pdf');
                if (ocrText && ocrText.length > 10) {
                    return ocrText + " (extracted via OCR)";
                } else {
                    return "Error: Unable to extract text from this PDF. It may be an image-based document without readable text.";
                }
            } catch (ocrError) {
                console.error("OCR fallback failed:", ocrError);
                return "Error: Unable to extract text from this PDF. Both text extraction and OCR failed.";
            }
        }
        
        return sanitizeTextForDatabase(text);
    } catch (error) {
        console.error("Error extracting text from PDF:", error);
        
        // Provide specific error information for debugging
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('Invalid PDF structure')) {
            return "Error: PDF file structure is corrupted or unsupported.";
        } else if (errorMessage.includes('encrypted')) {
            return "Error: PDF is password-protected or encrypted.";
        } else {
            return `Error extracting text from PDF: ${errorMessage}`;
        }
    }
}

// Word document (.docx) text extraction using mammoth
async function extractTextFromWordDocx(buffer: Buffer): Promise<string> {
    try {
        const result = await mammoth.extractRawText({ buffer });
        const text = result.value?.trim();
        
        if (result.messages && result.messages.length > 0) {
        }
        
        return sanitizeTextForDatabase(text || "No text content found in Word document.");
    } catch (error) {
        console.error("Error extracting text from DOCX:", error);
        return "Error extracting text from Word document.";
    }
}

// Legacy Word document (.doc) text extraction using word-extractor
async function extractTextFromWordDoc(buffer: Buffer): Promise<string> {
    try {
        const WordExtractor = await getWordExtractor();
        const extractor = new WordExtractor();
        const extracted = await extractor.extract(buffer);
        const text = extracted.getBody()?.trim();
        
        return sanitizeTextForDatabase(text || "No text content found in Word document.");
    } catch (error) {
        console.error("Error extracting text from DOC:", error);
        return "Error extracting text from legacy Word document.";
    }
}

// Excel text extraction using xlsx
async function extractTextFromExcel(buffer: Buffer): Promise<string> {
    try {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        let allText = '';
        
        // Extract text from all worksheets
        workbook.SheetNames.forEach((sheetName, index) => {
            const worksheet = workbook.Sheets[sheetName];
            
            // Convert sheet to array of arrays
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
                header: 1, 
                defval: '', 
                raw: false 
            });
            
            // Add sheet header
            if (workbook.SheetNames.length > 1) {
                allText += `\n=== Sheet: ${sheetName} ===\n`;
            }
            
            // Extract text from each row
            jsonData.forEach((row: unknown) => {
                if (Array.isArray(row)) {
                    const rowText = row
                        .filter(cell => cell && String(cell).trim())
                        .join(' | ');
                    if (rowText.trim()) {
                        allText += rowText + '\n';
                    }
                }
            });
        });
        
        const text = allText.trim();
        return sanitizeTextForDatabase(text || "No text content found in Excel document.");
    } catch (error) {
        console.error("Error extracting text from Excel:", error);
        return "Error extracting text from Excel document.";
    }
}

async function extractTextFromImageBuffer(imageBuffer: Buffer, mimeType: string): Promise<string> {
    try {
        if (!process.env.GEMINI_API_KEY) {
            return "AI image analysis unavailable - API key not configured.";
        }

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

        const imagePart = {
            inlineData: {
                data: imageBuffer.toString("base64"),
                mimeType: mimeType,
            },
        };

        const prompt = "Please extract and transcribe all text content from this image. If there is no text, describe what you see in the image.";

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text();

        return sanitizeTextForDatabase(text || "No text could be extracted from this image.");
    } catch (error) {
        console.error("Error extracting text from image:", error);
        return "Error extracting text from image.";
    }
}

// Enhanced conversational search functions using Gemini 2.5 Flash-lite
export async function generateEmbedding(text: string, taskType: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT' = 'RETRIEVAL_DOCUMENT'): Promise<number[]> {
    if (!text || text.trim().length === 0) {
        throw new Error("Text is required for embedding generation");
    }

    if (!process.env.GEMINI_API_KEY) {
        throw new Error("Gemini API key not configured");
    }

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
        const result = await model.embedContent(text);
        
        return result.embedding.values;
    } catch (error) {
        console.error("Error generating embedding:", error);
        throw new Error("Failed to generate embedding");
    }
}

// Utility functions for new 3-stage scoring system

export function calculateCosineSimilarity(vectorA: number[], vectorB: number[]): number {
    if (vectorA.length !== vectorB.length) {
        throw new Error("Vectors must have the same length");
    }
    
    if (vectorA.length === 0) {
        return 0;
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vectorA.length; i++) {
        dotProduct += vectorA[i] * vectorB[i];
        normA += vectorA[i] * vectorA[i];
        normB += vectorB[i] * vectorB[i];
    }
    
    if (normA === 0 || normB === 0) {
        return 0;
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function isAmbiguousQuery(query: string): boolean {
    const lowerQuery = query.toLowerCase().trim();
    
    // Query length validation - extremely long queries might indicate abuse
    const wordCount = lowerQuery.split(/\s+/).length;
    if (wordCount > 100) {
        console.warn(`Potentially abusive query detected: ${wordCount} words`);
        return true; // Treat overly long queries as ambiguous
    }
    
    const hasNumbers = /\d+/.test(query); // "2023", "100"
    const hasDocumentTerms = /(contract|invoice|receipt|policy|report|statement|tax|resume|document|file|paper)/i.test(query);
    const hasSpecificTerms = query.length > 10 && !/^(find|show|get|where|what|give|list)/.test(lowerQuery);
    
    // Return true if query is ambiguous (no specific indicators)
    return !(hasNumbers || hasDocumentTerms || hasSpecificTerms);
}

export function parseEmbeddingFromJSON(embeddingStr: string | null): number[] | null {
    if (!embeddingStr) return null;
    try {
        const parsed = JSON.parse(embeddingStr);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function serializeEmbeddingToJSON(embedding: number[]): string {
    return JSON.stringify(embedding);
}

export function processConversationalQuery(query: string): {
    intent: string;
    keywords: string[];
    categoryFilter?: string;
    documentTypeFilter?: string;
    semanticQuery: string;
} {
    // LIGHTNING FAST local keyword extraction - NO AI CALLS!
    const lowerQuery = query.toLowerCase().trim();
    
    // Remove common stop words and extract meaningful keywords
    const stopWords = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'among', 'any', 'some', 'all', 'each', 'few', 'more', 'most', 'other', 'such', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'can', 'will', 'just', 'should', 'now', 'document', 'documents', 'file', 'files', 'have', 'find', 'search', 'show', 'get', 'containing', 'with', 'about', 'my', 'me', 'i', 'do']);
    
    // Extract keywords (split by spaces, remove stop words, filter short words)
    const keywords = lowerQuery
        .split(/\s+/)
        .filter(word => word.length > 1 && !stopWords.has(word))
        .map(word => word.replace(/[^\w]/g, '')) // Remove punctuation
        .filter(word => word.length > 1);
    
    // Fast category detection (pattern matching)
    let categoryFilter: string | undefined = undefined;
    let documentTypeFilter: string | undefined = undefined;
    
    // Quick category matching
    if (/tax|taxes|irs|1099|w2/i.test(query)) categoryFilter = "Taxes";
    else if (/medical|health|insurance|doctor|hospital/i.test(query)) categoryFilter = "Medical";
    else if (/legal|contract|agreement|law/i.test(query)) categoryFilter = "Legal";
    else if (/financial|bank|statement|invoice|receipt/i.test(query)) categoryFilter = "Financial";
    else if (/business|company|work|employment/i.test(query)) categoryFilter = "Business";
    
    // Quick document type matching
    if (/invoice/i.test(query)) documentTypeFilter = "Invoice";
    else if (/receipt/i.test(query)) documentTypeFilter = "Receipt";
    else if (/contract/i.test(query)) documentTypeFilter = "Contract";
    else if (/resume/i.test(query)) documentTypeFilter = "Resume";
    else if (/tax.*document|1099|w2/i.test(query)) documentTypeFilter = "Tax Document";
    
    return {
        intent: "fast_search",
        keywords: keywords.length > 0 ? keywords : [query],
        categoryFilter,
        documentTypeFilter,
        semanticQuery: query
    };
}

export async function analyzeDocumentRelevance(documentContent: string, documentName: string, query: string): Promise<{
    isRelevant: boolean;
    confidenceScore: number;
    relevanceReason: string;
}> {
    if (!process.env.GEMINI_API_KEY) {
        return {
            isRelevant: false,
            confidenceScore: 0,
            relevanceReason: "AI analysis unavailable - API key not configured"
        };
    }

    if (!documentContent || documentContent.trim().length === 0) {
        return {
            isRelevant: false,
            confidenceScore: 0,
            relevanceReason: "Document has no content to analyze"
        };
    }

    // Truncate content to prevent token limit issues (keep first 8000 characters)
    const truncatedContent = documentContent.length > 8000 
        ? documentContent.substring(0, 8000) + "\n[...content truncated for analysis...]"
        : documentContent;

    const prompt = `You are analyzing a document to determine if it is relevant to a user's search query.

Document Name: "${documentName}"
User Query: "${query}"

Document Content (read this completely and carefully):
${truncatedContent}

Based on your complete reading of the document content above, answer:

1. Is this document relevant to the user's query? (true/false)
2. Confidence score (0-100) - how confident are you that this document matches what the user is looking for?
3. Brief reason explaining why it is or isn't relevant

Instructions:
- Read the ENTIRE document content carefully
- Consider the user's intent behind the query
- Look for direct mentions, related concepts, or contextual relevance
- Be accurate - don't give high confidence scores unless the document clearly relates to the query
- For people names, look for exact name matches or clear references
- For topics, consider both direct mentions and related concepts

Respond with ONLY a JSON object in this format:
{
  "isRelevant": boolean,
  "confidenceScore": number,
  "relevanceReason": "brief explanation"
}`;

    try {
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash-lite",
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 300,
                responseMimeType: "application/json"
            }
        });
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const responseText = response.text();
        
        // Parse the JSON response
        try {
            const parsed = JSON.parse(responseText);
            return {
                isRelevant: Boolean(parsed.isRelevant),
                confidenceScore: Math.min(Math.max(Number(parsed.confidenceScore) || 0, 0), 100),
                relevanceReason: String(parsed.relevanceReason || "No reason provided")
            };
        } catch (parseError) {
            console.error("Error parsing AI relevance response:", parseError, "Response:", responseText);
        }
        
        // Fallback if JSON parsing fails
        return {
            isRelevant: false,
            confidenceScore: 0,
            relevanceReason: "Unable to parse AI analysis response"
        };
    } catch (error) {
        console.error("Error analyzing document relevance:", error);
        return {
            isRelevant: false,
            confidenceScore: 0,
            relevanceReason: "Error during AI analysis"
        };
    }
}

export async function generateConversationalResponse(query: string, matchingDocuments: any[], intent: string): Promise<string> {
    if (!process.env.GEMINI_API_KEY) {
        if (matchingDocuments.length === 0) {
            return `I couldn't find any documents matching "${query}". Try searching with different keywords, or check if the document might be in a specific folder or have different tags.`;
        } else {
            return `I found ${matchingDocuments.length} document${matchingDocuments.length === 1 ? '' : 's'} that might be relevant to your search.`;
        }
    }

    // Enhanced document context with confidence scores and match explanations
    const documentsContext = matchingDocuments.slice(0, 5).map(doc => {
        const matchReasons = [];
        
        // Analyze what caused the match for better explanation
        if (doc.name && query.toLowerCase().split(' ').some(word => 
            doc.name.toLowerCase().includes(word.toLowerCase()))) {
            matchReasons.push("title contains search terms");
        }
        
        if (doc.aiKeyTopics && Array.isArray(doc.aiKeyTopics) && 
            query.toLowerCase().split(' ').some(word => 
                doc.aiKeyTopics.some((topic: string) => topic.toLowerCase().includes(word.toLowerCase())))) {
            matchReasons.push("key topics match");
        }
        
        if (doc.documentContent && query.toLowerCase().split(' ').some(word => 
            doc.documentContent.toLowerCase().includes(word.toLowerCase()))) {
            matchReasons.push("document content contains search terms");
        }
        
        if (doc.aiSummary && query.toLowerCase().split(' ').some(word => 
            doc.aiSummary.toLowerCase().includes(word.toLowerCase()))) {
            matchReasons.push("summary contains search terms");
        }
        
        return {
            name: doc.name,
            type: doc.aiDocumentType || doc.fileType,
            category: doc.aiCategory,
            summary: doc.aiSummary?.substring(0, 150) + (doc.aiSummary?.length > 150 ? "..." : ""),
            keyTopics: doc.aiKeyTopics || [],
            confidenceScore: doc.confidenceScore || 0,
            matchReasons: matchReasons,
            documentContent: doc.documentContent ? doc.documentContent.substring(0, 200) + "..." : null
        };
    });

    const prompt = `User asked: "${query}"
Search intent: ${intent}
Found ${matchingDocuments.length} documents with confidence scores:

${JSON.stringify(documentsContext, null, 2)}

Generate a helpful, conversational response that:
1. Acknowledges what the user is looking for
2. Lists the most relevant documents with their confidence scores
3. Explains WHY each document matches (based on matchReasons)
4. Shows confidence levels like "85% confidence match" or "moderate confidence"
5. Uses natural, conversational language
6. If multiple documents found, mention the top matches with confidence levels

Format like: "I found [X] documents related to [topic]. Here are the top matches:
- [Document Name] (85% confidence) - matches because [reason]
- [Document Name] (72% confidence) - matches because [reason]"

Keep response helpful and informative but concise.`;

    try {
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash-lite",
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 300
            }
        });
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const responseText = response.text();
        if (responseText) {
            return responseText;
        } else {
            return matchingDocuments.length === 0 
                ? `I couldn't find any documents matching "${query}". Try searching with different keywords, or check if the document might be in a specific folder or have different tags.`
                : `I found ${matchingDocuments.length} document${matchingDocuments.length === 1 ? '' : 's'} that might be relevant to your search.`;
        }
    } catch (error) {
        console.error("Error generating conversational response:", error);
        return matchingDocuments.length === 0 
            ? `I couldn't find any documents matching "${query}". Try searching with different keywords, or check if the document might be in a specific folder or have different tags.`
            : `I found ${matchingDocuments.length} document${matchingDocuments.length === 1 ? '' : 's'} that might be relevant to your search.`;
    }
}