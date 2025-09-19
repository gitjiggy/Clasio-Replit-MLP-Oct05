// Gemini AI service for document analysis and summarization
// Based on blueprint:javascript_gemini

import { GoogleGenerativeAI } from "@google/generative-ai";
import { ObjectStorageService } from "./objectStorage.js";

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
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
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
            model: "gemini-2.0-flash-exp",
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 1000,
            }
        });
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const rawJson = response.text();
        
        console.log(`AI Analysis Response: ${rawJson}`);

        if (rawJson) {
            // Clean the response to ensure it's valid JSON
            const cleanedJson = rawJson.replace(/```json\n?/g, '').replace(/```/g, '').trim();
            const data = JSON.parse(cleanedJson);
            
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
        // Extract the object path from the file path
        // File paths are stored as object storage paths like "/objects/public/documents/..."
        const objectPath = filePath.startsWith('/objects/') ? filePath.substring(9) : filePath;
        
        // Get the file buffer from object storage
        const fileBuffer = await objectStorageService.getObjectBuffer(objectPath);
        
        // For text files, convert buffer to string
        if (mimeType === 'text/plain' || mimeType === 'text/csv') {
            return fileBuffer.toString('utf-8');
        }
        
        // For images, use Gemini's vision capabilities to extract text
        if (mimeType.startsWith('image/')) {
            return await extractTextFromImageBuffer(fileBuffer, mimeType);
        }
        
        // For other file types, return a message
        return `Text extraction from ${mimeType} files is not yet supported. Currently supporting text files and images for AI analysis.`;
        
    } catch (error) {
        console.error("Error extracting text from document:", error);
        return "Error extracting text from document. Please ensure the file is accessible and try again.";
    }
}

async function extractTextFromImageBuffer(imageBuffer: Buffer, mimeType: string): Promise<string> {
    try {
        if (!process.env.GEMINI_API_KEY) {
            return "AI image analysis unavailable - API key not configured.";
        }

        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

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