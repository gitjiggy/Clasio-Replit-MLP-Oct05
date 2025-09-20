// Gemini AI service for document analysis and summarization
// Based on blueprint:javascript_gemini

import { GoogleGenerativeAI } from "@google/generative-ai";
import { ObjectStorageService } from "./objectStorage.js";
// Text extraction libraries
import mammoth from "mammoth";
import * as XLSX from "xlsx";

// Dynamic imports for libraries without built-in TypeScript definitions
async function getPdfParse() {
  const pdfParse = await import('pdf-parse');
  return pdfParse.default as (buffer: Buffer) => Promise<PDFData>;
}

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

    const prompt = `Please provide a very concise 2-3 line summary of this document, focusing only on the most essential information and key points. Be brief and direct:\n\n${text}`;

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
}> {
    if (!text || text.trim().length === 0) {
        return {
            keyTopics: [],
            documentType: "Other",
            category: "Personal",
            wordCount: 0
        };
    }

    if (!process.env.GEMINI_API_KEY) {
        return {
            keyTopics: ["API key required"],
            documentType: "Other",
            category: "Personal",
            wordCount: text.split(/\s+/).length
        };
    }

    const wordCount = text.split(/\s+/).length;
    
    // Pre-processing: Apply keyword-based rules for better accuracy
    const textLower = text.toLowerCase();
    let keywordCategory = null;
    let keywordDocumentType = null;
    
    // HIGHEST PRIORITY: Tax-specific patterns - must come first to override AI misclassification
    if (/(irs|franchise tax board|form 1040|w[- ]?2|1099|tax return|schedule [a-z]|state tax|federal tax|ca tax|california tax|income tax|tax filing|taxpayer|adjusted gross income|tax year|agi|deduction|exemption|refund|tax liability)/i.test(text)) {
        keywordCategory = "Taxes";
        keywordDocumentType = "Tax Document";
        console.log("🎯 Tax document detected by deterministic rules");
    }
    
    // Resume-specific patterns  
    else if (/(resume|curriculum vitae|cv|professional experience|work experience|skills|qualifications|career objective|employment history|education background)/i.test(text)) {
        keywordCategory = "Employment";
        keywordDocumentType = "Resume";
        console.log("🎯 Resume document detected by deterministic rules");
    }
    
    // Education-specific patterns - made more specific to avoid false positives
    else if (/(back to school night|syllabus|homework assignment|pta meeting|pto meeting|school night|curriculum guide|parent teacher conference|class schedule|school event announcement|academic calendar|teacher communication|school enrollment|grade report)/i.test(text)) {
        keywordCategory = "Education";
        if (/(back to school|school night|pta|pto|school event|meeting|notice|announcement)/i.test(text)) {
            keywordDocumentType = "Event Notice";
        } else if (/(syllabus|curriculum|homework|academic)/i.test(text)) {
            keywordDocumentType = "Academic Document";
        }
    }
    
    // If deterministic rules matched, return immediately without AI
    if (keywordCategory && keywordDocumentType) {
        return {
            keyTopics: keywordCategory === "Taxes" ? ["Tax Forms", "Financial Records", "Government Documents"] :
                      keywordCategory === "Employment" ? ["Professional Experience", "Career History", "Skills"] :
                      ["Education", "Academic", "School"],
            documentType: keywordDocumentType,
            category: keywordCategory,
            wordCount: wordCount
        };
    }

    const prompt = `You are a document classification expert. Analyze the following document and provide a JSON response.

STRICT REQUIREMENTS:
1. Key topics: Extract up to 5 most important topics as an array of strings
2. Document type: Must be EXACTLY one of these options:
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
   - "Other"

3. Category: Must be EXACTLY one of these: "Taxes", "Medical", "Insurance", "Legal", "Immigration", "Financial", "Employment", "Education", "Real Estate", "Travel", "Personal", "Business"

EXAMPLES:
- "2022 Fall Back to School Night" → {"documentType": "Event Notice", "category": "Education"}
- "John Smith Resume 2024" → {"documentType": "Resume", "category": "Business"}
- "Stanford Personal Statement Draft" → {"documentType": "Personal Statement", "category": "Education"}

${keywordCategory ? `HINT: Based on content analysis, this appears to be category "${keywordCategory}"` : ''}
${keywordDocumentType ? ` and type "${keywordDocumentType}"` : ''}

Format response as JSON only:
{
  "keyTopics": ["topic1", "topic2", "topic3"],
  "documentType": "Document Type",
  "category": "Category"
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
        
        console.log(`AI Analysis Response: ${rawJson}`);

        if (rawJson) {
            // With responseMimeType: "application/json", the response should be clean JSON
            const data = JSON.parse(rawJson);
            
            // Post-processing validation: Ensure responses conform to strict taxonomy
            const validDocumentTypes = [
                "Resume", "Cover Letter", "Contract", "Invoice", "Receipt", "Tax Document",
                "Medical Record", "Insurance Document", "Legal Document", "Immigration Document",
                "Financial Statement", "Employment Document", "Event Notice", "Academic Document",
                "Real Estate Document", "Travel Document", "Personal Statement", 
                "Technical Documentation", "Business Report", "Other"
            ];
            
            const validCategories = [
                "Taxes", "Medical", "Insurance", "Legal", "Immigration", "Financial",
                "Employment", "Education", "Real Estate", "Travel", "Personal", "Business"
            ];
            
            // Apply keyword overrides if detected
            let finalDocumentType = validDocumentTypes.includes(data.documentType) ? data.documentType : "Other";
            let finalCategory = validCategories.includes(data.category) ? data.category : "Personal";
            
            // Only use keyword overrides as tie-breakers when AI confidence is low
            // Prefer the AI model's structured output with temperature=0
            if (keywordCategory && validCategories.includes(keywordCategory) && 
                (!data.category || !validCategories.includes(data.category))) {
                finalCategory = keywordCategory;
            }
            if (keywordDocumentType && validDocumentTypes.includes(keywordDocumentType) && 
                (!data.documentType || !validDocumentTypes.includes(data.documentType))) {
                finalDocumentType = keywordDocumentType;
            }
            
            return {
                keyTopics: Array.isArray(data.keyTopics) ? data.keyTopics.slice(0, 5) : ["Analysis unavailable"],
                documentType: finalDocumentType,
                category: finalCategory,
                wordCount
            };
        } else {
            throw new Error("Empty response from model");
        }
    } catch (error) {
        console.error("Error analyzing document content:", error);
        return {
            keyTopics: ["Analysis unavailable"],
            documentType: "Other",
            category: "Personal",
            wordCount
        };
    }
}

export async function extractTextFromDocument(filePath: string, mimeType: string, driveAccessToken?: string): Promise<string> {
    try {
        console.log(`Extracting text from document: ${filePath}, mimeType: ${mimeType}`);
        
        // Handle Google Drive documents
        if (filePath.startsWith('drive:')) {
            const driveFileId = filePath.substring(6); // Remove 'drive:' prefix
            console.log(`Extracting content from Google Drive document: ${driveFileId}`);
            
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
                        return fileContent.content;
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
                    
                    // Use existing extraction logic for binary files
                    if (mimeType === 'application/pdf') {
                        const pdfParse = await getPdfParse();
                        const data = await pdfParse(fileBuffer.buffer);
                        return data.text || '';
                    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                        const result = await mammoth.extractRawText({ buffer: fileBuffer.buffer });
                        return result.value || '';
                    } else if (mimeType === 'application/msword') {
                        const WordExtractor = await getWordExtractor();
                        const extractor = new WordExtractor();
                        const extracted = await extractor.extract(fileBuffer.buffer);
                        return extracted.getBody() || '';
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
        // File paths are stored as object storage paths like "/objects/public/documents/..."
        const objectPath = filePath.startsWith('/objects/') ? filePath.substring(9) : filePath;
        
        // Get the file buffer from object storage
        const fileBuffer = await objectStorageService.getObjectBuffer(objectPath);
        
        // For text files, convert buffer to string
        if (mimeType === 'text/plain' || mimeType === 'text/csv') {
            return fileBuffer.toString('utf-8');
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

// PDF text extraction using pdf-parse
async function extractTextFromPDF(buffer: Buffer): Promise<string> {
    try {
        console.log("Extracting text from PDF...");
        const pdfParse = await getPdfParse();
        const data = await pdfParse(buffer);
        const text = data.text?.trim();
        
        if (!text || text.length === 0) {
            console.log("No text found in PDF, attempting OCR fallback...");
            // If no text found, try OCR using Gemini vision as fallback
            return await extractTextFromImageBuffer(buffer, 'application/pdf') + " (extracted via OCR)";
        }
        
        console.log(`PDF text extracted: ${text.length} characters`);
        return text;
    } catch (error) {
        console.error("Error extracting text from PDF:", error);
        return "Error extracting text from PDF document.";
    }
}

// Word document (.docx) text extraction using mammoth
async function extractTextFromWordDocx(buffer: Buffer): Promise<string> {
    try {
        console.log("Extracting text from DOCX...");
        const result = await mammoth.extractRawText({ buffer });
        const text = result.value?.trim();
        
        if (result.messages && result.messages.length > 0) {
            console.log("Mammoth warnings:", result.messages);
        }
        
        console.log(`DOCX text extracted: ${text?.length || 0} characters`);
        return text || "No text content found in Word document.";
    } catch (error) {
        console.error("Error extracting text from DOCX:", error);
        return "Error extracting text from Word document.";
    }
}

// Legacy Word document (.doc) text extraction using word-extractor
async function extractTextFromWordDoc(buffer: Buffer): Promise<string> {
    try {
        console.log("Extracting text from DOC...");
        const WordExtractor = await getWordExtractor();
        const extractor = new WordExtractor();
        const extracted = await extractor.extract(buffer);
        const text = extracted.getBody()?.trim();
        
        console.log(`DOC text extracted: ${text?.length || 0} characters`);
        return text || "No text content found in Word document.";
    } catch (error) {
        console.error("Error extracting text from DOC:", error);
        return "Error extracting text from legacy Word document.";
    }
}

// Excel text extraction using xlsx
async function extractTextFromExcel(buffer: Buffer): Promise<string> {
    try {
        console.log("Extracting text from Excel...");
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        let allText = '';
        
        // Extract text from all worksheets
        workbook.SheetNames.forEach((sheetName, index) => {
            console.log(`Processing sheet: ${sheetName}`);
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
        console.log(`Excel text extracted: ${text.length} characters from ${workbook.SheetNames.length} sheets`);
        return text || "No text content found in Excel document.";
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

        return text || "No text could be extracted from this image.";
    } catch (error) {
        console.error("Error extracting text from image:", error);
        return "Error extracting text from image.";
    }
}