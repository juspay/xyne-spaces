import type { Session } from "@xyne/kata-sdk";

/** Who asks, for which Repository. Both ids come from backend run context, never the LLM. */
export interface SdlcRepositoryAccessBinding {
  repoId: string;
  workspaceId: string;
  actorUserId: string;
}

/** How claw reaches claw-auth, which forwards to Spaces under the run's session token. */
export interface SdlcRepositoryAccessTransport {
  authUrl: string;
  s2sKey: string;
  runSessionId: string;
  sessionToken: string;
}

export interface SdlcRepositoryAccessTarget {
  name: string;
  cloneUrl: string;
  baseBranch: string;
}

export interface SdlcCredentialEnvelope {
  version: 1;
  algorithm: "X25519-HKDF-SHA256-AES-256-GCM";
  ephemeralPublicKey: string;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  aad: string;
  expiresAt: string;
}

// Every file this flow writes starts with `<root>/.sdlc-`, so cleanup can sweep them.
const ROOT = "/tmp";
const KEYGEN_SCRIPT = `${ROOT}/.sdlc-keygen.cjs`;
const PRIVATE_KEY = `${ROOT}/.sdlc-private-key`;
const ENVELOPE = `${ROOT}/.sdlc-envelope.json`;
const INSTALL_SCRIPT = `${ROOT}/.sdlc-install.cjs`;
const CLEANUP_SCRIPT = `${ROOT}/.sdlc-cleanup.cjs`;

async function requestEnvelope(
  binding: SdlcRepositoryAccessBinding,
  transport: SdlcRepositoryAccessTransport,
  sandboxId: string,
  sandboxPublicKey: string,
): Promise<{ envelope: SdlcCredentialEnvelope | null; repository: SdlcRepositoryAccessTarget }> {
  const { authUrl, s2sKey, runSessionId, sessionToken } = transport;
  if (!authUrl || !s2sKey || !runSessionId || !sessionToken) {
    throw new Error("Claw auth URL, S2S key or session token is unavailable for repository access");
  }
  const url = `${authUrl.replace(/\/+$/, "")}/claw/api/v1/sessions/${encodeURIComponent(runSessionId)}/sdlc/runtime-credentials/bootstrap`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-s2s-key": s2sKey, Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({ ...binding, sandboxId, sandboxPublicKey }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    anonymous?: boolean;
    envelope?: SdlcCredentialEnvelope;
    repository?: Partial<SdlcRepositoryAccessTarget>;
  };
  if (!response.ok) {
    const reason = typeof payload.error === "string" ? `: ${payload.error.slice(0, 300)}` : "";
    throw new Error(`Repository access rejected (HTTP ${response.status})${reason}`);
  }
  const repository = payload.repository;
  if (!repository?.name || !repository.cloneUrl || !repository.baseBranch) {
    throw new Error("Repository access returned no repository coordinates");
  }
  const target = { name: repository.name, cloneUrl: repository.cloneUrl, baseBranch: repository.baseBranch };
  if (payload.anonymous === true) return { envelope: null, repository: target };
  if (payload.envelope?.version !== 1 || payload.envelope.algorithm !== "X25519-HKDF-SHA256-AES-256-GCM") {
    throw new Error("Repository access returned an invalid envelope");
  }
  return { envelope: payload.envelope, repository: target };
}

// Per clone URL helper keeps two repositories on one host on separate tokens.
// Global user.* covers git before 2.36, which lacks includeIf hasconfig.
export function buildSdlcRepositoryAccessScript(input: {
  sandboxId: string;
  repoId: string;
  root?: string;
}): string {
  const root = input.root ?? ROOT;
  const params = JSON.stringify({
    root,
    envelope: `${root}/.sdlc-envelope.json`,
    privateKey: `${root}/.sdlc-private-key`,
    sandboxId: input.sandboxId,
    repoId: input.repoId,
  });
  return `const fs=require("node:fs");
const c=require("node:crypto");
const {execFileSync}=require("node:child_process");
const input=${params};
try{
const env=JSON.parse(fs.readFileSync(input.envelope,"utf8"));
const aad=JSON.parse(env.aad);
if(aad.sandboxId!==input.sandboxId||aad.repoId!==input.repoId||!(Date.parse(aad.expiresAt)>Date.now()))throw new Error("binding");
const priv=c.createPrivateKey({key:fs.readFileSync(input.privateKey),format:"der",type:"pkcs8"});
const pub=c.createPublicKey({key:Buffer.from(env.ephemeralPublicKey,"base64"),format:"der",type:"spki"});
const secret=c.diffieHellman({privateKey:priv,publicKey:pub});
const key=Buffer.from(c.hkdfSync("sha256",secret,Buffer.from(env.salt,"base64"),Buffer.from(env.aad),32));
const d=c.createDecipheriv("aes-256-gcm",key,Buffer.from(env.iv,"base64"));
d.setAAD(Buffer.from(env.aad));
d.setAuthTag(Buffer.from(env.authTag,"base64"));
const a=JSON.parse(Buffer.concat([d.update(Buffer.from(env.ciphertext,"base64")),d.final()]).toString("utf8"));
const tokenPattern=a.provider==="GITHUB"?/^github_pat_[A-Za-z0-9_]+$/:/^[A-Za-z0-9+\\/=_-]+$/;
if(!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(a.host)||typeof a.cloneUrl!=="string"||!a.cloneUrl.startsWith("https://"+a.host+"/")||/[\\s'"\\\\]/.test(a.cloneUrl)||!/^[A-Za-z0-9_.@+-]+$/.test(a.username)||!tokenPattern.test(a.password))throw new Error("credential");
const name=String(a.accountName||"").replace(/[\\r\\n<>"\\\\]/g,"").trim().slice(0,200);
const email=String(a.accountEmail||"").trim();
if(!name||!/^[^\\s<>@"\\\\]+@[^\\s<>@"\\\\]+$/.test(email))throw new Error("identity");
const id=c.randomBytes(16).toString("hex");
const q=s=>"'"+s.replaceAll("'","'\\"'\\"'")+"'";
const helper=input.root+"/.sdlc-git-credential-"+id;
fs.writeFileSync(helper,"#!/bin/sh\\ncase \\"$1\\" in\\nget) printf \\"%s\\\\n\\" "+q("username="+a.username)+" "+q("password="+a.password)+" ;;\\nesac\\n",{mode:0o700});
const identity=input.root+"/.sdlc-git-identity-"+id+".gitconfig";
fs.writeFileSync(identity,"[user]\\n\\tname = \\""+name+"\\"\\n\\temail = \\""+email+"\\"\\n",{mode:0o600});
const git=(...args)=>execFileSync("git",["config","--global",...args],{stdio:"ignore"});
const scope="credential."+a.cloneUrl+".helper";
try{git("--unset-all",scope)}catch{}
git("--add",scope,"");
git("--add",scope,helper);
git("credential.https://"+a.host+".useHttpPath","true");
// Global identity first: an includeIf only overrides user.* written above it in the file.
git("user.name",name);
git("user.email",email);
git("--add","includeIf.hasconfig:remote.*.url:"+a.cloneUrl+".path",identity);
fs.writeFileSync(input.root+"/.sdlc-git-identity-global.json",JSON.stringify({name,email}),{mode:0o600});
}catch{
process.stderr.write("SDLC repository access setup failed\\n");
process.exitCode=1;
}finally{
for(const f of [input.envelope,input.privateKey,__filename]){try{fs.rmSync(f,{force:true})}catch{}}
}
`;
}

export function buildSdlcGitCleanupScript(root = ROOT): string {
  return `const fs=require("node:fs");
const {execFileSync}=require("node:child_process");
const root=${JSON.stringify(root)};
const git=a=>{try{return execFileSync("git",["config","--global",...a],{encoding:"utf8",stdio:["ignore","pipe","ignore"]})}catch{return ""}};
const owned=v=>v.startsWith(root+"/.sdlc-git-credential-")||v.startsWith(root+"/.sdlc-git-identity-");
const entries=git(["--get-regexp","^(credential\\\\..+\\\\.helper|credential\\\\.helper|includeif\\\\..+\\\\.path|core\\\\.hookspath)$"]).split("\\n").filter(Boolean).map(l=>{const i=l.indexOf(" ");return i<0?[l,""]:[l.slice(0,i),l.slice(i+1)]});
for(const k of new Set(entries.filter(([k,v])=>k!=="credential.helper"&&k!=="core.hookspath"&&owned(v)).map(([k])=>k)))git(["--unset-all",k]);
if(entries.some(([k,v])=>k==="credential.helper"&&owned(v)))git(["--unset-all","credential.helper","\\.sdlc-git-credential-"]);
if(entries.some(([k,v])=>k==="core.hookspath"&&v==="/tmp/.sdlc-git-hooks"))git(["--unset-all","core.hooksPath"]);
try{const m=JSON.parse(fs.readFileSync(root+"/.sdlc-git-identity-global.json","utf8"));if(git(["--get","user.name"]).trim()===m.name)git(["--unset-all","user.name"]);if(git(["--get","user.email"]).trim()===m.email)git(["--unset-all","user.email"]);}catch{}
for(const f of fs.readdirSync(root)){if(f.startsWith(".sdlc-"))fs.rmSync(root+"/"+f,{recursive:true,force:true})}
`;
}

export async function installSdlcRepositoryAccess(
  session: Session,
  binding: SdlcRepositoryAccessBinding,
  transport: SdlcRepositoryAccessTransport,
): Promise<{ mode: "credential" | "anonymous"; repository: SdlcRepositoryAccessTarget }> {
  const preflight = await session.commands.run(
    `node -e "const m=Number(process.versions.node.split('.')[0]);if(m<20)process.exit(1)"`,
    10_000,
  );
  if (preflight.exitCode !== 0) throw new Error("Sandbox Node.js 20+ crypto runtime is unavailable");

  const keygen = `const fs=require('node:fs');const {generateKeyPairSync}=require('node:crypto');const k=generateKeyPairSync('x25519');fs.writeFileSync('${PRIVATE_KEY}',k.privateKey.export({format:'der',type:'pkcs8'}),{mode:0o600});process.stdout.write(k.publicKey.export({format:'der',type:'spki'}).toString('base64'));`;
  await session.files.write(KEYGEN_SCRIPT, Buffer.from(keygen, "utf8"));
  const generated = await session.commands.run(`node ${KEYGEN_SCRIPT}; rm -f ${KEYGEN_SCRIPT}`, 10_000);
  const sandboxPublicKey = generated.stdout?.trim();
  if (generated.exitCode !== 0 || !sandboxPublicKey) throw new Error("Sandbox ephemeral key generation failed");

  let result: Awaited<ReturnType<typeof requestEnvelope>>;
  try {
    result = await requestEnvelope(binding, transport, session.id, sandboxPublicKey);
  } catch (error) {
    await session.commands.run(`rm -f ${PRIVATE_KEY}`, 5_000).catch(() => undefined);
    throw error;
  }
  if (!result.envelope) {
    await session.commands.run(`rm -f ${PRIVATE_KEY}`, 5_000).catch(() => undefined);
    return { mode: "anonymous", repository: result.repository };
  }
  await session.files.write(ENVELOPE, Buffer.from(JSON.stringify(result.envelope), "utf8"));
  const script = buildSdlcRepositoryAccessScript({ sandboxId: session.id, repoId: binding.repoId });
  await session.files.write(INSTALL_SCRIPT, Buffer.from(script, "utf8"));
  const installed = await session.commands.run(`node ${INSTALL_SCRIPT}`, 15_000);
  if (installed.exitCode !== 0) throw new Error("Sandbox repository access setup failed");
  return { mode: "credential", repository: result.repository };
}

export async function cleanupSdlcGitCredentialMaterial(session: Session): Promise<void> {
  await session.files.write(CLEANUP_SCRIPT, Buffer.from(buildSdlcGitCleanupScript(), "utf8"));
  await session.commands.run(`node ${CLEANUP_SCRIPT}; rm -rf /tmp/.sdlc-*`, 10_000);
}
