import {createHash} from 'node:crypto';

export const UPSTREAM_SECCOMP_SHA256='cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849';

/**
 * Docker conditions the upstream chroot allowance on the outer capability set.
 * With drop ALL, that also blocks Chromium's chroot inside its new user namespace.
 * Allow the syscall, not CAP_SYS_CHROOT: the ordinary task process still cannot
 * chroot, and Chromium uses it to enter its safe empty directory before dropping
 * the namespace's privileges. Everything else in the reviewed profile is intact.
 */
export function rendererSeccompProfile(upstream:Uint8Array):string{
 if(createHash('sha256').update(upstream).digest('hex')!==UPSTREAM_SECCOMP_SHA256)throw new Error('Unreviewed upstream seccomp profile');
 const profile=JSON.parse(Buffer.from(upstream).toString('utf8'));
 profile.syscalls.push({names:['chroot'],action:'SCMP_ACT_ALLOW',args:[],includes:{},excludes:{},
  comment:'Chromium safe-empty-directory chroot inside its user namespace; no outer capabilities granted'});
 return JSON.stringify(profile,null,2)+'\n';
}
