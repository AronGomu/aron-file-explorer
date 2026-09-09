# Inline Review Execution

This local bundle forbids delegation. Keep this path because upstream playbooks
reference it, but execute every task in current context.

## Rules

R1. Read each triggered reviewer, mapper, verifier, or tracer file.

R2. Apply its checklist inline, serially. Never spawn workers, delegate, fan out,
or parallelize model work.

R3. Preserve gate classification: mandatory review failure blocks
`locally-verified`; advisory review gaps become terminal warnings.

R4. Keep one writer. Reviewer phases inspect first, report findings, then parent
applies accepted fixes.

R5. Record base SHA, scope, evidence, findings, disposition, retries, verification,
and terminal state in run ledger.

R6. For multiple reviews, finish each report before starting next. Reconcile all
reports inline using `subagents/findings-reconciler.md` as checklist.

R7. For plan challenge, runtime tracing, integration verification, or specialized
review, read named file then perform same steps inline. Missing context isolation
is known limitation; report it instead of compensating with delegation.

## Inline task record

T1. Task ID plus role.

T2. Mandatory/advisory status.

T3. Base SHA plus input paths/hashes.

T4. Status: `PENDING | RUNNING | PASSED | FAILED | FALLBACK | CANCELLED`.

T5. Findings plus evidence.

T6. Fix/disposition owner.

T7. Verification result.
