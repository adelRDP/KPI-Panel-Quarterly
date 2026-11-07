// History visibility is independent of the authoritative position and money records.
export function createPositionHistory(store){
  const requireAdmin=actor=>{if(actor?.role!=='hr')throw Object.assign(Error('برای این عملیات مجوز ندارید.'),{status:403,publicMessage:'برای این عملیات مجوز ندارید.'});};
  function list(actor,positions){
    requireAdmin(actor);
    const hidden=new Set(store.list('position-history-visibility').filter(r=>r.hidden).map(r=>r.positionId));
    return positions.map(row=>({...row,historyHidden:hidden.has(row.id)}));
  }
  function setHidden(actor,id,hidden){
    requireAdmin(actor);
    return store.transaction(()=>{
      const position=store.get(id,'position-assignment');
      if(!position)throw Object.assign(Error('نسخهٔ سمت پیدا نشد.'),{status:404,publicMessage:'نسخهٔ سمت پیدا نشد.'});
      const key='position-history:'+id,previous=store.get(key,'position-history-visibility');
      if(!!previous?.hidden===hidden)return {positionId:id,historyHidden:hidden};
      const at=new Date().toISOString();
      store.put('position-history-visibility',{id:key,positionId:id,hidden,changedBy:actor.id,changedAt:at},position.employeeId);
      store.put('audit-event',{actorId:actor.id,action:hidden?'position.history-hidden':'position.history-restored',entityType:'position-assignment',entityId:id,details:{employeeId:position.employeeId,visibilityOnly:true},createdAt:at});
      return {positionId:id,historyHidden:hidden};
    });
  }
  return {list,hide:(actor,id)=>setHidden(actor,id,true),restore:(actor,id)=>setHidden(actor,id,false)};
}
