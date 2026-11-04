// Only original source substrings enter the repair hint, never rejected model
// prose or a reconstructed quotation. Validation remains against full evidence.
export function citationRepairExamples(raw,evidence){
 const examples=[];let bytes=2;
 for(const criterion of raw?.criteria||[])for(const q of criterion.citations||[]){
  const chunk=evidence.chunks.find(c=>c.id===q?.chunkId);
  if(!chunk||typeof q.quote!=='string'||chunk.text.includes(q.quote))continue;
  let literal=chunk.text;const address=q.quote.match(/"address"\s*:\s*"([A-Z]{1,3}[1-9]\d{0,4})"/)?.[1];
  if(address){try{const cell=JSON.parse(chunk.text).cells?.find(c=>c.address===address),candidate=cell&&JSON.stringify(cell);if(candidate&&chunk.text.includes(candidate))literal=candidate;}catch{}}
  // The prefix ends before a formula, rather than joining fields around it.
  const formulaAt=literal.indexOf(',"formula":'),end=formulaAt>0?Math.min(formulaAt,180):180;
  let quote=literal.slice(0,end);if(/[\uD800-\uDBFF]$/.test(quote))quote=quote.slice(0,-1);
  if(quote.trim().length<3||!chunk.text.includes(quote))continue;
  const example={chunkId:chunk.id,quote};if(examples.some(e=>e.chunkId===example.chunkId&&e.quote===quote))continue;
  const size=Buffer.byteLength(JSON.stringify(example))+1;if(bytes+size>1500)continue;bytes+=size;examples.push(example);
 }
 return examples;
}
