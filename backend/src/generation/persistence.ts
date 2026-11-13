import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import type { GenerationOutput } from '../ai/provider.js';
import { assertPreviewEntrypoint } from './files.js';

export class ProjectVersionConflictError extends Error {
  constructor() {
    super('Project files changed while the generated correction was being prepared.');
    this.name = 'ProjectVersionConflictError';
  }
}

function sameProjectFiles(left: unknown, right: Array<{ path: string; content: string }>): boolean {
  if (!Array.isArray(left)) return false;
  const normalize = (files: Array<{ path: string; content: string }>) =>
    JSON.stringify([...files].map(({ path, content }) => [path, content]).sort(([a], [b]) => String(a).localeCompare(String(b))));
  return normalize(left as Array<{ path: string; content: string }>) === normalize(right);
}

export async function persistGeneratedVersion(
  prisma: PrismaClient,
  input: {
    jobId: string;
    projectId: string;
    userId: string;
    prompt: string;
    templateId: string;
    options: Record<string, unknown>;
    generated: GenerationOutput;
    expectedActiveVersionId?: string | null;
    recoveryAttemptId?: string;
  },
) {
  const files = assertPreviewEntrypoint(input.generated.files);
  return prisma.$transaction(async (tx) => {
    const job = await tx.generationJob.findUnique({ where: { id: input.jobId }, select: { status: true, createdAt: true } });
    if (job?.status === 'complete') {
      const completedVersions = await tx.version.findMany({
        where: {
          projectId: input.projectId,
          prompt: input.prompt,
          summary: input.generated.summary,
          templateId: input.templateId,
          createdAt: { gte: job.createdAt },
        },
        orderBy: { number: 'desc' },
      });
      const completed = completedVersions.find((version) => sameProjectFiles(version.files, files));
      if (completed) return completed;
      throw new Error('Generation job was already completed, but its saved version could not be matched.');
    }
    if (input.expectedActiveVersionId !== undefined) {
      const locked = await tx.$queryRaw<Array<{ activeVersionId: string | null }>>`
        SELECT "activeVersionId"
        FROM "Project"
        WHERE "id" = ${input.projectId}
        FOR UPDATE
      `;
      if (locked[0]?.activeVersionId !== input.expectedActiveVersionId) throw new ProjectVersionConflictError();
    }
    const latest = await tx.version.findFirst({ where: { projectId: input.projectId }, orderBy: { number: 'desc' }, select: { number: true } });
    if ((latest?.number ?? 0) >= 100) throw new Error('Project version limit reached');
    const version = await tx.version.create({ data: {
      projectId: input.projectId,
      number: (latest?.number ?? 0) + 1,
      prompt: input.prompt,
      summary: input.generated.summary,
      templateId: input.templateId,
      options: input.options as Prisma.InputJsonObject,
      files,
      warnings: input.generated.warnings,
    } });
    await tx.project.update({ where: { id: input.projectId }, data: { activeVersionId: version.id }, select: { id: true } });
    await tx.generationJob.update({ where: { id: input.jobId }, data: { status: 'complete', finishedAt: new Date() } });
    await tx.usage.create({ data: { userId: input.userId, jobId: input.jobId, inputTokens: input.generated.inputTokens, outputTokens: input.generated.outputTokens } });
    if (input.recoveryAttemptId) {
      const attempt = await tx.runtimeRecoveryAttempt.updateMany({
        where: { id: input.recoveryAttemptId, status: 'generating', sourceVersionId: input.expectedActiveVersionId ?? undefined },
        data: { status: 'validating', candidateVersionId: version.id, completedAt: new Date(), validation: { passed: false, state: 'preview_pending' } },
      });
      if (attempt.count !== 1) throw new ProjectVersionConflictError();
      await tx.runtimeRecoverySession.updateMany({
        where: { attempts: { some: { id: input.recoveryAttemptId } }, status: { not: 'paused' } },
        data: { status: 'validating', failureReason: null },
      });
    }
    return version;
  });
}
