import { parse } from 'yaml';
import fse from 'fs-extra';
import * as core from '@actions/core';

class ConflictsResolution {
  rulesFilePath = './src/conflicts-resolution/conflicts-resolution-rules.yml';
  rules = null;

  constructor(rulesFilePath = null) {
    if (rulesFilePath) this.rulesFilePath = rulesFilePath;
  }

  async resolveConflict(git, path, file) {
    if (!this.rules) {
      const yamlContent = await fse.readFile(this.rulesFilePath, 'utf8');
      this.rules = parse(yamlContent);
    }

    const rulesForFile = this.rules[file];
    if (!rulesForFile) return false;

    const ignoreLines = rulesForFile.ignoreLines || [];
    if (ignoreLines.length > 0) {
      await this.applyIgnoreLinesRule(git, path, file, ignoreLines);
      await git.addFile(path, file);
      core.info(`       ✓ resolved ${file} merge conflicts`);
      return true;
    }

    // save theirs content to temp files and try to merge again
    const tempTheirsFile = `${path}/${file}.theirs`;
    await fse.writeFile(tempTheirsFile, theirsContent, 'utf8');
    try {
      await git.mergeFiles(path, file, tempTheirsFile);
    } catch (e) {
      // merge conflict
      return false;
    }

    await fse.remove(tempTheirsFile);
    await git.addFile(path, file);
    core.info(`       ✓ resolved ${file} merge conflicts`);
    return true;
  }

  /**
   * Applies ignore lines rule to resolve conflicts
   * @param {import('../git.js').default} git - Git utils imported from git.js
   * @param {string} path - File path
   * @param {string} file - File name
   * @param {string[]} ignoreLines - Array of strings representing lines to ignore
   */
  async applyIgnoreLinesRule(git, path, file, ignoreLines) {
    const oursContent = await git.getFileFromStage(path, 'ours', file);
    const theirsContent = await git.getFileFromStage(path, 'theirs', file);
    const lineNumbers = [];
    for (const ignoreLine of ignoreLines) {
      const lines = this.getLinesNumbers(oursContent, ignoreLine);
      lineNumbers.push(...lines);
    }
    // now take lines by numbers specified in lineNumbers from theirsContent and insert in oursContent
    const theirLines = theirsContent.split('\n');
    const ourLines = oursContent.split('\n');
    for (const lineNumber of lineNumbers) {
      ourLines[lineNumber - 1] = theirLines[lineNumber - 1]; // line numbers start from 1
    }
    // save ours file
    await fse.writeFile(`${path}/${file}`, ourLines.join('\n'), 'utf8');
  }

  getLinesNumbers(content, lineRegexpText) {
    const regexp = new RegExp(lineRegexpText, "m");
    const match = content.match(regexp);
    if (!match) return [];

    const before = content.slice(0, match.index);
    const matchLines = match[0].split('\n').length;

    const startLine = before.split('\n').length;
    const endLine = startLine + matchLines - 1;

    const result = [];
    for(let i = startLine; i <= endLine; i += 1) {
      result.push(i);
    }
    return result;
  }
}

export default ConflictsResolution;
