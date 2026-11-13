import {test} from 'node:test';
import assert from 'node:assert/strict';
import {legalRedirect} from './legal-redirects.mjs';
test('all legacy legal addresses return HTTP 301 with the correct section',()=>{
 for(const name of ['privacy','consent','details','requisites'])
 for(const suffix of ['','/','.html','/index.html']){
  const response=legalRedirect(new Request('https://tzvuka.ru/'+name+suffix+'?from=old'));
  assert.equal(response.status,301);
  assert.equal(response.headers.get('Location'),'https://tzvuka.ru/documents/?from=old#'+(name==='requisites'?'details':name));
 }
});
test('landing, documents, forms and unrelated paths are never redirected',()=>{
 for(const path of ['/','/troitsk/','/kaluga/','/documents/','/documents','/leads','/privacy-other','/privacy/extra'])
  assert.equal(legalRedirect(new Request('https://tzvuka.ru'+path)),null);
});
