// Prepare isolated matching Golfballs builds; does not edit the original theme.
import {cp,mkdir,readFile,writeFile,symlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const repo=process.cwd();
const theme=process.env.THEME_ROOT??'/Users/alexrees/Documents/Lazer/Golfballs/golfballs-theme';
const root=process.env.GOLFBALLS_BUILD_ROOT??'/tmp/golfballs-validation';
const baseline=process.env.GOLFBALLS_BASELINE_REF??'50331f0';
for(const variant of ['baseline','candidate']){
 const plugin=join(root,variant+'-plugin'),checkout=join(root,variant);
 await mkdir(plugin,{recursive:true});
 if(variant==='baseline')execFileSync('tar',['-xf','-','-C',plugin],{input:execFileSync('git',['archive',baseline,'src'])});
 else await cp(join(repo,'src'),join(plugin,'src'),{recursive:true});
 await symlink(join(repo,'node_modules'),join(plugin,'node_modules'),'dir').catch(e=>{if(e.code!=='EEXIST')throw e;});
 const source=join(plugin,'src/runtime.ts');
 let code=await readFile(source,'utf8');
 code=code.replace('export function revive(payload: RevivePayload): ReviveRuntime {',`export function revive(payload: RevivePayload): ReviveRuntime {
  const start = performance.now();
  try { return measuredRevive(payload); }
  finally { (globalThis as any).__golfballsValidation = { setupMs: performance.now() - start, debug: payload.options?.debug ?? false }; }
}
function measuredRevive(payload: RevivePayload): ReviveRuntime {`);
 await writeFile(source,code);
 execFileSync('bun',['build',join(plugin,'src/index.ts'),source,'--outdir',join(plugin,'dist'),'--format','esm','--target','node'],{stdio:'pipe'});
 await cp(theme,checkout,{recursive:true,filter:path=>!['.git','.cursor','.agents','.claude','.codex','node_modules','coverage','assets'].includes(path.slice(theme.length+1).split('/')[0])});
 await mkdir(join(checkout,'assets'),{recursive:true});
 await symlink(join(theme,'node_modules'),join(checkout,'node_modules'),'dir').catch(e=>{if(e.code!=='EEXIST')throw e;});
 const config=join(checkout,'vite.config.js');
 await writeFile(config,(await readFile(config,'utf8')).replace("from 'vite-plugin-shopify-theme-islands'",`from '${resolve(plugin,'dist/index.js')}'`));
 const build=execFileSync('node',['node_modules/vite/bin/vite.js','build','--configLoader','runner'],{cwd:checkout,encoding:'utf8'});
 await writeFile(join(root,variant+'-build.log'),build);
 console.log(`${variant}: build complete`);
}
