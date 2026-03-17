import { createWriteStream, existsSync, mkdirSync, unlink } from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.join(__dirname, "../public/avatars/preset");

const avatars = [];

for (let index = 0; index < 10; index += 1) {
  avatars.push({
    url: `https://randomuser.me/api/portraits/women/${40 + index}.jpg`,
    filename: `female_${String(index + 1).padStart(2, "0")}.jpg`,
  });
}

for (let index = 0; index < 10; index += 1) {
  avatars.push({
    url: `https://randomuser.me/api/portraits/men/${50 + index}.jpg`,
    filename: `male_${String(index + 1).padStart(2, "0")}.jpg`,
  });
}

function cleanupFile(filepath) {
  unlink(filepath, () => {});
}

function download(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(filepath);

    const request = https.get(url, (response) => {
      if (
        response.statusCode &&
        [301, 302, 303, 307, 308].includes(response.statusCode) &&
        response.headers.location
      ) {
        file.close();
        cleanupFile(filepath);
        download(response.headers.location, filepath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        cleanupFile(filepath);
        reject(new Error(`HTTP ${response.statusCode ?? "unknown"}`));
        return;
      }

      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    });

    request.setTimeout(15000, () => {
      request.destroy(new Error("请求超时"));
    });

    request.on("error", (error) => {
      file.close();
      cleanupFile(filepath);
      reject(error);
    });

    file.on("error", (error) => {
      file.close();
      cleanupFile(filepath);
      reject(error);
    });
  });
}

async function main() {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  for (const avatar of avatars) {
    const filepath = path.join(outputDir, avatar.filename);
    console.log(`Downloading ${avatar.filename}...`);
    try {
      await download(avatar.url, filepath);
      console.log(`OK ${avatar.filename}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`FAIL ${avatar.filename}: ${message}`);
    }
  }

  console.log(`Done! ${avatars.length} avatars saved to ${outputDir}`);
}

void main();
