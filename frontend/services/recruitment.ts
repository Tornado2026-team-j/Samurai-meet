import { buildMockRecruitmentPreview } from "../mocks/recruitment";
import type {
  RecruitmentDraft,
  RecruitmentPreview,
} from "../types/recruitment";

export type RecruitmentPreviewProvider = {
  createPreview: (
    draft: RecruitmentDraft,
    signal?: AbortSignal,
  ) => Promise<RecruitmentPreview>;
};

function abortError(): Error {
  const error = new Error("The preview request was cancelled.");
  error.name = "AbortError";
  return error;
}

function wait(duration: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const timeout = setTimeout(resolve, duration);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(abortError());
      },
      { once: true },
    );
  });
}

const mockPreviewProvider: RecruitmentPreviewProvider = {
  async createPreview(draft, signal) {
    await wait(420, signal);
    return buildMockRecruitmentPreview(draft);
  },
};

// Replace this provider with the backend adapter once the preview API is available.
const previewProvider: RecruitmentPreviewProvider = mockPreviewProvider;

export function createRecruitmentPreview(
  draft: RecruitmentDraft,
  signal?: AbortSignal,
): Promise<RecruitmentPreview> {
  return previewProvider.createPreview(draft, signal);
}
