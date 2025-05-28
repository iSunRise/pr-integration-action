import { spawn } from 'child_process';
import * as core from '@actions/core';


class ExitError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}


const COMMON_ARGS = [
  "-c",
  "user.name=GitHub",
  "-c",
  "user.email=noreply@github.com"
];


function git(cwd, ...args) {
  const stdio = [
    "ignore",
    "pipe",
    core.isDebug() ? "inherit" : "ignore"
  ];

  // the URL passed to the clone command could contain a password!
  const command = args.includes("clone") ? "git clone" : `git ${args.join(" ")}`;
  core.debug("Executing", command);

  return new Promise((resolve, reject) => {
    const proc = spawn(
      "git",
      COMMON_ARGS.concat(args.filter(a => a !== null)),
      { cwd, stdio }
    );
    const buffers = [];
    proc.stdout.on("data", data => buffers.push(data));
    proc.on("error", () => {
      reject(new Error(`command failed: ${command}`));
    });
    proc.on("exit", code => {
      if (code === 0) {
        const data = Buffer.concat(buffers);
        resolve(data.toString("utf8").trim());
      } else {
        reject(
          new ExitError(`command failed with code ${code}: ${command}`, code)
        );
      }
    });
  });
}


async function clone(from, to, branch) {
  return await git(
    ".",
    "clone",
    "--quiet",
    "--shallow-submodules",
    "--no-tags",
    "--branch", branch,
    from,
    to
  );
}


async function fetchPr(dir, prNumber, toBranch) {
  return await git(dir, "fetch", "--quiet", "origin", `pull/${prNumber}/head:${toBranch}`);
}


async function createBranch(dir, branch, base, force) {
  return await git(
    dir,
    "branch",
    force ? "--force" : null,
    branch,
    base
  );
}


async function checkout(dir, branch) {
  return await git(dir, "checkout", branch);
}


async function squashMerge(dir, branch) {
  return await git(dir, "merge", "--quiet", "--squash", branch);
}


async function commit(dir, message) {
  return await git(dir, "commit", `-m "${message}"`);
}


async function push(dir, force, from, to) {
  return await git(
    dir,
    "push",
    "--quiet",
    force ? "--force-with-lease" : null,
    "origin",
    `${from}:${to}`
  );
}


async function listMergeConflicts(dir) {
  // git diff --name-only --diff-filter=U
  let files = await git(dir, "diff", "--name-only", "--diff-filter=U");
  return files.split('\n')
}


async function checkoutConflictedFile(dir, pathspec, side="theirs") {
  // checkout conflicting file and stage it to git index
  // git checkout --theirs -- <pathspec>
  // git add <pathspec>
  if (side !== "theirs" && side != "ours") {
    throw new Error("'side' should be one of: theirs | ours ");
  }
  await git(dir, "checkout", `--${side}`, "--", pathspec);
  return await git(dir, "add", pathspec);
}


async function reset(dir) {
  return await git(dir, "reset", "--hard", "HEAD");
}


async function listBranchCommitMessages(dir, branch, count) {
  //git log --format=%s -n 5 origin/stage
  return await git(dir, "log", "--format=%s", "-n", count, branch);
}


async function isBranchExists(dir, branch) {
  try {
    // git rev-parse --verify stage
    await git(dir, "rev-parse", "--verify", branch);
    return true;
  }
  catch {
    return false;
  }
}


async function commitsToMasterHead(dir, masterBranch, branch) {
  // number of commits from branching point to current master head
  // git rev-list --left-only --count origin/master...origin/stage
  const count = await git(dir, "rev-list", "--left-only", "--count", `${masterBranch}...${branch}`);
  return parseInt(count);
}


async function addFile(dir, file) {
  return await git(dir, "add", file)
}


async function getFileFromStage(dir, stage, file) {
  // Get file content from specific stage during merge conflict
  // stage: 'base' = common ancestor (stage 1)
  // stage: 'ours' = current branch (stage 2)
  // stage: 'theirs' = incoming branch (stage 3)
  const stageNumbers = {
    'base': 1,
    'ours': 2,
    'theirs': 3
  };

  const stageNumber = stageNumbers[stage];
  if (!stageNumber) {
    throw new Error(`Invalid stage '${stage}'. Must be one of: base, ours, theirs`);
  }

  return await git(dir, "show", `:${stageNumber}:${file}`);
}


async function mergeFiles(dir, file, tempFile) {
  // Perform three-way merge: merge tempFile into file using file as base
  // git merge-file <current-file> <base-file> <other-file>
  // In our case: merge tempFile into file, using file as both current and base
  return await git(dir, "merge-file", file, file, tempFile);
}


export default {
  ExitError,
  createBranch,
  checkout,
  clone,
  fetchPr,
  squashMerge,
  commit,
  push,
  listMergeConflicts,
  checkoutConflictedFile,
  reset,
  listBranchCommitMessages,
  isBranchExists,
  commitsToMasterHead,
  addFile,
  getFileFromStage,
  mergeFiles
};
