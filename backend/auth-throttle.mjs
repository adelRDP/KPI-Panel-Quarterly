// Reserve attempts before awaiting password hashing, so concurrent requests cannot
// bypass the limit. Successful requests refund only their own reservation.
export function createAuthThrottle({limit=5,windowMs=5*60000,maxKeys=1000,now=Date.now}={}){
 const buckets=new Map();
 function reserve(key){
  const at=now();
  for(const [id,row] of buckets)if(row.until<=at)buckets.delete(id);
  let row=buckets.get(key);
  if(!row){
   // Never evict a live bucket: rotating identities must not reset another lock.
   if(buckets.size>=maxKeys)return {retryAfter:Math.max(1,Math.ceil((Math.min(...[...buckets.values()].map(b=>b.until))-at)/1000))};
   row={count:0,until:at+windowMs};buckets.set(key,row);
  }
  if(row.count>=limit)return {retryAfter:Math.max(1,Math.ceil((row.until-at)/1000))};
  row.count++;let released=false;
  return {release(){if(!released){released=true;row.count--;if(!row.count&&buckets.get(key)===row)buckets.delete(key);}}};
 }
 return {reserve};
}
