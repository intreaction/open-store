import { makeHeadTail } from './head.js';
import type { CommandRun } from './common.js';

/** `tail [-n N] path` */
export const tail: CommandRun = makeHeadTail('tail');
