export interface CorrectionIssue {
  code: string;
  filePath: string;
}

export interface AutomaticCorrectionOptions {
  maxCorrections?: number;
  maxCorrectionsPerFile?: number;
  validate: () => void;
  identify: (error: unknown) => CorrectionIssue | undefined;
  correct: (issue: CorrectionIssue, attemptForFile: number, correctionNumber: number) => Promise<void>;
  onCorrection?: (issue: CorrectionIssue, attemptForFile: number, correctionNumber: number) => void;
  signal?: AbortSignal;
}

/** Runs only after validation fails; successful generation keeps its original path unchanged. */
export async function runAutomaticCorrectionLoop(options: AutomaticCorrectionOptions): Promise<number> {
  const maxCorrections = options.maxCorrections ?? 4;
  const maxCorrectionsPerFile = options.maxCorrectionsPerFile ?? 2;
  const attemptsByFile = new Map<string, number>();
  let corrections = 0;

  for (;;) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('Automatic correction cancelled.');
    try {
      options.validate();
      return corrections;
    } catch (error) {
      const issue = options.identify(error);
      const attemptForFile = issue ? (attemptsByFile.get(issue.filePath) ?? 0) + 1 : 0;
      if (!issue || corrections >= maxCorrections || attemptForFile > maxCorrectionsPerFile) throw error;
      const correctionNumber = corrections + 1;
      options.onCorrection?.(issue, attemptForFile, correctionNumber);
      await options.correct(issue, attemptForFile, correctionNumber);
      attemptsByFile.set(issue.filePath, attemptForFile);
      corrections = correctionNumber;
    }
  }
}
