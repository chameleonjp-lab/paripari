import { CONFIG, rankForScore } from './config.js';
import {validSubmissionId} from './outbox.js';
export function validResult(value) {
 return Boolean(value && value.practiceDone === false && Number.isSafeInteger(value.score) && value.score >= 0 && Number.isSafeInteger(value.best) && value.best >= value.score && typeof value.isBest === 'boolean' && Number.isSafeInteger(value.maxCombo) && value.maxCombo >= 0 && Number.isInteger(value.perfectRate) && value.perfectRate >= 0 && value.perfectRate <= 100 && Number.isInteger(value.tier) && value.tier >= 1 && value.tier <= CONFIG.TIERS.length && value.rank === rankForScore(value.score));
}
export function validSnapshot(value) {
 const run=value?.run;
 return validResult(value?.result) && typeof run?.name === 'string' && typeof run.clientVersion === 'string' && (validSubmissionId(run.startId) || run.startId === null) && (validSubmissionId(run.submissionId) || run.submissionId === null);
}
export function saveResult(storage,key,value) {
 const serialized=JSON.stringify(value);
 storage.setItem(key,serialized);
 if(storage.getItem(key)!==serialized)throw Error('Storage did not persist snapshot');
}
