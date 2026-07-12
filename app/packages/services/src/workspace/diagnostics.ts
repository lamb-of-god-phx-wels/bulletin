import {
  parseDiagnosticCode,
  type DiagnosticRecord,
  type RecoveryAction,
} from "@cbb/core";

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu;
const PATH_LIKE = /(?:[A-Za-z]:)?[^\s"'<>]*[\\/][^\s"'<>]*/gu;

function sanitizedTechnicalDetail(value: string): string {
  return value
    .normalize("NFC")
    .replace(CONTROL, "�")
    .replace(PATH_LIKE, "<redacted-path>")
    .slice(0, 2_000);
}

export function serviceDiagnostic(input: {
  readonly code: string;
  readonly correlationId: string;
  readonly operation: string;
  readonly userSummary: string;
  readonly technicalDetail?: string;
  readonly recoveryActions?: readonly RecoveryAction[];
  readonly resourceKind?: string;
  readonly resourceLabel?: string;
}): DiagnosticRecord {
  return {
    code: parseDiagnosticCode(input.code),
    severity: "error",
    disposition: "block",
    correlationId: input.correlationId,
    operation: input.operation,
    userSummary: input.userSummary,
    ...(input.technicalDetail === undefined
      ? {}
      : { technicalDetail: sanitizedTechnicalDetail(input.technicalDetail) }),
    ...(input.resourceKind === undefined ? {} : { resourceKind: input.resourceKind }),
    ...(input.resourceLabel === undefined ? {} : { resourceLabel: input.resourceLabel }),
    recoveryActions: input.recoveryActions ?? ["cancel"],
    redactionClass: "redacted-paths",
  };
}
