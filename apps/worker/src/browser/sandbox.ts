/** Read Chromium's own status, not launch flags. Chromium 156 renamed layer 1. */
export function linuxSandboxEnabled(status:string):boolean{
 const namespace=/^(?:Layer 1 Sandbox[ \t]+Namespace|Namespace sandbox[ \t]+Yes)[ \t]*$/im.test(status);
 return namespace&&/^PID namespaces[ \t]+Yes[ \t]*$/im.test(status)
  &&/^Network namespaces[ \t]+Yes[ \t]*$/im.test(status)
  &&/^Seccomp-BPF sandbox[ \t]+Yes[ \t]*$/im.test(status)
  &&/^Seccomp-BPF sandbox supports TSYNC[ \t]+Yes[ \t]*$/im.test(status);
}
