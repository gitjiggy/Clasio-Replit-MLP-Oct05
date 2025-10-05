import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
    return <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800">
      {Math.round(confidence * 100)}% confident
    </Badge>;
  } else if (confidence >= 0.75) {
    return <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800">
      {Math.round(confidence * 100)}% confident
    </Badge>;
  } else {
    return <Badge variant="outline" className="bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-400 border-slate-200 dark:border-slate-800">
      {Math.round(confidence * 100)}% confident
    </Badge>;
  }
}

export function AnswerCard({ answer, confidence, sourceDocument, context, matchType, onDocumentClick }: AnswerCardProps) {
  return (
    <Card 
      className="border-l-4 border-l-indigo-500 bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 hover:shadow-md transition-all duration-200"
      data-testid={`answer-card-${matchType}`}
    >
      <CardContent className="p-4 space-y-3">
        {/* Answer Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            {getMatchTypeIcon(matchType)}
            <span className="font-medium">{getMatchTypeLabel(matchType)}</span>
          </div>
          {getConfidenceBadge(confidence)}
        </div>

        {/* Main Answer */}
        <div className="space-y-2">
          <p 
            className="text-lg font-medium text-[#1E1E1E] dark:text-slate-100 leading-relaxed"
            data-testid="answer-text"
          >
            {answer}
          </p>
          {context && (
            <p className="text-sm text-slate-600 dark:text-slate-400 italic" data-testid="answer-context">
              {context}
            </p>
          )}
        </div>

        {/* Source Document Attribution */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <FileText className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
              <span className="text-xs text-slate-500 dark:text-slate-400 flex-shrink-0">Source:</span>
              <button
                onClick={() => onDocumentClick(sourceDocument.id)}
                className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium truncate hover:underline transition-colors"
                data-testid={`source-document-${sourceDocument.id}`}
              >
                {sourceDocument.name}
              </button>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDocumentClick(sourceDocument.id)}
              className="text-xs flex-shrink-0"
              data-testid="button-view-source"
            >
              View Source
            </Button>
          </div>
        </div>
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
    <div className="space-y-4" data-testid="consciousness-search-results">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Lightbulb className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
          Direct Answers
        </h3>
        <Badge variant="secondary" className="ml-auto" data-testid="answer-count">
          {answers.length} {answers.length === 1 ? 'answer' : 'answers'}
        </Badge>
      </div>

      {/* Answer Cards */}
      <div className="space-y-3">
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
