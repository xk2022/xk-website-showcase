import { cp, mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { validateSites, validateExport, buildRobots, renderGallery, renderNotFound, escape, origin } from './static-export.mjs';
import { capturePreview } from './capture-preview.mjs';
import { materializeStaticArtifact } from './static-artifact.mjs';
import { resolveSources, validateResolvedSources, sourceBuildEnvironment } from './release.mjs';

const sites = JSON.parse(await readFile(process.argv[3] ? resolve(process.argv[3]) : new URL('../config/showcases.json', import.meta.url), 'utf8'));
const output = resolve('dist');
validateSites(sites);
if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) throw new Error('Run the build without GITHUB_TOKEN/GH_TOKEN. Source checks belong in the separate resolution job.');
const resolved = process.argv[2]
  ? JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'))
  : await resolveSources(sites);
validateResolvedSources(sites, resolved);
const buildEnvironment = sourceBuildEnvironment(process.env);
const work = await mkdtemp(join(tmpdir(), 'xk-showcase-'));
const staging = join(work, 'site');
const manifest = [];
const run = (cmd, args, cwd, env = process.env) => execFileSync(cmd, args, { cwd, env, stdio: 'inherit' });
try {
  await mkdir(staging);
  for (const s of resolved) {
    const target = join(staging, s.slug);
    if (s.staticArtifact) {
      // A static release contains no executable source or install/build lifecycle.
      // Reviewed exports may be mirrored by digest when GitHub Releases is unavailable.
      const archive = new URL(`../artifacts/${s.staticArtifact.sha256}.zip`, import.meta.url);
      const fetchArchive = async (...args) => {
        try {
          return new Response(await readFile(archive));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          return fetch(...args);
        }
      };
      await materializeStaticArtifact(s, target, { fetchImpl: fetchArchive });
      await validateExport(target, s);
      if (s.listed !== false) await capturePreview(staging, `/${s.slug}/`, join(target, '_showcase-preview.jpg'), {
        ownerDemo: s.slug === 'little-me-owner-demo',
        interactive: s.slug === 'rotaract' && s.framework === 'interactive',
        rotaractWorkspace: s.slug === 'rotaract' && s.staticArtifact.url === `https://github.com/xk2022/xk-website-showcase/releases/download/rotaract-${s.sha.slice(0,7)}-v1/rotaract-static.zip`,
      });
    } else {
      const dir = join(work, s.slug);
      await mkdir(dir);
      run('git', ['init', '--quiet'], dir, buildEnvironment);
      run('git', ['remote', 'add', 'origin', `https://github.com/${s.repository}.git`], dir, buildEnvironment);
      run('git', ['fetch', '--quiet', '--depth', '1', 'origin', s.sha], dir, buildEnvironment);
      run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], dir, buildEnvironment);
      const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8', env: buildEnvironment }).trim();
      if (sha !== s.sha) throw new Error(`Source checkout mismatch: ${s.slug}`);
      const sourceEnvironment = sourceBuildEnvironment(buildEnvironment, s.env);
      if (s.framework === 'screen') {
        const frontend = s.repository === 'xk2022/codex-xk-apparel-store' ? dir : join(dir, 'frontend');
        run('npm', ['ci'], frontend, sourceEnvironment);
        run('npm', ['run', 'build'], frontend, sourceEnvironment);
        await mkdir(target);
        await capturePreview(join(frontend, 'dist'), '/', join(target, '_showcase-preview.jpg'), { anonymousLogistics: s.slug === 'logistics' && s.repository === 'xk2022/xk-app-logistics' });
        await writeFile(join(target, 'index.html'), `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><link rel="canonical" href="${origin}/${s.slug}/"><title>${escape(s.name)}｜畫面預覽</title><style>body{font-family:system-ui;margin:32px auto;max-width:1200px;padding:0 20px}img{width:100%;height:auto;border:1px solid #ddd}</style></head><body><a href="${origin}/">返回展示中心</a><h1>${escape(s.name)}</h1><p>前端畫面預覽（未連線後端，非正式系統）。</p><img src="./_showcase-preview.jpg" alt="${escape(s.name)} 首頁截圖"></body></html>`);
        await validateExport(target, s);
      } else if (s.framework === 'interactive') {
        const frontend = join(dir, 'frontend');
        const logisticsDemo = s.slug === 'logistics' && s.repository === 'xk2022/xk-app-logistics';
        const exported = join(frontend, logisticsDemo ? 'dist-showcase' : 'dist');
        run('npm', ['ci'], frontend, sourceEnvironment);
        run('npm', ['run', logisticsDemo ? 'build:showcase' : 'build'], frontend, sourceEnvironment);
        await validateExport(exported, s);
        await cp(exported, target, { recursive: true });
        await capturePreview(staging, `/${s.slug}/`, join(target, '_showcase-preview.jpg'), {
          interactive: !logisticsDemo,
          logisticsDemo,
        });
      } else {
        const project = s.repository === 'xk2022/xk-shop-little-me' ? join(dir, 'frontend') : dir;
        run('npm', ['ci'], project, sourceEnvironment);
        run('npm', ['run', 'build'], project, sourceEnvironment);
        await validateExport(join(project, 'out'), s);
        await cp(join(project, 'out'), target, { recursive: true });
        if (s.listed !== false) await capturePreview(staging, `/${s.slug}/`, join(target, '_showcase-preview.jpg'));
      }
    }
    manifest.push({ slug: s.slug, repository: s.repository, sha: s.sha, ...(s.release ? { release: s.release } : {}), ...(s.staticArtifact ? { staticArtifact: { ...s.staticArtifact } } : {}) });
  }
  const template = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
  const cards = renderGallery(sites);
  await writeFile(join(staging, 'index.html'), template.replace('<!-- SHOWCASES -->', cards));
  await writeFile(join(staging, 'robots.txt'), buildRobots(sites));
  await writeFile(join(staging, '404.html'), renderNotFound(sites));
  await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(staging, '.nojekyll'), '');
  await rm(output, { recursive: true, force: true });
  await cp(staging, output, { recursive: true });
} finally {
  await rm(work, { recursive: true, force: true });
}
