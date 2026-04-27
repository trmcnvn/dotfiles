type BatchWebfetchDetails = {
  readonly finalUrl: string;
  readonly format: string;
};

export type BatchWebfetchSuccessResult = {
  readonly index: number;
  readonly url: string;
  readonly ok: true;
  readonly content: string;
  readonly details: BatchWebfetchDetails;
};

export type BatchWebfetchFailureResult = {
  readonly index: number;
  readonly url: string;
  readonly ok: false;
  readonly error: string;
};

export type BatchWebfetchResult = BatchWebfetchSuccessResult | BatchWebfetchFailureResult;

export type TruncatedBatchWebfetchText = {
  readonly text: string;
  readonly truncated: boolean;
  readonly fullOutputPath: string | null;
};

export type TruncateBatchWebfetchText = (
  content: string,
) => Promise<TruncatedBatchWebfetchText>;

export type BatchWebfetchOutput = {
  readonly text: string;
  readonly succeeded: number;
  readonly failed: number;
  readonly truncated: boolean;
  readonly fullOutputPath: string | null;
};

const OUTPUT_EMPTY_MESSAGE = "The fetched page did not contain any readable content.";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const formatBatchWebfetchResult = (result: BatchWebfetchResult): string => {
  const heading = `## ${result.index + 1}. ${result.ok ? "✓" : "✗"} ${result.url}`;

  if (!result.ok) {
    return `${heading}\n\nError: ${result.error}`;
  }

  const metadata = [
    `Final URL: ${result.details.finalUrl}`,
    `Format: ${result.details.format}`,
  ].join("\n");
  const content = isNonEmptyString(result.content) ? result.content.trim() : OUTPUT_EMPTY_MESSAGE;

  return `${heading}\n${metadata}\n\n${content}`;
};

export const buildBatchWebfetchOutput = async (
  results: readonly BatchWebfetchResult[],
  truncateText: TruncateBatchWebfetchText,
): Promise<BatchWebfetchOutput> => {
  const succeeded = results.filter((result) => result.ok).length;
  const failed = results.length - succeeded;
  const summary = `Fetched ${succeeded}/${results.length} URL(s) successfully (${failed} failed).`;
  const body = results.map(formatBatchWebfetchResult).join("\n\n---\n\n");
  const fullText = body.length > 0 ? `${summary}\n\n${body}` : summary;
  const truncatedText = await truncateText(fullText);

  return {
    text: truncatedText.text,
    succeeded,
    failed,
    truncated: truncatedText.truncated,
    fullOutputPath: truncatedText.fullOutputPath,
  };
};
