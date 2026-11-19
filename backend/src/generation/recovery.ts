interface GenerationRecoveryStore {
  generationJob: {
    updateMany(args: {
      where: { status: { in: string[] }; createdAt: { lt: Date } };
      data: { status: string; errorCode: string; finishedAt: Date };
    }): Promise<{ count: number }>;
  };
}

interface OrphanedGenerationStore {
  generationJob: {
    updateMany(args: {
      where: { id: string; status: 'running' };
      data: { status: 'failed'; errorCode: 'PROCESS_RESTARTED'; finishedAt: Date };
    }): Promise<{ count: number }>;
  };
}

/** Mark only jobs created before this process started; retain all project and version records. */
export async function failInterruptedGenerations(store: GenerationRecoveryStore, startedAt: Date, finishedAt = new Date()) {
  const result = await store.generationJob.updateMany({
    where: { status: { in: ['queued', 'running'] }, createdAt: { lt: startedAt } },
    data: { status: 'failed', errorCode: 'PROCESS_RESTARTED', finishedAt },
  });
  return result.count;
}

export async function failOrphanedGeneration(store: OrphanedGenerationStore, id: string, finishedAt = new Date()) {
  const result = await store.generationJob.updateMany({
    where: { id, status: 'running' },
    data: { status: 'failed', errorCode: 'PROCESS_RESTARTED', finishedAt },
  });
  return result.count;
}
