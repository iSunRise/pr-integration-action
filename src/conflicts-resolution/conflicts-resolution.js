import { parse } from 'yaml';
import fse from 'fs-extra';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import * as core from '@actions/core';

const __dirname = dirname(fileURLToPath(import.meta.url));

class ConflictsResolution {
  DEFAULT_RULES_FILE_PATH = resolve(__dirname, './conflicts-resolution-rules.yml');

  rulesFilePath = this.DEFAULT_RULES_FILE_PATH;
  rules = null;

  constructor(rulesFilePath = null) {
    if (rulesFilePath) this.rulesFilePath = rulesFilePath;
  }

  async resolveConflict(git, path, file) {
    if (!this.rules) {
      let yamlContent;
      if (this.rulesFilePath && fse.existsSync(this.rulesFilePath)) {
        yamlContent = await fse.readFile(this.rulesFilePath, 'utf8');
      } else {
        yamlContent = await fse.readFile(this.DEFAULT_RULES_FILE_PATH, 'utf8');
      }
      this.rules = parse(yamlContent);
    }

    const rulesForFile = this.rules[file];
    if (!rulesForFile) return false;

    // Ignore our file and took incoming one
    if (rulesForFile.ignore) {
      await git.checkoutConflictedFile(path, file, "theirs");
      return true;
    }

    // Take specific lines from incoming file, put into our and then try to merge again
    const ignoreLines = rulesForFile.ignore_lines || [];
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
      const ourLineNumbers = this.getLinesNumbers(oursContent, ignoreLine);
      const theirLineNumbers = this.getLinesNumbers(theirsContent, ignoreLine);
      // we are going to substitute content in our file on lines specified in ourLineNumbers
      // with content from theirsContent on lines specified in theirLineNumbers
      // so at least check that both files have same quantity of lines matched
      if (ourLineNumbers.length === theirLineNumbers.length) {
        lineNumbers.push([ourLineNumbers, theirLineNumbers]);
      }
    }
    // now take lines by numbers specified in lineNumbers from theirsContent and insert in oursContent
    const theirLines = theirsContent.split('\n');
    const ourLines = oursContent.split('\n');
    for (const [ourLineNumbers, theirLineNumbers] of lineNumbers) {
      ourLineNumbers.forEach((ourLineNumber, index) => {
        ourLines[ourLineNumber - 1] = theirLines[theirLineNumbers[index] - 1]; // line numbers start from 1
      });
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
