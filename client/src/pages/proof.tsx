import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function Proof() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <header className="border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-4xl mx-auto px-6 md:px-8 py-6">
          <Link href="/">
            <Button variant="ghost" className="gap-2" data-testid="button-back-home">
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 md:px-8 py-12">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          Clasio: Proof of Claims
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-400 mb-12">So, what exactly is Clasio? What does it do?</p>
        
        <div className="prose prose-gray dark:prose-invert max-w-none">
          <p className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-8">
            Clasio organizes your document chaos. Automatically. Snap, drop, or import a file and Clasio takes it from there.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-10 mb-4">Capture without friction</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            Upload PDFs, images, Word, Excel. Or import directly from Google Drive.
          </p>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            <strong>Camera capture:</strong> take a photo of a document on mobile; it's cleaned, classified, and filed.
          </p>
          <p className="text-gray-700 dark:text-gray-300">
            <strong>Voice mode:</strong> speak a request (e.g., "find my 2023 W‑2") and naturally converse with Clasio
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-10 mb-4">Auto-organize intelligently</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            Instant doc‑type detection (invoice, ID, contract), business category suggestions, topics, and concise 2–3 line summaries so you recognize files at a glance.
          </p>
          <p className="text-gray-700 dark:text-gray-300">
            Version history and bulk actions keep growing libraries tidy without duplicates.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-10 mb-4">Find, fast: two modes</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            <strong>Simple Search:</strong> quick, no‑nonsense search across names, content, tags, type, and date filters. This is for when you exactly know what document you need and that it exists.
          </p>
          <p className="text-gray-700 dark:text-gray-300">
            <strong>Ask Anything (AI Search):</strong> natural‑language questions with results explained via confidence indicators and a short "why this matched." Toggle between modes anytime.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-10 mb-4">Stay in control</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            View AI insights for every document (summary, topic tags, classifications) and see search analytics that reveal which docs matched and why.
          </p>
          <p className="text-gray-700 dark:text-gray-300">
            Drive sync lets you import in bulk (5 docs at a time for now) and keep changes consistent both ways.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-10 mb-4">Private by design</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            Files live in your private cloud; access is only via short‑lived, signed URLs.
          </p>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            Metadata (tags, folders, insights) is stored separately for auditability.
          </p>
          <p className="text-gray-700 dark:text-gray-300">
            Your documents are never used to train AI models.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-10 mb-4">Production‑ready reliability</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            Robust error handling, retries, and clean rollback keep uploads and downloads dependable.
          </p>
          <p className="text-gray-700 dark:text-gray-300">
            Clear "why this matched" explanations build trust and save time.
          </p>

          <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-16 mb-6">Technical Specifications</h2>

          <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-8 mb-4">1) Data privacy & tenancy (ingest → process → store → delete)</h3>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            <strong>Organization boundary with least‑privilege access:</strong> Clasio runs in an organization‑owned Google Cloud project (Cloud Identity). All data access uses service accounts with the minimum roles required; there is no human‑credential access path.
          </p>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            <strong>User‑scoped storage paths:</strong> Deterministic, validated paths per user and document — users/{'{userId}'}/docs/{'{docId}'}/{'{originalFileName}'}; objects are encrypted at rest and fetched only via V4 signed URLs.
          </p>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            <strong>Separation of concerns:</strong> Blobs in Google Cloud Storage; analysis artifacts and filing metadata in the database for clean auditing.
          </p>
          <p className="text-gray-700 dark:text-gray-300">
            <strong>Deletion you can trust:</strong> User‑initiated deletions cascade from metadata to storage within a defined window; we monitor and retry to ensure completion.
          </p>

          <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-8 mb-4">2) Model usage & training posture (Gemini 2.5 Flash‑Lite + Pro)</h3>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            <strong>No model training on customer data:</strong> Each request is private and not retained for training; we persist only compact analysis outputs required for product function (summary, topics, doc‑type, category).
          </p>
          <p className="text-gray-700 dark:text-gray-300">
            <strong>Right model for the job:</strong> Flash‑Lite for low‑latency extraction; Pro only for complex reasoning or long documents. All calls are server‑side, no client keys.
          </p>

          <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-8 mb-4">3) AI Search</h3>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            <strong>Semantic layer:</strong> multi‑field vector embeddings with cosine similarity and adaptive field weighting that picks the strongest signal rather than averaging weak ones.
          </p>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            <strong>Lexical layer:</strong> precise keyword matching with field‑specific boosts and a content‑hierarchy weight; behavioral signals can lift exact matches users prefer.
          </p>
          <p className="text-gray-700 dark:text-gray-300">
            <strong>Quality layer:</strong> temporal freshness, content completeness, and user interaction history refine ordering, so the most useful document appears first.
          </p>

          <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-8 mb-4">4) Folders & sub‑folders (predictable + self‑healing)</h3>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            Human‑friendly hierarchy with normalized, collision‑safe paths; moves/renames are transactional across metadata and storage.
          </p>
          <p className="text-gray-700 dark:text-gray-300">
            AI‑suggested destinations (e.g., Taxes → 2024 → Returns) keep canonical paths consistent while allowing user overrides.
          </p>

          <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-8 mb-4">5) Performance & UX guardrails</h3>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            Background processing keeps uploads responsive; frequent queries are cached for speed.
          </p>
          <p className="text-gray-700 dark:text-gray-300">
            Confidence bars and concise "why‑match" explanations increase trust and reduce triage time.
          </p>

          <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-8 mb-4">6) Camera Capture & Voice Mode</h3>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            <strong>Camera capture (mobile):</strong> on‑device image cleanup (orientation, crop, glare reduction), progressive upload via signed URLs, instant classify‑and‑file on arrival.
          </p>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            <strong>Voice mode:</strong> optional speech capture for hands‑free search or quick notes; audio is processed to text server‑side and not retained.
          </p>
          <p className="text-gray-700 dark:text-gray-300">
            <strong>Privacy holds:</strong> same signed‑URL pattern and least‑privilege access; nothing is exposed to the client beyond what's necessary to complete the action.
          </p>

          <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-16 mb-6">What we won't do</h2>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300 space-y-2">
            <li>We don't sell or share your personal data with advertisers.</li>
            <li>We don't expose bucket credentials to the client; access is only via signed URLs.</li>
            <li>We don't use your documents to train AI models. Ever.</li>
          </ul>

          <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-16 mb-6">How you (or your security team) can verify us quickly</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            <strong>Data‑use test:</strong> Upload a doc, delete it in‑product, then confirm the storage object and metadata are removed.
          </p>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            <strong>Access test:</strong> Try an expired signed URL; it should return 403 (no public reads).
          </p>
          <p className="text-gray-700 dark:text-gray-300">
            <strong>Explainability test:</strong> Compare the same query in Simple vs. AI Search and review the confidence and "why‑match" indicators.
          </p>
        </div>
      </main>
    </div>
  );
}
