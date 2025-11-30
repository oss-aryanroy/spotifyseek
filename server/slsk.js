import { homedir } from "os";
import { join } from "path";
import fs from "fs";
import { EventEmitter } from "events";

import slskClient from "slsk-client";
const { connect } = slskClient;

const timeout = process.env.TIMEOUT || 90; // seconds

// Event emitter so server.js (and SSE) can listen for status updates
export const slskEvents = new EventEmitter();

export class Slsk {
  constructor(username, pw) {
    if (!username || !pw) {
      console.log(
        `Set username and password first. See the README for further information.`
      );
      return;
    }

    connect(
      {
        user: username,
        pass: pw,
        port: 3576,
      },
      (err, client) => {
        if (err) console.log(`err connecting to soulseek:\n${err}`);
        else {
          this.client = client;
          console.log("Connected to Soulseek");
        }
      }
    );
  }

  fetchSearchOptions(artist, title) {
    const searchQuery = `${artist} ${title}`;

    return new Promise((resolve, reject) => {
      this.client.search({ req: searchQuery, timeout: 3000 }, (err, results) => {
        if (err) return reject(err);

        const filtered = results.filter((r) => {
          if (!r.file) return false;

          const extMatch = r.file.match(/\.[^.]+$/);
          const ext = extMatch ? extMatch[0].toLowerCase() : "";

          if (!isAudio(ext)) return false;
          if (!remixCheck(r.file, title)) return false;

          return true;
        });

        const mapped = filtered.map((r) => {
          const extMatch = r.file.match(/\.[^.]+$/);
          const ext = extMatch ? extMatch[0].toLowerCase() : "";
          return {
            file: r.file,
            size: r.size,
            slots: r.slots,
            speed: r.speed,
            bitrate: r.bitrate || null,
            extension: ext.replace(".", ""),
            user: r.username || r.user || "Unknown",
          };
        });

        const priority = { flac: 1, mp3: 2 };
        mapped.sort((a, b) => {
          const pa = priority[a.extension?.toLowerCase()] || 99;
          const pb = priority[b.extension?.toLowerCase()] || 99;
          if (pa !== pb) return pa - pb;

          const ba = a.bitrate || 0;
          const bb = b.bitrate || 0;
          if (ba !== bb) return bb - ba;

          const sa = a.size || 0;
          const sb = b.size || 0;
          return sb - sa;
        });

        resolve(mapped);   // <-- array of clean objects
      });
    });
  }

  async download(
    artist,
    title,
    fileTypePreference,
    fallbackFileTypePreference
  ) {
    const searchQuery = `${artist} ${title}`;

    return new Promise((resolve, reject) => {
      this.client.search(
        {
          req: searchQuery,
          timeout: 3000,
        },
        async (err, results) => {
          if (err) return reject(`err in search`);

          console.log(`found ${results.length} results for ${searchQuery}`);
          results.forEach((result) => {
            console.log(`  ${result.file} (${result.slots} slots)`);
          });

          const cleanedPreferred = fileTypePreference
            ? fileTypePreference.toLowerCase()
            : null;
          const cleanedFallback = fallbackFileTypePreference
            ? fallbackFileTypePreference.toLowerCase()
            : null;

          // Base candidates: has slots, audio extension, passes remix check
          const baseCandidates = results.filter((r) => {
            const extMatch = r.file.match(/\.[^.]+$/);
            const ext = extMatch ? extMatch[0].toLowerCase() : "";

            return (
              r.slots &&
              isAudio(ext) &&
              remixCheck(r.file, title)
            );
          });

          if (baseCandidates.length === 0) {
            return reject("no valid candidates found");
          }

          // Partition into preferred / fallback / others
          const preferred = cleanedPreferred
            ? baseCandidates.filter((c) =>
              c.file.toLowerCase().endsWith(cleanedPreferred)
            )
            : [];
          const fallback = cleanedFallback
            ? baseCandidates.filter((c) =>
              c.file.toLowerCase().endsWith(cleanedFallback)
            )
            : [];
          const others = baseCandidates.filter(
            (c) =>
              !preferred.includes(c) &&
              !fallback.includes(c)
          );

          // Sort helper: highest bitrate, then speed
          const sortByQuality = (arr) =>
            arr.sort(
              (a, b) =>
                (b.bitrate || b.speed || 0) - (a.bitrate || a.speed || 0)
            );

          sortByQuality(preferred);
          sortByQuality(fallback);
          sortByQuality(others);

          let candidates;
          if (preferred.length > 0) {
            console.log(
              `Using preferred type ${cleanedPreferred} for ${artist} - ${title}`
            );
            candidates = preferred;
          } else if (fallback.length > 0) {
            console.log(
              `No ${cleanedPreferred} found. Falling back to ${cleanedFallback} for ${artist} - ${title}`
            );
            candidates = fallback;
          } else {
            console.log(
              `No preferred or fallback types found. Using best available audio type for ${artist} - ${title}`
            );
            candidates = sortByQuality([...baseCandidates]);
          }

          console.log(
            `Trying ${candidates.length} candidate files for ${artist} - ${title}`
          );

          // Try each candidate in order until one succeeds
          for (let i = 0; i < candidates.length; i++) {
            const fileInfo = candidates[i];
            console.log(
              `Attempt ${i + 1}/${candidates.length}: ${fileInfo.file} (bitrate: ${fileInfo.bitrate || "n/a"
              }, speed: ${fileInfo.speed || "n/a"})`
            );

            try {
              const extMatch = fileInfo.file.match(/\.[^.]+$/);
              const ext = extMatch ? extMatch[0] : "";
              const filename = makeSafeFilename(artist, title, ext);

              const savePath = join(homedir(), "tmp", "slsk", filename);
              fs.mkdirSync(join(homedir(), "tmp", "slsk"), { recursive: true });

              const result = await this._downloadWithProgress(
                fileInfo,
                artist,
                title,
                savePath
              );

              return resolve(result);
            } catch (err) {
              console.log(`Failed candidate ${i + 1}: ${err}`);
            }
          }

          // If all attempts failed
          reject("all candidates timed out or failed");
        }
      );
    });
  }

  downloadSpecific(fileInfo, artist, title) {
    const searchQuery = `${artist} ${title}`;

    return new Promise((resolve, reject) => {
      // Re-run a search so we get fresh results
      this.client.search({ req: searchQuery, timeout: 3000 }, async (err, results) => {
        if (err) {
          console.error("[downloadSpecific] search error:", err);
          return reject("err in search for specific download");
        }

        if (!results || results.length === 0) {
          console.error("[downloadSpecific] no results at all for", searchQuery);
          return reject("no search results found for this track");
        }

        // Helper to normalize path / filename
        const normalize = (s) =>
          (s || "")
            .toLowerCase()
            .replace(/\\/g, "/")
            .replace(/\s+/g, " ")
            .trim();

        const basename = (s) => {
          const norm = normalize(s);
          const parts = norm.split("/");
          return parts[parts.length - 1]; // last segment
        };

        const wantedFileNorm = normalize(fileInfo.file);
        const wantedBase = basename(fileInfo.file);
        const chosenUser = (fileInfo.user || fileInfo.username || "").toLowerCase();

        let match = null;

        // strict: exact file path + same user (if we know user)
        if (chosenUser) {
          match = results.find((r) => {
            const rf = normalize(r.file);
            const ru = (r.user || r.username || "").toLowerCase();
            return rf === wantedFileNorm && ru === chosenUser;
          });
        }

        // fallback 1: exact file path, ignore user
        if (!match) {
          match = results.find((r) => normalize(r.file) === wantedFileNorm);
        }

        // fallback 2: same basename (ignoring folder structure), same extension
        if (!match) {
          const wantedExtMatch = fileInfo.file.match(/\.[^.]+$/);
          const wantedExt = wantedExtMatch ? wantedExtMatch[0].toLowerCase() : "";

          match = results.find((r) => {
            const rb = basename(r.file);
            const extMatch = r.file.match(/\.[^.]+$/);
            const ext = extMatch ? extMatch[0].toLowerCase() : "";
            return rb === wantedBase && ext === wantedExt;
          });
        }

        // 4) last-resort: any audio result (same ext if possible)
        if (!match) {
          console.warn(
            "[downloadSpecific] no strong match for",
            fileInfo.file,
            "– falling back to first audio candidate"
          );

          const audioResults = results.filter((r) => {
            const extMatch = r.file.match(/\.[^.]+$/);
            const ext = extMatch ? extMatch[0].toLowerCase() : "";
            return isAudio(ext);
          });

          if (audioResults.length > 0) {
            match = audioResults[0];
          }
        }

        if (!match) {
          console.error("[downloadSpecific] still no usable match for", fileInfo.file);
          return reject("chosen source not available anymore");
        }

        try {
          const extMatch = match.file.match(/\.[^.]+$/);
          const ext = extMatch ? extMatch[0] : "";
          const filename = makeSafeFilename(artist, title, ext);

          const savePath = join(homedir(), "tmp", "slsk", filename);
          fs.mkdirSync(join(homedir(), "tmp", "slsk"), { recursive: true });

          const result = await this._downloadWithProgress(
            match,        // IMPORTANT: use the full search result here
            artist,
            title,
            savePath
          );

          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  // -----------------
  // PROGRESS SYSTEM WITH "IDLE" TIMEOUT + WRITE ERROR HANDLING
  // -----------------
  _downloadWithProgress(fileInfo, artist, title, savePath) {

    return new Promise((resolve, reject) => {
      const fileSize = fileInfo.size ?? null;
      let downloaded = 0;
      const startTime = Date.now();

      let finished = false;
      let timeoutTimer = null;

      const fail = (errMsg) => {
        if (finished) return;
        finished = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);

        slskEvents.emit("progress", {
          artist,
          title,
          error: errMsg,
        });

        reject(errMsg);
      };

      const succeed = () => {
        if (finished) return;
        finished = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);

        slskEvents.emit("progress", {
          artist,
          title,
          percent: 100,
          speed: 0,
          downloadedBytes: fileSize,
          fileSize,
          done: true,
          path: savePath,
          fileType: fileInfo.file.match(/\.[^.]+$/)?.[0]?.replace(".", "").toUpperCase(),
          bitrate: fileInfo.bitrate || null
        });

        process.stdout.write(
          `\n[${artist} - ${title}] Download complete.\n`
        );

        resolve({ success: true, path: savePath });
      };

      const armTimeout = () => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        timeoutTimer = setTimeout(() => {
          fail("download timed out (no progress)");
        }, timeout * 1000);
      };

      // arm initial idle-timeout
      armTimeout();

      this.client.downloadStream(
        { file: fileInfo },
        (err, readStream) => {
          if (err) {
            return fail(`err in downloadStream: ${err}`);
          }

          const writeStream = fs.createWriteStream(savePath);

          writeStream.on("error", (err) => {
            fail(`file write error: ${err.message || err}`);
          });

          readStream.on("data", (chunk) => {
            if (finished) return;

            downloaded += chunk.length;

            const elapsedSec = (Date.now() - startTime) / 1000;
            const mbps =
              downloaded > 0 && elapsedSec > 0
                ? downloaded / 1024 / 1024 / elapsedSec
                : 0;

            const percent =
              fileSize && fileSize > 0
                ? Number(((downloaded / fileSize) * 100).toFixed(1))
                : null;

            // reset idle-timeout because progress is being made
            armTimeout();

            // Emit progress event for server / UI
            slskEvents.emit("progress", {
              artist,
              title,
              percent,
              speed: Number(mbps.toFixed(2)),
              downloadedBytes: downloaded,
              fileSize,
              path: savePath,
            });

            // Console progress bar
            if (percent !== null) {
              process.stdout.write(
                `\r[${artist} - ${title}] ${percent}% @ ${mbps.toFixed(
                  2
                )} MB/s`
              );
            }
          });

          readStream.on("end", () => {
            if (finished) return;
            writeStream.end();
            succeed();
          });

          readStream.on("error", (err) => {
            fail(`download stream error: ${err}`);
          });

          readStream.pipe(writeStream);
        }
      );
    });
  }
}

// -----------------
// Helpers
// -----------------

// Make a Windows-safe filename: remove characters like  < > : " / \ | ? *
function makeSafeFilename(artist, title, ext) {
  const base = `${artist} - ${title}`;
  const safe = base
    .replace(/[<>:"/\\|?*]/g, "") // remove illegal chars
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
  return safe + ext;
}

function isAudio(fileType) {
  const ext = (fileType || "").toLowerCase();
  return (
    ext === ".mp3" ||
    ext === ".flac" ||
    ext === ".m4a" ||
    ext === ".aiff" ||
    ext === ".wav" ||
    ext === ".ogg" ||
    ext === ".aac"
  );
}

function remixCheck(file, songTitle) {
  if (file.toLowerCase().includes("remix")) {
    return songTitle.toLowerCase().includes("remix");
  } else {
    return !songTitle.toLowerCase().includes("remix");
  }
}

export default Slsk;
