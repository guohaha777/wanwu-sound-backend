import {createHash} from 'node:crypto';

export const UPSTREAM_SECCOMP_SHA256='cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849';

/**
 * Docker conditions the upstream chroot allowance on the outer capability set.
 * With drop ALL, that also blocks Chromium's chroot inside its new user namespace.
 * Allow the syscall, not CAP_SYS_CHROOT: the ordinary task process still cannot
 * chroot, and Chromium uses it to enter its safe empty directory before dropping
 * the namespace's privileges. Also allow faccessat2: the same check as the
 * already-allowed faccessat (Docker's own default allows it since 20.10); newer
 * runc calls it while starting the container and crashes when it is refused.
 *
 * runc answers ENOSYS for any syscall numbered above the profile's highest one
 * (io_uring_register, 427), so libc falls back (clone3 -> clone). faccessat2 is
 * 439, which would turn 428-438 into the default EPERM: Node then cannot start a
 * thread. Those keep ENOSYS explicitly, exactly as before; none is allowed.
 * Everything else in the reviewed profile is intact.
 */
export const KEPT_ENOSYS=['open_tree','move_mount','fsopen','fsconfig','fsmount','fspick','pidfd_open','clone3','close_range','openat2','pidfd_getfd'];
export function rendererSeccompProfile(upstream:Uint8Array):string{
 if(createHash('sha256').update(upstream).digest('hex')!==UPSTREAM_SECCOMP_SHA256)throw new Error('Unreviewed upstream seccomp profile');
 const profile=JSON.parse(Buffer.from(upstream).toString('utf8'));
 profile.syscalls.push({names:['chroot'],action:'SCMP_ACT_ALLOW',args:[],includes:{},excludes:{},
  comment:'Chromium safe-empty-directory chroot inside its user namespace; no outer capabilities granted'});
 profile.syscalls.push({names:['faccessat2'],action:'SCMP_ACT_ALLOW',args:[],includes:{},excludes:{},
  comment:'faccessat with flags; newer runc needs it to start the container'});
 profile.syscalls.push({names:KEPT_ENOSYS,action:'SCMP_ACT_ERRNO',errnoRet:38,args:[],includes:{},excludes:{},
  comment:'Syscalls 428-438: ENOSYS as runc gave them before faccessat2 raised the highest number, so libc falls back'});
 return JSON.stringify(profile,null,2)+'\n';
}
