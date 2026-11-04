// Calendar-stable UI scenarios still use an advancing clock, so retries and
// elapsed-time waits behave normally. Explicit dates and native timers stay intact.
export function installTestClock(iso){
 const Native=globalThis.Date,offset=Native.parse(iso)-Native.now();
 function ScenarioDate(...args){if(!new.target)return new Native(Native.now()+offset).toString();return Reflect.construct(Native,args.length?args:[Native.now()+offset],new.target);}
 Object.setPrototypeOf(ScenarioDate,Native);ScenarioDate.prototype=Native.prototype;ScenarioDate.now=()=>Native.now()+offset;globalThis.Date=ScenarioDate;
 return {Date:ScenarioDate,restore:()=>{globalThis.Date=Native;}};
}
