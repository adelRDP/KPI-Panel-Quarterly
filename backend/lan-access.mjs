import {isIP} from 'node:net';

const lanAddress=value=>isIP(value)===4&&value.startsWith('192.168.');
export const isLoopbackAddress=value=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(value);
export function isLanRequestHost(host,remoteAddress=''){
  const match=/^(192\.168\.\d{1,3}\.\d{1,3}):(\d+)$/.exec(host);
  if(!match||!lanAddress(match[1]))return false;
  const source=remoteAddress.replace(/^::ffff:/,'');
  return lanAddress(source)||isLoopbackAddress(remoteAddress);
}
