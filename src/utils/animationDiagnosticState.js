// Imported only by guarded diagnostic code; ordinary releases eliminate these calls.
let sink = null;
export function setAnimationDiagnosticSink(next) { sink = next; }
export function recordPlayerAnimationState(source, data) { sink?.(source, data); }
