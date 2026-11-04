(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PanelMoneyWords=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  const ones=['','یک','دو','سه','چهار','پنج','شش','هفت','هشت','نه','ده','یازده','دوازده','سیزده','چهارده','پانزده','شانزده','هفده','هجده','نوزده'];
  const tens=['','','بیست','سی','چهل','پنجاه','شصت','هفتاد','هشتاد','نود'],hundreds=['','صد','دویست','سیصد','چهارصد','پانصد','ششصد','هفتصد','هشتصد','نهصد'],scales=['','هزار','میلیون','میلیارد','تریلیون','کوادریلیون'];
  function chunk(n){const parts=[];if(n>=100){parts.push(hundreds[Math.floor(n/100)]);n%=100;}if(n>=20){parts.push(tens[Math.floor(n/10)]);n%=10;}if(n)parts.push(ones[n]);return parts.join(' و ');}
  return function(value){
    if(value==null||String(value).trim()==='')return '';
    const normalized=String(value).trim().replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-1776)).replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-1632));
    if(!/^\d+$/.test(normalized))return 'مبلغ معتبر نیست';const amount=Number(normalized);if(!Number.isSafeInteger(amount)||amount<0)return 'مبلغ معتبر نیست';if(amount===0)return 'صفر تومان';
    let n=amount,index=0;const parts=[];while(n){const group=n%1000;if(group)parts.unshift(chunk(group)+(scales[index]?' '+scales[index]:''));n=Math.floor(n/1000);index++;}return parts.join(' و ')+' تومان';
  };
});
