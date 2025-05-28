import * as core from '@actions/core';
import fse from 'fs-extra';

async function resolvePackageJsonConflict(git, path, file) {
  try {
    // Get both versions of the file
    const oursContent = await git.getFileFromStage(path, 'ours', file);
    const theirsContent = await git.getFileFromStage(path, 'theirs', file);

    // Normalize versions to "0.0.0" in both
    const normalizedOurs = normalizePackageJsonVersion(oursContent);
    const normalizedTheirs = normalizePackageJsonVersion(theirsContent);

    // Write normalized "ours" version
    await fse.writeFile(`${path}/${file}`, normalizedOurs, 'utf8');

    // Create a temporary file with normalized "theirs" version
    const tempFile = `${path}/${file}.theirs`;
    await fse.writeFile(tempFile, normalizedTheirs, 'utf8');

    // Try to merge the normalized versions
    try {
      await git.mergeFiles(path, file, tempFile);
      await fse.remove(tempFile);
      await git.addFile(path, file);
      core.info("       ✓ resolved package.json after version normalization");
      return true;
    } catch (mergeError) {
      // Still conflicts after normalization, fall back to "theirs"
      await fse.remove(tempFile);
      await git.checkoutConflictedFile(path, file, "theirs");
      core.info("       resolve with 'theirs' package.json");
      return true;
    }

  } catch (e) {
    core.info(`       error during version normalization: ${e.message}, falling back to 'theirs'`);
    await git.checkoutConflictedFile(path, file, "theirs");
    return true;
  }
}


function normalizePackageJsonVersion(content) {
  // Replace any version field with "0.0.0"
  return content.replace(/"version"\s*:\s*"[^"]*"/g, '"version": "0.0.0"');
}


export default resolvePackageJsonConflict;
