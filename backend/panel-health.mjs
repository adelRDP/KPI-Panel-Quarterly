import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
export const panelInstance=root=>createHash('sha256').update(resolve(root)).digest('hex').slice(0,16);
