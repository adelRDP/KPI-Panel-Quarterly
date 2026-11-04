// Decimal megabytes of extracted evidence, independent of the upload file size.
export const MAX_FULL_FILE_EVIDENCE_BYTES=5_000_000;
// Large evidence is read in bounded requests; raising the total must not leave
// the former 48-part ceiling blocking files that exceed the old 2 MB budget.
export const MAX_FULL_FILE_PARTS=160;
