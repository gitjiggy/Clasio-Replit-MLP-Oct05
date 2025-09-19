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
            documentType: "Unknown",
            category: "General",
            wordCount: 0
        };
    }

    if (!process.env.GEMINI_API_KEY) {
        return {
            keyTopics: ["API key required"],
            documentType: "Unknown",
            category: "General",
            wordCount: text.split(/\s+/).length
        };
    }

    const wordCount = text.split(/\s+/).length;
    
    const prompt = `Analyze the following document and provide a JSON response with:
1. Key topics (up to 5 most important topics as an array of strings)
2. Document type (e.g., "Report", "Contract", "Letter", "Invoice", "Technical Documentation", etc.)
3. Document category for filing purposes - choose the MOST relevant one: "Taxes", "Medical", "Insurance", "Legal", "Immigration", "Financial", "Employment", "Education", "Real Estate", "Travel", "Personal", or "Business"

Format your response as JSON only, no additional text:
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
                temperature: 0.1,
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
            
            return {
                keyTopics: Array.isArray(data.keyTopics) ? data.keyTopics.slice(0, 5) : ["Analysis unavailable"],
                documentType: data.documentType || "Unknown",
                category: data.category || "General",
                wordCount
            };
        } else {
            throw new Error("Empty response from model");
        }
    } catch (error) {
        console.error("Error analyzing document content:", error);
        return {
            keyTopics: ["Analysis unavailable"],
            documentType: "Unknown",
            category: "General",
            wordCount
        };
    }
}

export async function extractTextFromDocument(filePath: string, mimeType: string): Promise<string> {
    try {
        console.log(`Extracting text from document: ${filePath}, mimeType: ${mimeType}`);
        
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