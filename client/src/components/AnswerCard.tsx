import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, CheckCircle, Lightbulb, Hash, Tag } from "lucide-react";
import type { DocumentWithFolderAndTags } from "@shared/schema";

interface AnswerCardProps {
  answer: string;
  confidence: number;
  sourceDocument: DocumentWithFolderAndTags;
  context: string;
  matchType: 'instant_answer' | 'identifier' | 'key_question' | 'semantic_tag';
  onDocumentClick: (documentId: string) => void;
}

function getMatchTypeIcon(matchType: string) {
  switch (matchType) {
    case 'instant_answer':
      return <Lightbulb className="w-4 h-4" />;
    case 'identifier':
      return <Hash className="w-4 h-4" />;
    case 'key_question':
      return <CheckCircle className="w-4 h-4" />;
    case 'semantic_tag':
      return <Tag className="w-4 h-4" />;
    default:
      return <FileText className="w-4 h-4" />;
  }
}

function getMatchTypeLabel(matchType: string) {
  switch (matchType) {
    case 'instant_answer':
      return 'Instant Answer';
    case 'identifier':
      return 'Identifier';
    case 'key_question':
      return 'Key Question';
    case 'semantic_tag':
      return 'Related Topic';
    default:
      return 'Match';
  }
}

function getConfidenceBadge(confidence: number) {
  if (confidence >= 0.90) {
    return <Badge variant="outline" className="bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800">
      {Math.round(confidence * 100)}% confident
    </Badge>;
  } else if (confidence >= 0.75) {
    return <Badge variant="outline" className="bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800">
      {Math.round(confidence * 100)}% confident
    </Badge>;
  } else {
    return <Badge variant="outline" className="bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700">
      {Math.round(confidence * 100)}% confident
    </Badge>;
  }
}

export function AnswerCard({ answer, confidence, sourceDocument, context, matchType, onDocumentClick }: AnswerCardProps) {
  return (
    <Card 
      className="border-l-4 border-l-purple-500 dark:border-l-purple-400 bg-gradient-to-br from-purple-50/50 via-indigo-50/30 to-white dark:from-purple-950/30 dark:via-indigo-950/20 dark:to-slate-950 hover:shadow-lg hover:shadow-purple-100 dark:hover:shadow-purple-900/20 transition-all duration-200"
      data-testid={`answer-card-${matchType}`}
    >
      <CardContent className="p-3 md:p-4 space-y-2 md:space-y-3">
        {/* Answer Header */}
        <div className="flex items-start justify-between gap-2 md:gap-3">
          <div className="flex items-center gap-2 text-sm text-purple-600 dark:text-purple-400">
            {getMatchTypeIcon(matchType)}
            <span className="font-medium">{getMatchTypeLabel(matchType)}</span>
          </div>
          {getConfidenceBadge(confidence)}
        </div>

        {/* Main Answer in Styled Text Box */}
        <div className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950/50 dark:to-indigo-950/50 border border-purple-200 dark:border-purple-800 rounded-lg p-3 md:p-4">
          <p 
            className="text-lg font-semibold text-[#1E1E1E] dark:text-slate-100 leading-relaxed"
            data-testid="answer-text"
          >
            {answer}
          </p>
          {context && (
            <p className="text-sm text-slate-600 dark:text-slate-400 italic mt-2" data-testid="answer-context">
              {context}
            </p>
          )}
        </div>

        {/* Source Document Attribution - hide for semantic tags */}
        {matchType !== 'semantic_tag' && (
          <div className="pt-2 md:pt-3 border-t border-purple-100 dark:border-purple-900/50">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-purple-500 dark:text-purple-400 flex-shrink-0" />
              <span className="text-xs text-slate-600 dark:text-slate-400 flex-shrink-0">Source:</span>
              <button
                onClick={() => onDocumentClick(sourceDocument.id)}
                className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium truncate hover:underline transition-colors"
                data-testid={`source-document-${sourceDocument.id}`}
              >
                {sourceDocument.name}
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ConsciousnessSearchResultsProps {
  hasAnswer: boolean;
  answers: Array<{
    answer: string;
    confidence: number;
    sourceDocument: DocumentWithFolderAndTags;
    context: string;
    matchType: 'instant_answer' | 'identifier' | 'key_question' | 'semantic_tag';
  }>;
  query: string;
  onDocumentClick: (documentId: string) => void;
}

export function ConsciousnessSearchResults({ hasAnswer, answers, query, onDocumentClick }: ConsciousnessSearchResultsProps) {
  if (!hasAnswer || answers.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 md:space-y-4" data-testid="consciousness-search-results">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-purple-100 dark:border-purple-900/50">
        <Lightbulb className="w-5 h-5 text-purple-600 dark:text-purple-400" />
        <h3 className="text-lg font-semibold bg-gradient-to-r from-purple-600 to-indigo-600 dark:from-purple-400 dark:to-indigo-400 bg-clip-text text-transparent">
          Direct Answers
        </h3>
        <Badge variant="secondary" className="ml-auto bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800" data-testid="answer-count">
          {answers.length} {answers.length === 1 ? 'answer' : 'answers'}
        </Badge>
      </div>

      {/* Answer Cards */}
      <div className="space-y-2 md:space-y-3">
        {answers.map((answer, index) => (
          <AnswerCard
            key={`${answer.sourceDocument.id}-${index}`}
            answer={answer.answer}
            confidence={answer.confidence}
            sourceDocument={answer.sourceDocument}
            context={answer.context}
            matchType={answer.matchType}
            onDocumentClick={onDocumentClick}
          />
        ))}
      </div>
    </div>
  );
}
