import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function Proof() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-gray-50 to-white dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-950/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 py-4 md:py-6">
          <Link href="/">
            <Button variant="ghost" className="gap-2 font-light" data-testid="button-back-home">
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 py-8 md:py-12">
        <h1 className="text-3xl md:text-4xl font-light text-gray-900 dark:text-gray-100 mb-3 md:mb-4 tracking-wide">
          Clasio: Proof of Claims
        </h1>
        <p className="text-lg md:text-xl text-gray-600 dark:text-gray-400 mb-8 md:mb-12 font-light">So, what exactly is Clasio? What does it do?</p>
        
        <div className="max-w-none">
          <p className="text-lg md:text-xl font-light text-gray-900 dark:text-gray-100 mb-6 md:mb-8">
            Clasio organizes your document chaos. Automatically. Snap, drop, or import a file and Clasio takes it from there.
          </p>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-8 md:mt-10 mb-3 md:mb-4 tracking-wide">Capture without friction</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            Upload PDFs, images, Word, Excel. Or import directly from Google Drive.
          </p>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            <strong>Camera capture:</strong> take a photo of a document on mobile; it's cleaned, classified, and filed.
          </p>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            <strong>Voice mode:</strong> speak a request (e.g., "find my 2023 W‑2") and naturally converse with Clasio
          </p>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-8 md:mt-10 mb-3 md:mb-4 tracking-wide">Auto-organize intelligently</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            Instant doc‑type detection (invoice, ID, contract), business category suggestions, topics, and concise 2–3 line summaries so you recognize files at a glance.
          </p>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            Version history and bulk actions keep growing libraries tidy without duplicates.
          </p>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-8 md:mt-10 mb-3 md:mb-4 tracking-wide">Find, fast: two modes</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            <strong>Simple Search:</strong> quick, no‑nonsense search across names, content, tags, type, and date filters. This is for when you exactly know what document you need and that it exists.
          </p>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            <strong>Ask Anything (AI Search):</strong> natural‑language questions with results explained via confidence indicators and a short "why this matched." Toggle between modes anytime.
          </p>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-8 md:mt-10 mb-3 md:mb-4 tracking-wide">Stay in control</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            View AI insights for every document (summary, topic tags, classifications) and see search analytics that reveal which docs matched and why.
          </p>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            Drive sync lets you import in bulk (5 docs at a time for now) and keep changes consistent both ways.
          </p>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-8 md:mt-10 mb-3 md:mb-4 tracking-wide">Private by design</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            Files live in your private cloud; access is only via short‑lived, signed URLs.
          </p>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            Metadata (tags, folders, insights) is stored separately for auditability.
          </p>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            Your documents are never used to train AI models.
          </p>

          <h2 className="text-xl md:text-2xl font-light text-gray-900 dark:text-gray-100 mt-8 md:mt-10 mb-3 md:mb-4 tracking-wide">Production‑ready reliability</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            Robust error handling, retries, and clean rollback keep uploads and downloads dependable.
          </p>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            Clear "why this matched" explanations build trust and save time.
          </p>

          <h2 className="text-2xl md:text-3xl font-light text-gray-900 dark:text-gray-100 mt-12 md:mt-16 mb-4 md:mb-6 tracking-wide">Technical Specifications</h2>

          <h3 className="text-lg md:text-xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">1) Data privacy & tenancy (ingest → process → store → delete)</h3>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            <strong>Organization boundary with least‑privilege access:</strong> Clasio runs in an organization‑owned Google Cloud project (Cloud Identity). All data access uses service accounts with the minimum roles required; there is no human‑credential access path.
          </p>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            <strong>User‑scoped storage paths:</strong> Deterministic, validated paths per user and document — users/{'{userId}'}/docs/{'{docId}'}/{'{originalFileName}'}; objects are encrypted at rest and fetched only via V4 signed URLs.
          </p>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            <strong>Separation of concerns:</strong> Blobs in Google Cloud Storage; analysis artifacts and filing metadata in the database for clean auditing.
          </p>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            <strong>Deletion you can trust:</strong> User‑initiated deletions cascade from metadata to storage within a defined window; we monitor and retry to ensure completion.
          </p>

          <h3 className="text-lg md:text-xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">2) Model usage & training posture (Gemini 2.5 Flash‑Lite + Pro)</h3>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            <strong>No model training on customer data:</strong> Each request is private and not retained for training; we persist only compact analysis outputs required for product function (summary, topics, doc‑type, category).
          </p>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            <strong>Right model for the job:</strong> Flash‑Lite for low‑latency extraction; Pro only for complex reasoning or long documents. All calls are server‑side, no client keys.
          </p>

          <h3 className="text-lg md:text-xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">3) AI Search</h3>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            <strong>Semantic layer:</strong> multi‑field vector embeddings with cosine similarity and adaptive field weighting that picks the strongest signal rather than averaging weak ones.
          </p>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            <strong>Lexical layer:</strong> precise keyword matching with field‑specific boosts and a content‑hierarchy weight; behavioral signals can lift exact matches users prefer.
          </p>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            <strong>Quality layer:</strong> temporal freshness, content completeness, and user interaction history refine ordering, so the most useful document appears first.
          </p>

          <h3 className="text-lg md:text-xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">4) Folders & sub‑folders (predictable + self‑healing)</h3>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            Human‑friendly hierarchy with normalized, collision‑safe paths; moves/renames are transactional across metadata and storage.
          </p>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            AI‑suggested destinations (e.g., Taxes → 2024 → Returns) keep canonical paths consistent while allowing user overrides.
          </p>

          <h3 className="text-lg md:text-xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">5) Performance & UX guardrails</h3>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            Background processing keeps uploads responsive; frequent queries are cached for speed.
          </p>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            Confidence bars and concise "why‑match" explanations increase trust and reduce triage time.
          </p>

          <h3 className="text-lg md:text-xl font-light text-gray-900 dark:text-gray-100 mt-6 md:mt-8 mb-3 md:mb-4 tracking-wide">6) Camera Capture & Voice Mode</h3>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            <strong>Camera capture (mobile):</strong> on‑device image cleanup (orientation, crop, glare reduction), progressive upload via signed URLs, instant classify‑and‑file on arrival.
          </p>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            <strong>Voice mode:</strong> optional speech capture for hands‑free search or quick notes; audio is processed to text server‑side and not retained.
          </p>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            <strong>Privacy holds:</strong> same signed‑URL pattern and least‑privilege access; nothing is exposed to the client beyond what's necessary to complete the action.
          </p>

          <h2 className="text-2xl md:text-3xl font-light text-gray-900 dark:text-gray-100 mt-12 md:mt-16 mb-4 md:mb-6 tracking-wide">What we won't do</h2>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300 space-y-2 font-light">
            <li>We don't sell or share your personal data with advertisers.</li>
            <li>We don't expose bucket credentials to the client; access is only via signed URLs.</li>
            <li>We don't use your documents to train AI models. Ever.</li>
          </ul>

          <h2 className="text-2xl md:text-3xl font-light text-gray-900 dark:text-gray-100 mt-12 md:mt-16 mb-4 md:mb-6 tracking-wide">How you (or your security team) can verify us quickly</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            <strong>Data‑use test:</strong> Upload a doc, delete it in‑product, then confirm the storage object and metadata are removed.
          </p>
          <p className="text-gray-700 dark:text-gray-300 mb-3 font-light">
            <strong>Access test:</strong> Try an expired signed URL; it should return 403 (no public reads).
          </p>
          <p className="text-gray-700 dark:text-gray-300 font-light">
            <strong>Explainability test:</strong> Compare the same query in Simple vs. AI Search and review the confidence and "why‑match" indicators.
          </p>
        </div>
      </main>
    </div>
  );
}
