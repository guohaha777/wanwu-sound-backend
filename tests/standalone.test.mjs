import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {trustedCatalogue} from '../apps/api/src/catalogue.ts';

test('backend workspaces and Docker images no longer require the frontend source tree',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.ok(!pkg.workspaces.includes('apps/web'));assert.ok(!pkg.workspaces.includes('packages/prompts'));
 for(const file of ['runtime/Dockerfile','api-test/Dockerfile','media-prototype/Dockerfile']){
  const docker=await readFile(new URL('../deploy/'+file,import.meta.url),'utf8');
  assert.doesNotMatch(docker,/apps\/web|packages\/prompts/);assert.match(docker,/COPY data\/catalogue/);
 }
});
test('the independent trusted catalogue verifies all eight originals and previews',async()=>{
 const catalogue=await trustedCatalogue(true);assert.equal(catalogue.size,8);
 for(const [id,item]of catalogue){assert.ok(id.startsWith('example:'));assert.equal(item.id,id);assert.ok(item.bytes>0);assert.match(item.checksum,/^[a-f0-9]{64}$/);}
});
