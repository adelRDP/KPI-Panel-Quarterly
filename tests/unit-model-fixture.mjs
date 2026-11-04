// Explicit unit model for tests of peer surveys; never used by production seeding.
export function seedPeerUnitModel(store,unitId='services',effectiveQuarter='1400-Q1'){
  return store.put('evaluation-settings',{id:`test-peer-${unitId}`,version:`test-peer-${unitId}`,status:'published',unitId,effectiveQuarter,weights:{exam:0,manager:40,routine:0,project:0,peer:60}});
}
