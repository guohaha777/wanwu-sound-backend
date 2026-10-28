import type {ApiErrorReason} from '@wanwu-v2/contracts/api';

export class ApiError extends Error{
 readonly status:number;readonly reason:ApiErrorReason;readonly retryAfter?:number;
 constructor(status:number,reason:ApiErrorReason,retryAfter?:number){super(reason);this.status=status;this.reason=reason;this.retryAfter=retryAfter;}
}
