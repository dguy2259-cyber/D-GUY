import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import type { GenerationOutput } from '../ai/provider.js';
import { assertPreviewEntrypoint } from './files.js';

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
  },
) {
  const files = assertPreviewEntrypoint(input.generated.files);
  return prisma.$transaction(async (tx) => {
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
    await tx.project.update({ where: { id: input.projectId }, data: { activeVersionId: version.id } });
    await tx.generationJob.update({ where: { id: input.jobId }, data: { status: 'complete', finishedAt: new Date() } });
    await tx.usage.create({ data: { userId: input.userId, jobId: input.jobId, inputTokens: input.generated.inputTokens, outputTokens: input.generated.outputTokens } });
    return version;
  });
}
