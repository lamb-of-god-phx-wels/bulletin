import type { QuarantineWorkerPort } from "./broker.js";
import { validateQuarantineRequest, type QuarantineRequest } from "./protocol.js";

/**
 * Closed operation router: PDF flattening never reaches the static parser
 * worker, while archive/SVG/raster/font operations never reach dynamic Poppler.
 */
export class RoutedLinuxQuarantineWorker implements QuarantineWorkerPort {
  readonly isolationAvailable: boolean;
  readonly #active = new Map<string, QuarantineWorkerPort>();

  constructor(
    private readonly staticWorker: QuarantineWorkerPort,
    private readonly pdfFlattener: QuarantineWorkerPort,
  ) {
    this.isolationAvailable = staticWorker.isolationAvailable === true &&
      pdfFlattener.isolationAvailable === true;
  }

  async execute(request: QuarantineRequest): Promise<unknown> {
    validateQuarantineRequest(request);
    if (this.#active.has(request.requestId)) {
      throw new Error("Duplicate routed quarantine request");
    }
    const target = request.operation === "flattenPdf" ? this.pdfFlattener : this.staticWorker;
    this.#active.set(request.requestId, target);
    try {
      return await target.execute(request);
    } finally {
      this.#active.delete(request.requestId);
    }
  }

  async terminate(requestId: string): Promise<void> {
    await this.#active.get(requestId)?.terminate(requestId);
  }
}
