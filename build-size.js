const fs = require("fs-extra");
const path = require("path");
const { promisify } = require("util");
const exec = promisify(require("child_process").exec);

const debug = require("debug")("build-size");
const fetch = require("node-fetch");
const simpleGit = require("simple-git/promise");
const klaw = require("klaw");

const actionFilter = ["opened", "closed", "synchronize"];

async function measureBuild(gitPath, commit) {
  debug("measuring build");
  const git = simpleGit(gitPath);
  await git.fetch();

  debug("cleaning repo");
  await git.clean("f");

  debug("checking out commit");
  await git.checkout(commit);

  debug("npm ci");
  await exec("npm ci", { cwd: gitPath });
  debug("npm build");
  await exec("npm run build", { cwd: gitPath });

  debug("collecting stats");
  const files = {};
  return new Promise(resolve => {
    const distPath = path.join(gitPath, "dist" + path.sep);
    klaw(distPath)
      .on("data", item => {
        if (item.stats.isDirectory()) return;

        const ext = path.extname(item.path);
        if (!files[ext]) files[ext] = { files: {}, totalSize: 0 };

        const normalizedPath = item.path.replace(distPath, "").replace(/[a-f0-9]{20,64}/i, "[hash]");
        files[ext].files[normalizedPath] = {
          size: item.stats.size
        };
        files[ext].totalSize += item.stats.size;
      })
      .on("end", () => {
        resolve(files);
      });
  });
}

async function createOrUpdateComment(repoOwner, repoName, body, pr, id) {
  let base = `https://api.github.com/repos/${repoOwner}/${repoName}`;
  let method;
  let url;

  if (id) {
    method = "PATCH";
    url = `${base}/issues/comments/${id}`;
  } else {
    method = "POST";
    url = `${base}/issues/${pr}/comments`;
  }

  const { id: createdId } = await fetch(url, {
    method,
    body: JSON.stringify({ body }),
    headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` }
  }).then(r => {
    debug("comment status code %s", r.status);
    return r.json();
  });

  return createdId;
}

function createComment(repoOwner, repoName, body, pr) {
  return createOrUpdateComment(repoOwner, repoName, body, pr);
}

function updateComment(repoOwner, repoName, body, id) {
  return createOrUpdateComment(repoOwner, repoName, body, null, id);
}

function padEnd(str, num, pad) {
  for (let i = str.length; i < num; i++) {
    str += pad;
  }
  return str;
}

async function main() {
  const event = JSON.parse(fs.readFileSync("payload.json", "utf8"));
  const { action } = event;

  if (!actionFilter.includes(action)) {
    debug("ignoring %s action", action);
    return;
  }
  debug("action %s", action);

  const repoName = event.repository.name;
  const repoOwner = event.repository.owner.login;
  const start = Date.now();

  const dataDir = "data";
  const repoPath = path.join(dataDir, repoOwner, repoName);
  debug("script path", path.resolve(__dirname));
  debug("repo path", path.resolve(repoPath));
  const masterPath = path.join(repoPath, "master.json");
  if (!fs.existsSync(repoPath)) {
    fs.ensureDirSync(repoPath, { recursive: true });
  }

  if (action === "closed") {
    if (event.pull_request.merged && event.pull_request.base.ref === "master" && fs.existsSync(masterPath)) {
      debug("PR merged. Clearing master stats.");
      fs.unlinkSync(masterPath);
    }
    return;
  }

  const commentsPath = path.join(repoPath, "comments.json");
  if (!fs.existsSync(commentsPath)) {
    fs.writeFileSync(commentsPath, JSON.stringify({}));
  }
  const comments = JSON.parse(fs.readFileSync(commentsPath));
  let commentId = comments[event.pull_request.number];

  if (!commentId) {
    debug("creating comment");
    const id = await createComment(repoOwner, repoName, "[calculating build size...]", event.pull_request.number);
    debug("created comment %s", id);
    comments[event.pull_request.number] = id;
    fs.writeFileSync(commentsPath, JSON.stringify(comments));
    commentId = id;
  } else {
    await updateComment(repoOwner, repoName, "[calculating build size...]", commentId);
  }

  const repo = `https://github.com/${repoOwner}/${repoName}`;
  const gitPath = path.join(repoPath, "git");
  if (!fs.existsSync(gitPath)) {
    await simpleGit().clone(repo, gitPath);
  } else {
    debug("repo already exists");
  }

  if (!fs.existsSync(masterPath)) {
    const files = await measureBuild(gitPath, "origin/master");
    fs.writeFileSync(masterPath, JSON.stringify(files));
  } else {
    debug("master stats already exist");
  }
  const master = JSON.parse(fs.readFileSync(masterPath));

  const files = await measureBuild(gitPath, event.pull_request.head.sha);

  debug("collecting diff");
  for (const ext in files) {
    const masterExtFiles = master[ext];
    const extFiles = files[ext];
    for (const filePath in extFiles.files) {
      const file = extFiles.files[filePath];
      const oldSize = masterExtFiles.files[filePath].size;
      file.diff = file.size - (oldSize || 0);
    }
    for (const filePath in masterExtFiles.files) {
      if (filePath in extFiles.files) continue;
      extFiles.files[filePath] = { diff: -masterExtFiles.files[filePath].size };
    }
    extFiles.diff = extFiles.totalSize - (masterExtFiles.totalSize || 0);
  }

  const commentText = Object.entries(files)
    .map(
      ([ext, files]) => `
        <details>
          <summary>
            <code>
              ${padEnd(ext, 5, "&emsp;")}
              ${padEnd(`${files.diff > 0 ? "+" : ""}${files.diff.toLocaleString()} bytes`, 16, "&emsp;")}
            </code>
            ${files.diff > 0 ? ":arrow_up_small:" : "&emsp;"}
          </summary>
          ${Object.entries(files.files)
            .filter(([_, { diff }]) => Math.abs(diff) > 0)
            .map(
              ([path, { diff }]) => `
                <code>
                  ${padEnd(path, 60, "&emsp;")}
                  ${padEnd(`${diff > 0 ? "+" : ""}${diff.toLocaleString()} bytes`, 16, "&emsp;")}
                </code>
                ${diff > 0 ? ":arrow_up_small:" : "&emsp;"}
                <br/>
              `
            )
            .join("")}
          </table>
        </details>
      `
    )
    .join("")
    .replace(/^\s+/gm, "");

  updateComment(repoOwner, repoName, commentText, commentId);
  debug("updated comment %s", commentId);

  debug("runtime %d", Date.now() - start);
}

main();
