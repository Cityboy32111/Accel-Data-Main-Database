// Client for the pipeline-ingest Edge Function. The worker holds only a scoped,
// revocable worker token; the service-role key lives inside the function.

import type { WorkerConfig } from "./config.js";

export interface IngestDocumentInput {
  case_id: string;
  source_id: string;
  original_url: string;
  sha256: string;
  title: string;
  document_category: string;
  docket_number: string | null;
  docket_suffix: string | null;
  filed_date: string | null;
  page_count: number;
  restriction_flags: string[];
  halted: boolean;
  screening_notes: string | null;
  pages: { page_number: number; text: string; text_method: "text_layer" | "ocr" | "none"; pii_masked: boolean }[];
}

export class IngestClient {
  constructor(private readonly cfg: WorkerConfig, private readonly fetchImpl: typeof fetch = fetch) {
    if (!cfg.PIPELINE_WORKER_TOKEN) throw new Error("PIPELINE_WORKER_TOKEN is required for database writes");
  }

  private url(): string {
    return `${this.cfg.SUPABASE_URL}/functions/v1/pipeline-ingest`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { "x-worker-token": this.cfg.PIPELINE_WORKER_TOKEN, ...extra };
  }

  private async parse<T>(res: Response): Promise<T> {
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text.slice(0, 500) };
    }
    if (!res.ok) {
      const err = (body as { error?: string }).error ?? `HTTP ${res.status}`;
      throw new Error(`pipeline-ingest ${res.status}: ${err}`);
    }
    return body as T;
  }

  async ingestDocument(meta: IngestDocumentInput, pdf: Uint8Array): Promise<{ document_id: string; skipped?: string; pages_written?: number; halted?: boolean }> {
    const form = new FormData();
    form.set("action", "ingest_document");
    form.set("metadata", JSON.stringify(meta));
    const buffer = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    form.set("file", new Blob([buffer], { type: "application/pdf" }), `${meta.sha256}.pdf`);
    const res = await this.fetchImpl(this.url(), { method: "POST", headers: this.headers(), body: form });
    return this.parse(res);
  }

  async json<T>(body: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(this.url(), {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
    return this.parse<T>(res);
  }

  recomputeCoverage(case_id: string, documents_known: number | null): Promise<{ coverage: unknown }> {
    return this.json({ action: "recompute_coverage", case_id, documents_known });
  }

  status(case_id: string): Promise<Record<string, unknown>> {
    return this.json({ action: "status", case_id });
  }
}
