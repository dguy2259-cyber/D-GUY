import { describe, expect, it } from 'vitest';
import { createDeploymentPackage } from './deployment.js';

describe('manual deployment preparation', () => {
  it('prepares SPA rewrite profiles for a Vite project without publishing it', () => {
    const result = createDeploymentPackage([{ path: 'package.json', content: JSON.stringify({ dependencies: { vite: '^7', react: '^18' }, scripts: { build: 'vite build' } }) }], 'Cyber Portfolio');
    expect(result.framework).toBe('vite');
    expect(JSON.parse(result.files[0]!.content)).toMatchObject({ framework: 'vite', outputDirectory: 'dist' });
    expect(result.files[1]!.content).toContain('staticPublishPath: ./dist');
    expect(result.files[1]!.content).toContain('buildCommand: npm install && npm run build');
    expect(result.files[2]!.content).toContain('does not deploy');
  });

  it('prepares Node service profiles for Next.js projects', () => {
    const result = createDeploymentPackage([{ path: 'package.json', content: JSON.stringify({ dependencies: { next: '^15', react: '^18' }, scripts: { build: 'next build', start: 'next start' } }) }], 'DGUY site');
    expect(result.framework).toBe('nextjs');
    expect(JSON.parse(result.files[0]!.content)).toEqual({ version: 2, framework: 'nextjs' });
    expect(result.files[1]!.content).toContain('runtime: node');
    expect(result.files[1]!.content).toContain('startCommand: npm start');
  });

  it('rejects malformed manifests and emits static profiles for an HTML website', () => {
    expect(() => createDeploymentPackage([{ path: 'package.json', content: '{bad' }], 'site')).toThrow('invalid');
    expect(createDeploymentPackage([{ path: 'index.html', content: '<main>hi</main>' }], 'site').framework).toBe('static');
  });
});
