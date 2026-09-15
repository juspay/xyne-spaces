import type { Session } from "@xyne/kata-sdk";

interface SdlcRuntimeCredentialBindingBase {
  agentSlug: "sdlc-agent";
  repoId: string;
}

export type SdlcRuntimeCredentialBinding = SdlcRuntimeCredentialBindingBase & (
  | {
      operation: "CLONE" | "PUSH";
      executionId: string;
      sessionId: string;
    }
  | {
      operation: "INTERACTIVE";
      interactiveGrant: string;
      conversationId: string;
    }
);

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

const KEYGEN_SCRIPT = "/tmp/.sdlc-keygen.cjs";
const PRIVATE_KEY = "/tmp/.sdlc-private-key";
const ENVELOPE = "/tmp/.sdlc-envelope.json";
const BOOTSTRAP_SCRIPT = "/tmp/.sdlc-bootstrap.cjs";
const IDENTITY_FILE = "/tmp/.sdlc-git-identity.json";
const HOOKS_DIR = "/tmp/.sdlc-git-hooks";
const POST_COMMIT_HOOK = `${HOOKS_DIR}/post-commit`;

export function buildSdlcPostCommitHook(identityFile = IDENTITY_FILE): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
if (process.env.XYNE_SDLC_POST_COMMIT_GUARD === "1") process.exit(0);
try {
  const identity = JSON.parse(fs.readFileSync(${JSON.stringify(identityFile)}, "utf8"));
  const env = { ...process.env };
  delete env.GIT_AUTHOR_NAME;
  delete env.GIT_AUTHOR_EMAIL;
  delete env.GIT_COMMITTER_NAME;
  delete env.GIT_COMMITTER_EMAIL;
  env.GIT_AUTHOR_NAME = identity.name;
  env.GIT_AUTHOR_EMAIL = identity.email;
  env.GIT_COMMITTER_NAME = identity.name;
  env.GIT_COMMITTER_EMAIL = identity.email;
  env.XYNE_SDLC_POST_COMMIT_GUARD = "1";
  spawnSync("git", ["commit", "--amend", "--no-edit", "--no-verify", "--allow-empty", "--author=" + identity.name + " <" + identity.email + ">"], { env, stdio: "ignore" });
} catch {}
process.exit(0);
`;
}

const postCommitHook = buildSdlcPostCommitHook();

async function requestEnvelope(
  binding: SdlcRuntimeCredentialBinding,
  sandboxId: string,
  sandboxPublicKey: string,
): Promise<SdlcCredentialEnvelope | null> {
  const baseUrl = (process.env["SPACES_BACKEND_URL"] ?? process.env["XYNE_SPACES_URL"] ?? "").replace(/\/+$/, "");
  const s2sKey = process.env["XYNE_CLAW_S2S_KEY"] ?? "";
  if (!baseUrl || !s2sKey) throw new Error("Spaces URL or S2S key is unavailable for private repository setup");
  const response = await fetch(`${baseUrl}/api/internal/sdlc/vcs/runtime-credentials/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-s2s-key": s2sKey },
    body: JSON.stringify({ ...binding, sandboxId, sandboxPublicKey }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Runtime credential bootstrap rejected (HTTP ${response.status})`);
  const payload = await response.json() as {
    anonymous?: boolean;
    envelope?: SdlcCredentialEnvelope;
  };
  if (payload.anonymous === true) return null;
  if (payload.envelope?.version !== 1 || payload.envelope.algorithm !== "X25519-HKDF-SHA256-AES-256-GCM") {
    throw new Error("Runtime credential bootstrap returned invalid envelope");
  }
  return payload.envelope;
}

export async function installSdlcGitCredentialBootstrap(
  session: Session,
  binding: SdlcRuntimeCredentialBinding,
): Promise<"credential" | "anonymous"> {
  const preflight = await session.commands.run(
    `node -e "const m=Number(process.versions.node.split('.')[0]);if(m<20)process.exit(1)"`,
    10_000,
  );
  if (preflight.exitCode !== 0) throw new Error("Sandbox Node.js 20+ crypto runtime is unavailable");

  const keygen = `const fs=require('node:fs');const {generateKeyPairSync}=require('node:crypto');const k=generateKeyPairSync('x25519');fs.writeFileSync('${PRIVATE_KEY}',k.privateKey.export({format:'der',type:'pkcs8'}),{mode:0o600});process.stdout.write(k.publicKey.export({format:'der',type:'spki'}).toString('base64'));`;
  await session.files.write(KEYGEN_SCRIPT, Buffer.from(keygen, "utf8"));
  const generated = await session.commands.run(`node ${KEYGEN_SCRIPT}`, 10_000);
  const sandboxPublicKey = generated.stdout?.trim();
  if (generated.exitCode !== 0 || !sandboxPublicKey) throw new Error("Sandbox ephemeral key generation failed");

  const envelope = await requestEnvelope(binding, session.id, sandboxPublicKey);
  if (!envelope) {
    await cleanupSdlcGitCredentialMaterial(session);
    return "anonymous";
  }
  await session.files.write(ENVELOPE, Buffer.from(JSON.stringify(envelope), "utf8"));
  const hookBase64 = Buffer.from(postCommitHook, "utf8").toString("base64");
  const bootstrap = [
    `const fs=require("node:fs");`,
    `const c=require("node:crypto");`,
    `const {execFileSync}=require("node:child_process");`,
    `(async()=>{`,
    `const env=JSON.parse(fs.readFileSync(${JSON.stringify(ENVELOPE)},"utf8"));`,
    `const aad=JSON.parse(env.aad);`,
    `if(aad.agentSlug!==${JSON.stringify(binding.agentSlug)}||aad.sandboxId!==${JSON.stringify(session.id)}||Date.parse(aad.expiresAt)<=Date.now())throw new Error("binding");`,
    `const priv=c.createPrivateKey({key:fs.readFileSync(${JSON.stringify(PRIVATE_KEY)}),format:"der",type:"pkcs8"});`,
    `const pub=c.createPublicKey({key:Buffer.from(env.ephemeralPublicKey,"base64"),format:"der",type:"spki"});`,
    `const secret=c.diffieHellman({privateKey:priv,publicKey:pub});`,
    `const key=c.hkdfSync("sha256",secret,Buffer.from(env.salt,"base64"),Buffer.from(env.aad),32);`,
    `const d=c.createDecipheriv("aes-256-gcm",key,Buffer.from(env.iv,"base64"));`,
    `d.setAAD(Buffer.from(env.aad));`,
    `d.setAuthTag(Buffer.from(env.authTag,"base64"));`,
    `const auth=JSON.parse(Buffer.concat([d.update(Buffer.from(env.ciphertext,"base64")),d.final()]).toString("utf8"));`,
    `if(!/^[A-Za-z0-9_.-]+$/.test(auth.username)||!/^github_pat_[A-Za-z0-9_]+$/.test(auth.password))throw new Error("credential");`,
    `const identityResponse=await fetch("https://api.github.com/user",{headers:{Accept:"application/vnd.github+json",Authorization:"Bearer "+auth.password,"User-Agent":"xyne-spaces-sdlc","X-GitHub-Api-Version":"2026-03-10"},signal:AbortSignal.timeout(20000)});`,
    `if(!identityResponse.ok)throw new Error("identity");`,
    `const githubIdentity=await identityResponse.json();`,
    `const login=typeof githubIdentity.login==="string"?githubIdentity.login:"";`,
    `const id=Number(githubIdentity.id);`,
    `if(!/^[A-Za-z0-9-]+$/.test(login)||!Number.isSafeInteger(id)||id<=0)throw new Error("identity");`,
    `const rawName=typeof githubIdentity.name==="string"&&githubIdentity.name.trim()?githubIdentity.name:login;`,
    `const name=rawName.replace(/[\\r\\n<>]/g,"").trim().slice(0,200)||login;`,
    `const email=id+"+"+login+"@users.noreply.github.com";`,
    `fs.writeFileSync(${JSON.stringify(IDENTITY_FILE)},JSON.stringify({name,email}),{mode:0o600});`,
    `fs.mkdirSync(${JSON.stringify(HOOKS_DIR)},{recursive:true,mode:0o700});`,
    `fs.writeFileSync(${JSON.stringify(POST_COMMIT_HOOK)},Buffer.from(${JSON.stringify(hookBase64)},"base64"),{mode:0o700});`,
    `const helper="/tmp/.sdlc-git-credential-"+c.randomBytes(16).toString("hex");`,
    `const q=s=>"'"+s.replaceAll("'","'\\\"'\\\"'")+"'";`,
    `fs.writeFileSync(helper,"#!/bin/sh\\ncase \\"$1\\" in\\nget) printf \\"%s\\\\n\\" "+q("username="+auth.username)+" "+q("password="+auth.password)+" ;;\\nesac\\n",{mode:0o700});`,
    `execFileSync("git",["config","--global","credential.helper",helper]);`,
    `execFileSync("git",["config","--global","core.hooksPath",${JSON.stringify(HOOKS_DIR)}]);`,
    `fs.rmSync(${JSON.stringify(PRIVATE_KEY)},{force:true});`,
    `fs.rmSync(${JSON.stringify(ENVELOPE)},{force:true});`,
    `fs.rmSync(${JSON.stringify(KEYGEN_SCRIPT)},{force:true});`,
    `fs.rmSync(${JSON.stringify(BOOTSTRAP_SCRIPT)},{force:true});`,
    `})().catch(()=>{process.stderr.write("SDLC credential bootstrap failed\\n");process.exit(1);});`,
  ].join("\n");
  await session.files.write(BOOTSTRAP_SCRIPT, Buffer.from(bootstrap, "utf8"));
  const installed = await session.commands.run(`node ${BOOTSTRAP_SCRIPT}`, 10_000);
  if (installed.exitCode !== 0) throw new Error("Sandbox credential bootstrap failed");
  return "credential";
}

export async function cleanupSdlcGitCredentialMaterial(session: Session): Promise<void> {
  await session.commands.run(
    `helper=$(git config --global --get credential.helper 2>/dev/null || true); hooks=$(git config --global --get core.hooksPath 2>/dev/null || true); git config --global --unset-all credential.helper 2>/dev/null || true; case "$hooks" in ${HOOKS_DIR}) git config --global --unset-all core.hooksPath 2>/dev/null || true;; esac; case "$helper" in /tmp/.sdlc-git-credential-*) rm -f "$helper";; esac; rm -f ${PRIVATE_KEY} ${ENVELOPE} ${KEYGEN_SCRIPT} ${BOOTSTRAP_SCRIPT} ${IDENTITY_FILE}; rm -rf ${HOOKS_DIR}`,
    5_000,
  );
}
