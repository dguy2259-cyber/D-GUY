import { describe, expect, it } from 'vitest';
import { createUnsavedPreviewVersion } from '../../../src/services/generationPreview.js';
import { persistOrKeepPreview } from './previewSave.js';

const preview = {
  summary: 'A generated landing page',
  files: [{ path: 'index.html', content: '<!doctype html><h1>Nexora</h1>' }],
  warnings: ['Stylesheet was not returned.'],
};

describe('preview persistence fallback', () => {
  it('keeps a generated HTML preview available when persistence fails', async () => {
    const result = await persistOrKeepPreview(
      async () => { throw new Error('simulated database outage'); },
      preview,
    );
    expect(result.state).toBe('retrying');
    expect(result.preview.files).toEqual(preview.files);

    const version = createUnsavedPreviewVersion({
      jobId: 'local-test-job',
      prompt: 'Create a Nexora website',
      summary: result.preview.summary,
      templateId: 'saas',
      options: { palette: 'clay', testimonials: false, premiumHero: false, navigation: true },
      number: 1,
      files: result.preview.files,
      warnings: result.preview.warnings,
      createdAt: 123,
    });
    expect(version).toMatchObject({
      id: 'draft-local-test-job',
      previewMode: 'sandbox-html',
      files: preview.files,
      createdAt: 123,
    });
  });

  it('does not present a preview when no non-empty index.html exists', () => {
    expect(createUnsavedPreviewVersion({
      jobId: 'missing-entrypoint',
      prompt: 'Create a page',
      summary: 'No entrypoint',
      templateId: 'saas',
      options: { palette: 'clay', testimonials: false, premiumHero: false, navigation: true },
      number: 1,
      files: [{ path: 'app.js', content: 'console.info("no page")' }],
      warnings: [],
    })).toBeNull();
  });
});
