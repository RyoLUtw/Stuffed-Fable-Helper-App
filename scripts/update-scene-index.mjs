import { promises as fs } from 'fs';
const SCENES_DIR = new URL('../scenes', import.meta.url);
const MANIFEST_FILE = new URL('../scenes/scene-index.json', import.meta.url);

async function main() {
  try {
    const entries = await fs.readdir(SCENES_DIR, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'scene-index.json')
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    const manifest = { files };
    await fs.writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`Scene manifest updated. ${files.length} file(s) listed.`);
  } catch (error) {
    console.error('Unable to update scene manifest:', error);
    process.exitCode = 1;
  }
}

main();
