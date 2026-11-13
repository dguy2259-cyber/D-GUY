export type DeploymentFramework = 'vite' | 'nextjs' | 'static';
export interface DeploymentPackage {
  framework: DeploymentFramework;
  files: Array<{ path: string; content: string }>;
}
export class DeploymentPreparationError extends Error {
  constructor(readonly code: 'invalid_package' | 'unsupported_react_tooling') {
    super(code === 'invalid_package' ? 'The project package.json is invalid; deployment files were not prepared.' : 'This React project does not identify a supported deployment build tool; set up the deployment profile manually.');
    this.name = 'DeploymentPreparationError';
  }
}

export function createDeploymentPackage(files: Array<{ path: string; content: string }>, projectName: string): DeploymentPackage {
  const manifest = files.find((file) => file.path === 'package.json');
  let framework: DeploymentFramework = 'static';
  let buildCommand: string | undefined;
  let startCommand: string | undefined;
  let outputDirectory = '.';
  const hasLockfile = files.some((file) => file.path === 'package-lock.json');
  const installCommand = hasLockfile ? 'npm ci' : 'npm install';
  if (manifest) {
    let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> };
    try { pkg = JSON.parse(manifest.content) as typeof pkg; }
    catch { throw new DeploymentPreparationError('invalid_package'); }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.next) { framework = 'nextjs'; buildCommand = `${installCommand} && npm run build`; startCommand = 'npm start'; outputDirectory = '.next'; }
    else if (deps.vite) { framework = 'vite'; buildCommand = `${installCommand} && npm run build`; outputDirectory = 'dist'; }
    else if (deps.react && pkg.scripts?.build) throw new DeploymentPreparationError('unsupported_react_tooling');
  }

  const safeName = projectName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'dguy-site';
  const vercel = framework === 'nextjs'
    ? { version: 2, framework: 'nextjs' }
    : framework === 'vite'
      ? { version: 2, framework: 'vite', buildCommand, outputDirectory, rewrites: [{ source: '/(.*)', destination: '/index.html' }] }
      : { version: 2, rewrites: [{ source: '/(.*)', destination: '/index.html' }] };
  const render = framework === 'nextjs'
    ? `services:\n  - type: web\n    name: ${safeName}\n    runtime: node\n    buildCommand: ${buildCommand}\n    startCommand: ${startCommand}\n    healthCheckPath: /\n    envVars:\n      - key: NODE_ENV\n        value: production\n`
    : framework === 'vite'
      ? `services:\n  - type: web\n    name: ${safeName}\n    runtime: static\n    buildCommand: ${buildCommand}\n    staticPublishPath: ./${outputDirectory}\n    routes:\n      - type: rewrite\n        source: /*\n        destination: /index.html\n`
      : `services:\n  - type: web\n    name: ${safeName}\n    runtime: static\n    staticPublishPath: ./\n    routes:\n      - type: rewrite\n        source: /*\n        destination: /index.html\n`;
  const notes = [
    '# Deployment preparation',
    '',
    `Detected framework: ${framework}.`,
    '',
    'These manifests prepare this saved D-GUY version for manual import into Vercel or Render. D-GUY does not deploy, upload, create provider projects, or publish this project.',
    '',
    '## Vercel',
    'Import the repository or upload this project in your Vercel dashboard. Review the generated build settings and configure all required environment variables in the Vercel project settings before deploying.',
    '',
    '## Render',
    'Connect the repository in Render and review render.yaml. For a Next.js service, confirm the plan, port, health check, and environment settings for your account before creating the service.',
    '',
    'Never put Supabase service-role keys or Groq/Gemini provider keys in a frontend bundle. Website projects should use their own restricted public client configuration and a separately secured backend for private credentials.',
    '',
  ].join('\n');
  return { framework, files: [
    { path: 'vercel.json', content: `${JSON.stringify(vercel, null, 2)}\n` },
    { path: 'render.yaml', content: render },
    { path: 'DEPLOYMENT.md', content: notes },
  ] };
}
